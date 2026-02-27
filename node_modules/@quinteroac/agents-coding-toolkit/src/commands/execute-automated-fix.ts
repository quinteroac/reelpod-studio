import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ as dollar } from "bun";

import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { exists, FLOW_REL_DIR, readState } from "../state";
import { type Issue, IssuesSchema } from "../../scaffold/schemas/tmpl_issues";
import { writeJsonArtifact, type WriteJsonArtifactFn } from "../write-json-artifact";

export interface ExecuteAutomatedFixOptions {
  provider: AgentProvider;
  iterations?: number;
  retryOnFail?: number;
}

interface ExecuteAutomatedFixDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  logFn: (message: string) => void;
  nowFn: () => Date;
  readFileFn: typeof readFile;
  runCommitFn: (projectRoot: string, message: string) => Promise<number>;
  writeJsonArtifactFn: WriteJsonArtifactFn;
}

const defaultDeps: ExecuteAutomatedFixDeps = {
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  logFn: console.log,
  nowFn: () => new Date(),
  readFileFn: readFile,
  runCommitFn: async (projectRoot: string, message: string) => {
    const result = await dollar`git add -A && git commit -m ${message}`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return result.exitCode;
  },
  writeJsonArtifactFn: writeJsonArtifact,
};

function isNetworkErrorText(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "network",
    "econnrefused",
    "enotfound",
    "eai_again",
    "timed out",
    "timeout",
    "connection reset",
    "connection refused",
  ].some((token) => normalized.includes(token));
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return isNetworkErrorText(error.message);
  }
  return isNetworkErrorText(String(error));
}

function sortIssuesById(issues: Issue[]): Issue[] {
  return [...issues].sort((left, right) => left.id.localeCompare(right.id));
}

async function writeIssuesFile(
  issuesPath: string,
  issues: Issue[],
  deps: ExecuteAutomatedFixDeps,
): Promise<void> {
  await deps.writeJsonArtifactFn(issuesPath, IssuesSchema, issues);
}

async function commitIssueUpdate(
  projectRoot: string,
  issueId: string,
  issueStatus: Issue["status"],
  deps: ExecuteAutomatedFixDeps,
): Promise<boolean> {
  const commitMessage = `fix: automated-fix ${issueId} -> ${issueStatus}`;
  const exitCode = await deps.runCommitFn(projectRoot, commitMessage);
  return exitCode === 0;
}

/**
 * Guardrail policy: `execute-automated-fix` is an explicit exception to the
 * phase-based guardrail system used by `execute-test-plan` and
 * `execute-refactor`. Those commands assert `current_phase` and prerequisite
 * status fields via `assertGuardrail` before running, because they depend on
 * phase-specific state transitions being in place.
 *
 * `execute-automated-fix` is deliberately phase-independent: issues can exist
 * and require automated remediation at any point in the workflow (prototype or
 * refactor phases, or during reruns after partial fixes). Its sole
 * prerequisite is the existence of a valid issues file for the current
 * iteration, which is already enforced by a hard error below. Adding a
 * phase-based guardrail here would prevent legitimate use cases (e.g. fixing
 * issues discovered late in a refactor pass) without adding safety value.
 *
 * `--force` is therefore not applicable to this command and is not accepted as
 * a flag (any unrecognised option, including `--force`, is rejected by the CLI
 * router before reaching this function).
 */
export async function runExecuteAutomatedFix(
  opts: ExecuteAutomatedFixOptions,
  deps: Partial<ExecuteAutomatedFixDeps> = {},
): Promise<void> {
  if (opts.iterations !== undefined && (!Number.isInteger(opts.iterations) || opts.iterations < 1)) {
    throw new Error("Invalid --iterations value. Expected an integer >= 1.");
  }

  if (
    opts.retryOnFail !== undefined &&
    (!Number.isInteger(opts.retryOnFail) || opts.retryOnFail < 0)
  ) {
    throw new Error("Invalid --retry-on-fail value. Expected an integer >= 0.");
  }

  const mergedDeps = { ...defaultDeps, ...deps };
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);

  const iteration = state.current_iteration;
  const fileName = `it_${iteration}_ISSUES.json`;
  const issuesPath = join(projectRoot, FLOW_REL_DIR, fileName);

  if (!(await mergedDeps.existsFn(issuesPath))) {
    throw new Error(
      `Issues file not found: expected ${join(FLOW_REL_DIR, fileName)}. Run \`bun nvst create issue --agent <provider>\` first.`,
    );
  }

  let parsedIssuesRaw: unknown;
  const flowRelativePath = join(FLOW_REL_DIR, fileName);
  try {
    parsedIssuesRaw = JSON.parse(await mergedDeps.readFileFn(issuesPath, "utf8"));
  } catch {
    throw new Error(
      `Deterministic validation error: invalid issues JSON in ${flowRelativePath}.`,
    );
  }

  const issuesValidation = IssuesSchema.safeParse(parsedIssuesRaw);
  if (!issuesValidation.success) {
    throw new Error(
      `Deterministic validation error: issues schema mismatch in ${flowRelativePath}.`,
    );
  }

  const issues = sortIssuesById(issuesValidation.data);
  const openIssues = issues.filter((issue) => issue.status === "open");

  if (openIssues.length === 0) {
    mergedDeps.logFn("No open issues to process. Exiting without changes.");
    return;
  }

  const skillTemplate = await mergedDeps.loadSkillFn(projectRoot, "automated-fix");
  const maxIssuesToProcess = opts.iterations ?? openIssues.length;
  const issuesToProcess = openIssues.slice(0, maxIssuesToProcess);
  const maxRetries = opts.retryOnFail ?? 0;

  let fixedCount = 0;
  let failedCount = 0;

  for (const issue of issuesToProcess) {
    let retriesRemaining = maxRetries;

    while (true) {
      const prompt = buildPrompt(skillTemplate, {
        iteration,
        issue: JSON.stringify(issue, null, 2),
      });

      let result: AgentResult | null = null;
      let invocationError: unknown = null;

      try {
        result = await mergedDeps.invokeAgentFn({
          provider: opts.provider,
          prompt,
          cwd: projectRoot,
          interactive: false,
        });
      } catch (error) {
        invocationError = error;
      }

      if (invocationError) {
        if (isNetworkError(invocationError)) {
          issue.status = "manual-fix";
          await writeIssuesFile(issuesPath, issues, mergedDeps);

          const committed = await commitIssueUpdate(projectRoot, issue.id, issue.status, mergedDeps);
          if (!committed) {
            mergedDeps.logFn(`${issue.id}: Failed`);
            mergedDeps.logFn(`Error: git commit failed for ${issue.id}`);
          } else {
            mergedDeps.logFn(`${issue.id}: Failed`);
          }
          failedCount += 1;
          break;
        }

        if (retriesRemaining > 0) {
          retriesRemaining -= 1;
          issue.status = "retry";
          await writeIssuesFile(issuesPath, issues, mergedDeps);
          continue;
        }

        issue.status = "manual-fix";
        await writeIssuesFile(issuesPath, issues, mergedDeps);

        const committed = await commitIssueUpdate(projectRoot, issue.id, issue.status, mergedDeps);
        if (!committed) {
          mergedDeps.logFn(`${issue.id}: Failed`);
          mergedDeps.logFn(`Error: git commit failed for ${issue.id}`);
        } else {
          mergedDeps.logFn(`${issue.id}: Failed`);
        }

        failedCount += 1;
        break;
      }

      if (result === null) {
        throw new Error("Agent invocation produced no result.");
      }

      if (result.exitCode === 0) {
        issue.status = "fixed";
        await writeIssuesFile(issuesPath, issues, mergedDeps);

        const committed = await commitIssueUpdate(projectRoot, issue.id, issue.status, mergedDeps);
        if (!committed) {
          mergedDeps.logFn(`${issue.id}: Failed`);
          mergedDeps.logFn(`Error: git commit failed for ${issue.id}`);
          failedCount += 1;
        } else {
          mergedDeps.logFn(`${issue.id}: Fixed`);
          fixedCount += 1;
        }
        break;
      }

      if (isNetworkErrorText(`${result.stderr}\n${result.stdout}`)) {
        issue.status = "manual-fix";
        await writeIssuesFile(issuesPath, issues, mergedDeps);

        const committed = await commitIssueUpdate(projectRoot, issue.id, issue.status, mergedDeps);
        if (!committed) {
          mergedDeps.logFn(`${issue.id}: Failed`);
          mergedDeps.logFn(`Error: git commit failed for ${issue.id}`);
        } else {
          mergedDeps.logFn(`${issue.id}: Failed`);
        }
        failedCount += 1;
        break;
      }

      if (retriesRemaining > 0) {
        retriesRemaining -= 1;
        issue.status = "retry";
        await writeIssuesFile(issuesPath, issues, mergedDeps);
        continue;
      }

      issue.status = "manual-fix";
      await writeIssuesFile(issuesPath, issues, mergedDeps);

      const committed = await commitIssueUpdate(projectRoot, issue.id, issue.status, mergedDeps);
      if (!committed) {
        mergedDeps.logFn(`${issue.id}: Failed`);
        mergedDeps.logFn(`Error: git commit failed for ${issue.id}`);
      } else {
        mergedDeps.logFn(`${issue.id}: Failed`);
      }
      failedCount += 1;
      break;
    }
  }

  mergedDeps.logFn(`Summary: Fixed=${fixedCount} Failed=${failedCount}`);
  mergedDeps.logFn(`Processed ${issuesToProcess.length} open issue(s) at ${mergedDeps.nowFn().toISOString()}`);
}

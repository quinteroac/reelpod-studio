import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  invokeAgent,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { exists, FLOW_REL_DIR, readState } from "../state";
import { IssuesSchema, type Issue } from "../../scaffold/schemas/tmpl_issues";
import type { State } from "../../scaffold/schemas/tmpl_state";

export interface ExecuteManualFixOptions {
  provider: AgentProvider;
}

interface ExecuteManualFixDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  logFn: (message: string) => void;
  promptIssueOutcomeFn: (question: string) => Promise<IssueOutcomeAction>;
  promptProceedFn: (question: string) => Promise<boolean>;
  readFileFn: typeof readFile;
  readStateFn: (projectRoot: string) => Promise<State>;
  writeFileFn: typeof writeFile;
}

const defaultDeps: ExecuteManualFixDeps = {
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  logFn: console.log,
  promptIssueOutcomeFn: promptForIssueOutcome,
  promptProceedFn: promptForConfirmation,
  readFileFn: readFile,
  readStateFn: readState,
  writeFileFn: writeFile,
};

export type IssueOutcomeAction = "fixed" | "skip" | "exit";

export function buildManualFixGuidancePrompt(issue: Issue, iteration: string): string {
  return `You are helping a developer resolve one manual-fix issue.

Issue context:
- Iteration: ${iteration}
- Issue ID: ${issue.id}
- Title: ${issue.title}
- Description:
${issue.description}

Response requirements:
1. Start with a concise summary/analysis of the problem.
2. Suggest a concrete reproduction strategy or test case.
3. Suggest potential fixes or code changes with rationale.
4. After the initial guidance, continue in an interactive chat loop:
   - Answer clarifying questions.
   - Provide code snippets when requested.
   - Keep working on this issue until the user says they are done.
5. Do not switch to other issues in this session.`;
}

export async function promptForConfirmation(question: string): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await readline.question(question)).trim();
    return /^y(?:es)?$/i.test(answer);
  } finally {
    readline.close();
  }
}

export async function promptForIssueOutcome(question: string): Promise<IssueOutcomeAction> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const answer = (await readline.question(question)).trim().toLowerCase();
      if (["fixed", "f", "done", "d"].includes(answer)) {
        return "fixed";
      }
      if (["skip", "s", "next", "n"].includes(answer)) {
        return "skip";
      }
      if (["exit", "e", "quit", "q"].includes(answer)) {
        return "exit";
      }
      console.log("Invalid choice. Try (f)ixed, (s)kip, or (e)xit.");
    }
  } finally {
    readline.close();
  }
}

export async function runExecuteManualFix(
  opts: ExecuteManualFixOptions,
  deps: Partial<ExecuteManualFixDeps> = {},
): Promise<void> {
  const mergedDeps: ExecuteManualFixDeps = { ...defaultDeps, ...deps };
  const projectRoot = process.cwd();
  const state = await mergedDeps.readStateFn(projectRoot);

  const iteration = state.current_iteration;
  const fileName = `it_${iteration}_ISSUES.json`;
  const issuesPath = join(projectRoot, FLOW_REL_DIR, fileName);
  const flowRelativePath = join(FLOW_REL_DIR, fileName);

  if (!(await mergedDeps.existsFn(issuesPath))) {
    throw new Error(
      `Issues file not found: expected ${flowRelativePath}. Run \`bun nvst create issue --agent <provider>\` first.`,
    );
  }

  let parsedIssuesRaw: unknown;
  try {
    parsedIssuesRaw = JSON.parse(await mergedDeps.readFileFn(issuesPath, "utf8"));
  } catch {
    throw new Error(
      `Deterministic validation error: invalid issues JSON in ${flowRelativePath}.`,
    );
  }

  const validation = IssuesSchema.safeParse(parsedIssuesRaw);
  if (!validation.success) {
    throw new Error(
      `Deterministic validation error: issues schema mismatch in ${flowRelativePath}.`,
    );
  }

  const manualFixIssues = validation.data.filter((issue: Issue) => issue.status === "manual-fix");
  mergedDeps.logFn(
    `Found ${manualFixIssues.length} issue(s) with status 'manual-fix' in ${flowRelativePath}.`,
  );

  const proceed = await mergedDeps.promptProceedFn(
    `Proceed with manual-fix processing for ${manualFixIssues.length} issue(s) using '${opts.provider}'? [y/N] `,
  );
  if (!proceed) {
    mergedDeps.logFn("Manual-fix execution cancelled.");
    return;
  }

  if (manualFixIssues.length === 0) {
    mergedDeps.logFn("No manual-fix issues to process. Exiting without changes.");
    return;
  }

  mergedDeps.logFn(`Ready to process ${manualFixIssues.length} manual-fix issue(s).`);

  for (const [index, issue] of manualFixIssues.entries()) {
    mergedDeps.logFn("\n" + "=".repeat(60));
    mergedDeps.logFn(
      `Issue ${index + 1}/${manualFixIssues.length}: ${issue.id} - ${issue.title}`,
    );
    mergedDeps.logFn("-".repeat(60));
    mergedDeps.logFn(issue.description);
    mergedDeps.logFn("-".repeat(60));
    mergedDeps.logFn(`Starting interactive session with '${opts.provider}'.`);
    mergedDeps.logFn("When finished, exit the agent session (e.g., via '/exit' or Ctrl+D) to return here.");
    mergedDeps.logFn("=".repeat(60) + "\n");

    const prompt = buildManualFixGuidancePrompt(issue, iteration);
    const result = await mergedDeps.invokeAgentFn({
      provider: opts.provider,
      prompt,
      cwd: projectRoot,
      interactive: true,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Agent invocation failed while guiding issue ${issue.id} with exit code ${result.exitCode}.`,
      );
    }

    const action = await mergedDeps.promptIssueOutcomeFn(
      "Action? (f)ixed, (s)kip, (e)xit: ",
    );

    if (action === "fixed") {
      issue.status = "fixed";
      await mergedDeps.writeFileFn(issuesPath, `${JSON.stringify(validation.data, null, 2)}\n`, "utf8");
      mergedDeps.logFn(`${issue.id}: marked as fixed.`);
      continue;
    }

    if (action === "skip") {
      mergedDeps.logFn(`${issue.id}: skipped. Status remains manual-fix.`);
      continue;
    }

    mergedDeps.logFn("Exiting manual-fix session by user request.");
    break;
  }
}

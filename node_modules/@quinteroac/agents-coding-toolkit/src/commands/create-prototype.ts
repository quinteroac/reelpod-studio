import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ as dollar } from "bun";

import { PrdSchema } from "../../scaffold/schemas/tmpl_prd";
import {
  PrototypeProgressSchema,
  type PrototypeProgress,
} from "../../scaffold/schemas/tmpl_prototype-progress";
import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { assertGuardrail } from "../guardrail";
import { defaultReadLine } from "../readline";
import { idsMatchExactly, sortedValues } from "../progress-utils";
import { exists, FLOW_REL_DIR, readState, writeState } from "../state";
import { writeJsonArtifact, type WriteJsonArtifactFn } from "../write-json-artifact";

export interface CreatePrototypeOptions {
  provider: AgentProvider;
  iterations?: number;
  retryOnFail?: number;
  stopOnCritical?: boolean;
  force?: boolean;
}

const DECLINE_DIRTY_TREE_ABORT_MESSAGE = "Aborted. Commit or discard your changes and re-run `bun nvst create prototype`.";
const DIRTY_TREE_COMMIT_PROMPT = "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]";

interface CreatePrototypeDeps {
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  checkGhAvailableFn: (projectRoot: string) => Promise<boolean>;
  createPullRequestFn: (
    projectRoot: string,
    title: string,
    body: string,
  ) => Promise<{ exitCode: number; stderr: string }>;
  logFn: (message: string) => void;
  warnFn: (message: string) => void;
  promptDirtyTreeCommitFn: (question: string) => Promise<boolean>;
  gitAddAndCommitFn: (projectRoot: string, commitMessage: string) => Promise<void>;
  writeJsonArtifactFn: WriteJsonArtifactFn;
}

const defaultDeps: CreatePrototypeDeps = {
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  checkGhAvailableFn: async (projectRoot) => {
    const proc = Bun.spawn(["gh", "--version"], {
      cwd: projectRoot,
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  },
  createPullRequestFn: async (projectRoot, title, body) => {
    const result = await dollar`gh pr create --title ${title} --body ${body}`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return {
      exitCode: result.exitCode,
      stderr: result.stderr.toString().trim(),
    };
  },
  logFn: console.log,
  warnFn: console.warn,
  promptDirtyTreeCommitFn: promptForDirtyTreeCommit,
  gitAddAndCommitFn: runGitAddAndCommit,
  writeJsonArtifactFn: writeJsonArtifact,
};

type ReadLineFn = () => Promise<string | null>;
type WriteFn = (message: string) => void;
type IsTTYFn = () => boolean;

function defaultWrite(message: string): void {
  process.stdout.write(`${message}\n`);
}

function defaultIsTTY(): boolean {
  return process.stdin.isTTY === true;
}

export async function promptForDirtyTreeCommit(
  question: string,
  readLineFn: ReadLineFn = defaultReadLine,
  writeFn: WriteFn = defaultWrite,
  isTTYFn: IsTTYFn = defaultIsTTY,
): Promise<boolean> {
  if (!isTTYFn()) {
    return false;
  }

  writeFn(question);

  let line: string | null;
  try {
    line = await readLineFn();
  } catch {
    line = null;
  }

  return line !== null && (line.trim() === "y" || line.trim() === "Y");
}

async function runGitAddAndCommit(projectRoot: string, commitMessage: string): Promise<void> {
  const addResult = await dollar`git add -A`.cwd(projectRoot).nothrow().quiet();
  if (addResult.exitCode !== 0) {
    throw new Error(`Pre-prototype commit failed:\n${addResult.stderr.toString().trim()}`);
  }

  const commitResult = await dollar`git commit -m ${commitMessage}`.cwd(projectRoot).nothrow().quiet();
  if (commitResult.exitCode !== 0) {
    throw new Error(`Pre-prototype commit failed:\n${commitResult.stderr.toString().trim()}`);
  }
}

export async function runPrePrototypeCommit(
  projectRoot: string,
  iteration: string,
  gitAddAndCommitFn: (projectRoot: string, commitMessage: string) => Promise<void> = runGitAddAndCommit,
): Promise<void> {
  const commitMessage = `chore: pre-prototype commit it_${iteration}`;
  try {
    await gitAddAndCommitFn(projectRoot, commitMessage);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.startsWith("Pre-prototype commit failed:\n")) {
      throw error;
    }
    throw new Error(`Pre-prototype commit failed:\n${reason}`);
  }
}

function parseQualityChecks(projectContextContent: string): string[] {
  const normalized = projectContextContent.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const testingStrategyStart = lines.findIndex((line) =>
    /^##\s+Testing Strategy\b/.test(line),
  );
  if (testingStrategyStart === -1) {
    return [];
  }

  const testingStrategyEndOffset = lines
    .slice(testingStrategyStart + 1)
    .findIndex((line) => /^##\s+/.test(line));
  const testingStrategyEnd = testingStrategyEndOffset === -1
    ? lines.length
    : testingStrategyStart + 1 + testingStrategyEndOffset;
  const testingStrategyLines = lines.slice(testingStrategyStart, testingStrategyEnd);

  const qualityChecksStart = testingStrategyLines.findIndex((line) =>
    /^###\s+Quality Checks\b/.test(line),
  );
  if (qualityChecksStart === -1) {
    return [];
  }

  const qualityChecksEndOffset = testingStrategyLines
    .slice(qualityChecksStart + 1)
    .findIndex((line) => /^###\s+/.test(line));
  const qualityChecksEnd = qualityChecksEndOffset === -1
    ? testingStrategyLines.length
    : qualityChecksStart + 1 + qualityChecksEndOffset;
  const qualityChecksSection = testingStrategyLines
    .slice(qualityChecksStart, qualityChecksEnd)
    .join("\n");

  const codeBlockMatch = qualityChecksSection.match(/```(?:\w+)?\n([\s\S]*?)```/m);
  if (!codeBlockMatch) {
    return [];
  }

  return codeBlockMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function runCreatePrototype(
  opts: CreatePrototypeOptions,
  deps: Partial<CreatePrototypeDeps> = {},
): Promise<void> {
  const mergedDeps: CreatePrototypeDeps = { ...defaultDeps, ...deps };
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const force = opts.force ?? false;

  if (opts.iterations !== undefined && (!Number.isInteger(opts.iterations) || opts.iterations < 1)) {
    throw new Error(
      "Invalid --iterations value. Expected an integer >= 1.",
    );
  }

  if (
    opts.retryOnFail !== undefined &&
    (!Number.isInteger(opts.retryOnFail) || opts.retryOnFail < 0)
  ) {
    throw new Error(
      "Invalid --retry-on-fail value. Expected an integer >= 0.",
    );
  }

  const iteration = state.current_iteration;
  const prdFileName = `it_${iteration}_PRD.json`;
  const prdPath = join(projectRoot, FLOW_REL_DIR, prdFileName);

  if (!(await exists(prdPath))) {
    throw new Error(
      `PRD source of truth missing: expected ${join(FLOW_REL_DIR, prdFileName)}. Run \`bun nvst approve requirement\` first.`,
    );
  }

  let parsedPrd: unknown;
  try {
    parsedPrd = JSON.parse(await readFile(prdPath, "utf8"));
  } catch {
    throw new Error(
      `Deterministic validation error: invalid PRD JSON in ${join(FLOW_REL_DIR, prdFileName)}.`,
    );
  }

  const prdValidation = PrdSchema.safeParse(parsedPrd);
  if (!prdValidation.success) {
    throw new Error(
      `Deterministic validation error: PRD schema mismatch in ${join(FLOW_REL_DIR, prdFileName)}.`,
    );
  }

  let prePrototypeCommitDone = false;

  if (state.current_phase === "define") {
    if (
      state.phases.define.prd_generation.status === "completed" &&
      state.phases.prototype.project_context.status === "created"
    ) {
      const workingTreeBeforeTransition = await dollar`git status --porcelain`.cwd(projectRoot).nothrow().quiet();
      if (workingTreeBeforeTransition.exitCode !== 0) {
        throw new Error(
          "Unable to verify git working tree status. Ensure this directory is a git repository and git is installed.",
        );
      }
      if (workingTreeBeforeTransition.stdout.toString().trim().length > 0) {
        const shouldProceed = await mergedDeps.promptDirtyTreeCommitFn(
          DIRTY_TREE_COMMIT_PROMPT,
        );
        if (!shouldProceed) {
          mergedDeps.logFn(DECLINE_DIRTY_TREE_ABORT_MESSAGE);
          return;
        }
        await runPrePrototypeCommit(projectRoot, iteration, mergedDeps.gitAddAndCommitFn);
        prePrototypeCommitDone = true;
      }
      state.current_phase = "prototype";
      await writeState(projectRoot, state);
    } else {
      await assertGuardrail(
        state,
        true,
        "Cannot create prototype: current_phase is define and prerequisites are not met. Complete define phase and run `bun nvst create project-context --agent <provider>` then `bun nvst approve project-context` first.",
        { force },
      );
    }
  } else if (state.current_phase !== "prototype") {
    await assertGuardrail(
      state,
      true,
      "Cannot create prototype: current_phase must be define (with approved PRD) or prototype. Complete define phase and run `bun nvst create project-context --agent <provider>` then `bun nvst approve project-context` first.",
      { force },
    );
  }

  await assertGuardrail(
    state,
    state.phases.prototype.project_context.status !== "created",
    "Cannot create prototype: prototype.project_context.status must be created. Run `bun nvst create project-context --agent <provider>` and `bun nvst approve project-context` first.",
    { force },
  );

  if (!prePrototypeCommitDone) {
    const workingTreeAfterPhase = await dollar`git status --porcelain`.cwd(projectRoot).nothrow().quiet();
    if (workingTreeAfterPhase.exitCode !== 0) {
      throw new Error(
        "Unable to verify git working tree status. Ensure this directory is a git repository and git is installed.",
      );
    }
    if (workingTreeAfterPhase.stdout.toString().trim().length > 0) {
      const shouldProceed = await mergedDeps.promptDirtyTreeCommitFn(
        DIRTY_TREE_COMMIT_PROMPT,
      );
      if (!shouldProceed) {
        mergedDeps.logFn(DECLINE_DIRTY_TREE_ABORT_MESSAGE);
        return;
      }
      await runPrePrototypeCommit(projectRoot, iteration, mergedDeps.gitAddAndCommitFn);
    }
  }

  const branchName = `feature/it_${iteration}`;
  const branchExistsResult = await dollar`git rev-parse --verify ${branchName}`
    .cwd(projectRoot)
    .nothrow()
    .quiet();

  if (branchExistsResult.exitCode !== 0) {
    const createBranchResult = await dollar`git checkout -b ${branchName}`.cwd(projectRoot).nothrow().quiet();
    if (createBranchResult.exitCode !== 0) {
      throw new Error(
        `Failed to create and checkout branch '${branchName}'. Resolve git errors and retry.`,
      );
    }
  } else {
    const checkoutBranchResult = await dollar`git checkout ${branchName}`.cwd(projectRoot).nothrow().quiet();
    if (checkoutBranchResult.exitCode !== 0) {
      throw new Error(
        `Failed to checkout branch '${branchName}'. Resolve git errors and retry.`,
      );
    }
  }

  const progressFileName = `it_${iteration}_progress.json`;
  const progressPath = join(projectRoot, FLOW_REL_DIR, progressFileName);
  const storyIds = sortedValues(prdValidation.data.userStories.map((story) => story.id));
  let progressData: PrototypeProgress;

  if (await exists(progressPath)) {
    let parsedProgress: unknown;
    try {
      parsedProgress = JSON.parse(await readFile(progressPath, "utf8"));
    } catch {
      throw new Error(
        `Deterministic validation error: invalid progress JSON in ${join(FLOW_REL_DIR, progressFileName)}.`,
      );
    }

    const progressValidation = PrototypeProgressSchema.safeParse(parsedProgress);
    if (!progressValidation.success) {
      throw new Error(
        `Deterministic validation error: progress schema mismatch in ${join(FLOW_REL_DIR, progressFileName)}.`,
      );
    }

    const existingIds = sortedValues(
      progressValidation.data.entries.map((entry) => entry.use_case_id),
    );

    if (!idsMatchExactly(existingIds, storyIds)) {
      throw new Error(
        "Progress file out of sync: use_case_id values do not match PRD user story ids.",
      );
    }
    progressData = progressValidation.data;
  } else {
    const now = new Date().toISOString();
    const progress = {
      entries: prdValidation.data.userStories.map((story) => ({
        use_case_id: story.id,
        status: "pending" as const,
        attempt_count: 0,
        last_agent_exit_code: null,
        quality_checks: [],
        last_error_summary: "",
        updated_at: now,
      })),
    };

    await mergedDeps.writeJsonArtifactFn(progressPath, PrototypeProgressSchema, progress);
    progressData = progress;
  }

  const eligibleStories = prdValidation.data.userStories.filter((story) => {
    const entry = progressData.entries.find((item) => item.use_case_id === story.id);
    return entry !== undefined && (entry.status === "pending" || entry.status === "failed");
  });

  if (eligibleStories.length === 0) {
    mergedDeps.logFn("No pending or failed user stories to implement. Exiting without changes.");
    return;
  }

  state.phases.prototype.prototype_build.status = "in_progress";
  state.phases.prototype.prototype_build.file = progressFileName;
  state.last_updated = new Date().toISOString();
  state.updated_by = "nvst:create-prototype";
  await writeState(projectRoot, state);

  let skillTemplate: string;
  try {
    skillTemplate = await mergedDeps.loadSkillFn(projectRoot, "implement-user-story");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/implement-user-story/SKILL.md.",
    );
  }

  const projectContextPath = join(projectRoot, ".agents", "PROJECT_CONTEXT.md");
  if (!(await exists(projectContextPath))) {
    throw new Error("Project context missing: expected .agents/PROJECT_CONTEXT.md.");
  }
  const projectContextContent = await readFile(projectContextPath, "utf8");
  const qualityCheckCommands = parseQualityChecks(projectContextContent);

  const maxStoriesToProcess = opts.iterations ?? Number.POSITIVE_INFINITY;
  const maxRetriesPerStory = opts.retryOnFail ?? 0;

  let storiesAttempted = 0;
  let haltedByCritical = false;

  for (const story of eligibleStories) {
    if (storiesAttempted >= maxStoriesToProcess || haltedByCritical) {
      break;
    }

    const entry = progressData.entries.find((item) => item.use_case_id === story.id);
    if (!entry) {
      continue;
    }

    const maxAttemptsForStory = 1 + maxRetriesPerStory;

    for (let attempt = 1; attempt <= maxAttemptsForStory; attempt += 1) {
      const prompt = buildPrompt(skillTemplate, {
        iteration: iteration,
        project_context: projectContextContent,
        user_story: JSON.stringify(story, null, 2),
      });

      const agentResult = await mergedDeps.invokeAgentFn({
        provider: opts.provider,
        prompt,
        cwd: projectRoot,
        interactive: false,
      });

      const qualityResults: Array<{ command: string; exit_code: number }> = [];
      for (const cmd of qualityCheckCommands) {
        const proc = Bun.spawn(["sh", "-c", cmd], {
          cwd: projectRoot,
          stdout: "ignore",
          stderr: "ignore",
        });
        const exitCode = await proc.exited;
        qualityResults.push({ command: cmd, exit_code: exitCode });
      }

      const checksPassed = qualityResults.every((result) => result.exit_code === 0);
      const allPassed = agentResult.exitCode === 0 && checksPassed;

      entry.attempt_count += 1;
      entry.last_agent_exit_code = agentResult.exitCode;
      entry.quality_checks = qualityResults;
      entry.updated_at = new Date().toISOString();

      if (allPassed) {
        entry.status = "completed";
        entry.last_error_summary = "";
      } else {
        entry.status = "failed";
        entry.last_error_summary = "Agent or quality check failed";
      }

      await mergedDeps.writeJsonArtifactFn(progressPath, PrototypeProgressSchema, progressData);

      if (allPassed) {
        const commitMessage = `feat: implement ${story.id} - ${story.title}`;
        const commitResult = await dollar`git add -A && git commit -m ${commitMessage}`
          .cwd(projectRoot)
          .nothrow()
          .quiet();

        if (commitResult.exitCode !== 0) {
          entry.status = "failed";
          entry.last_error_summary = "Git commit failed";
          entry.updated_at = new Date().toISOString();
          await mergedDeps.writeJsonArtifactFn(progressPath, PrototypeProgressSchema, progressData);

          mergedDeps.logFn(
            `iteration=it_${iteration} story=${story.id} attempt=${entry.attempt_count} outcome=commit_failed`,
          );

          if (opts.stopOnCritical) {
            haltedByCritical = true;
          }
        } else {
          mergedDeps.logFn(
            `iteration=it_${iteration} story=${story.id} attempt=${entry.attempt_count} outcome=passed`,
          );
        }

        break;
      }

      mergedDeps.logFn(
        `iteration=it_${iteration} story=${story.id} attempt=${entry.attempt_count} outcome=failed`,
      );

      if (opts.stopOnCritical) {
        haltedByCritical = true;
        break;
      }

      if (attempt < maxAttemptsForStory) {
        continue;
      }
    }

    storiesAttempted += 1;
  }

  const allCompleted = progressData.entries.every((entry) => entry.status === "completed");
  state.phases.prototype.prototype_build.status = allCompleted ? "created" : "in_progress";
  state.last_updated = new Date().toISOString();
  state.updated_by = "nvst:create-prototype";
  await writeState(projectRoot, state);

  if (storiesAttempted === 0) {
    mergedDeps.logFn("No user stories attempted.");
    return;
  }

  if (allCompleted) {
    const ghAvailable = await mergedDeps.checkGhAvailableFn(projectRoot);
    if (!ghAvailable) {
      mergedDeps.logFn("gh CLI not found — skipping PR creation");
    } else {
      const prTitle = `feat: prototype it_${iteration}`;
      const prBody = `Prototype for iteration it_${iteration}`;
      const prResult = await mergedDeps.createPullRequestFn(projectRoot, prTitle, prBody);
      if (prResult.exitCode !== 0) {
        const suffix = prResult.stderr.length > 0 ? `: ${prResult.stderr}` : "";
        mergedDeps.warnFn(`gh pr create failed (non-fatal)${suffix}`);
      }
    }
    mergedDeps.logFn("Prototype implementation completed for all user stories.");
  } else {
    mergedDeps.logFn("Prototype implementation paused with remaining pending or failed stories.");
  }
}

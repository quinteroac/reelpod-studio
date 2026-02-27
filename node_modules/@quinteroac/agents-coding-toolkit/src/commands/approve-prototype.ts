import { $ as dollar } from "bun";

import { assertGuardrail } from "../guardrail";
import { readState, writeState } from "../state";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ApprovePrototypeDeps {
  logFn: (message: string) => void;
  readStateFn: typeof readState;
  writeStateFn: typeof writeState;
  nowFn: () => Date;
  runGitStatusFn: (projectRoot: string) => Promise<CommandResult>;
  runStageAndCommitFn: (projectRoot: string, message: string) => Promise<CommandResult>;
  runCheckPreCommitHookFn: (projectRoot: string) => Promise<boolean>;
  runCurrentBranchFn: (projectRoot: string) => Promise<CommandResult>;
  runPushFn: (projectRoot: string, branch: string) => Promise<CommandResult>;
  checkGhAvailableFn: () => Promise<boolean>;
  runGhPrCreateFn: (projectRoot: string, title: string, body: string) => Promise<CommandResult>;
}

const defaultDeps: ApprovePrototypeDeps = {
  logFn: console.log,
  readStateFn: readState,
  writeStateFn: writeState,
  nowFn: () => new Date(),
  runGitStatusFn: async (projectRoot: string): Promise<CommandResult> => {
    const result = await dollar`git status --porcelain`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  },
  runStageAndCommitFn: async (projectRoot: string, message: string): Promise<CommandResult> => {
    const result = await dollar`git add -A && git commit -m ${message}`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  },
  runCheckPreCommitHookFn: async (projectRoot: string): Promise<boolean> => {
    return Bun.file(`${projectRoot}/.git/hooks/pre-commit`).exists();
  },
  runCurrentBranchFn: async (projectRoot: string): Promise<CommandResult> => {
    const result = await dollar`git branch --show-current`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  },
  runPushFn: async (projectRoot: string, branch: string): Promise<CommandResult> => {
    const result = await dollar`git push -u origin ${branch}`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  },
  checkGhAvailableFn: async (): Promise<boolean> => {
    const result = await dollar`gh --version`.nothrow().quiet();
    return result.exitCode === 0;
  },
  runGhPrCreateFn: async (projectRoot: string, title: string, body: string): Promise<CommandResult> => {
    const result = await dollar`gh pr create --title ${title} --body ${body}`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  },
};

export interface ApprovePrototypeOptions {
  force?: boolean;
}

export async function runApprovePrototype(
  opts: ApprovePrototypeOptions = {},
  deps: Partial<ApprovePrototypeDeps> = {},
): Promise<void> {
  const mergedDeps = { ...defaultDeps, ...deps };
  const { force = false } = opts;
  const projectRoot = process.cwd();
  const state = await mergedDeps.readStateFn(projectRoot);
  const commitMessage = `feat: approve prototype it_${state.current_iteration}`;
  const currentPhase = state.current_phase;

  await assertGuardrail(
    state,
    currentPhase !== "prototype",
    `Cannot approve prototype: current_phase must be 'prototype'. Current: '${currentPhase}'.`,
    { force },
  );

  if (state.phases.prototype.prototype_approved) {
    throw new Error(
      "Cannot approve prototype: phases.prototype.prototype_approved is already true.",
    );
  }

  const statusResult = await mergedDeps.runGitStatusFn(projectRoot);
  if (statusResult.exitCode !== 0) {
    throw new Error(
      `Failed to inspect git working tree: ${statusResult.stderr || "git status command failed."}`,
    );
  }

  if (!statusResult.stdout) {
    mergedDeps.logFn("No pending changes to commit; working tree is clean.");
    return;
  }

  const commitResult = await mergedDeps.runStageAndCommitFn(projectRoot, commitMessage);
  if (commitResult.exitCode !== 0) {
    const hasPreCommitHook = await mergedDeps.runCheckPreCommitHookFn(projectRoot);
    if (hasPreCommitHook) {
      process.exitCode = 1;
      throw new Error(
        `Pre-commit hook failed:\n${commitResult.stderr || commitResult.stdout || "hook exited non-zero."}`,
      );
    }
    process.exitCode = 1;
    throw new Error(
      `Failed to create prototype approval commit: ${commitResult.stderr || "git commit command failed."}`,
    );
  }

  const branchResult = await mergedDeps.runCurrentBranchFn(projectRoot);
  if (branchResult.exitCode !== 0 || !branchResult.stdout) {
    throw new Error(
      `Failed to detect current branch for push: ${branchResult.stderr || "branch name is empty."}`,
    );
  }

  const pushResult = await mergedDeps.runPushFn(projectRoot, branchResult.stdout);
  if (pushResult.exitCode !== 0) {
    process.exitCode = 1;
    throw new Error(
      `Failed to push prototype approval commit to origin/${branchResult.stdout}: ${pushResult.stderr || "git push command failed."}`,
    );
  }

  const ghAvailable = await mergedDeps.checkGhAvailableFn();
  if (ghAvailable) {
    const prTitle = `feat: prototype it_${state.current_iteration}`;
    const prBody = `Prototype for iteration it_${state.current_iteration}`;
    const prResult = await mergedDeps.runGhPrCreateFn(projectRoot, prTitle, prBody);
    if (prResult.exitCode !== 0) {
      mergedDeps.logFn(
        `Warning: gh pr create failed: ${prResult.stderr || prResult.stdout || "unknown error"}`,
      );
    }
  } else {
    mergedDeps.logFn("gh CLI not available; skipping PR creation.");
  }

  state.phases.prototype.prototype_approved = true;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:approve-prototype";
  await mergedDeps.writeStateFn(projectRoot, state);

  mergedDeps.logFn(`Committed prototype changes with message: ${commitMessage}`);
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentResult } from "../agent";
import { readState, writeState } from "../state";
import type { State } from "../../scaffold/schemas/tmpl_state";
import { promptForDirtyTreeCommit, runCreatePrototype, runPrePrototypeCommit } from "./create-prototype";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-create-prototype-"));
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

function makeState(overrides: {
  currentPhase?: State["current_phase"];
  prdStatus?: "pending" | "completed";
  projectContextStatus?: "pending" | "pending_approval" | "created";
  iteration?: string;
} = {}): State {
  const iteration = overrides.iteration ?? "000009";
  return {
    current_iteration: iteration,
    current_phase: overrides.currentPhase ?? "prototype",
    phases: {
      define: {
        requirement_definition: { status: "approved", file: `it_${iteration}_product-requirement-document.md` },
        prd_generation: { status: overrides.prdStatus ?? "completed", file: `it_${iteration}_PRD.json` },
      },
      prototype: {
        project_context: { status: overrides.projectContextStatus ?? "created", file: ".agents/PROJECT_CONTEXT.md" },
        test_plan: { status: "pending", file: null },
        tp_generation: { status: "pending", file: null },
        prototype_build: { status: "pending", file: null },
        test_execution: { status: "pending", file: null },
        prototype_approved: false,
      },
      refactor: {
        evaluation_report: { status: "pending", file: null },
        refactor_plan: { status: "pending", file: null },
        refactor_execution: { status: "pending", file: null },
        changelog: { status: "pending", file: null },
      },
    },
    last_updated: "2026-02-22T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  };
}

async function seedState(projectRoot: string, state: State): Promise<void> {
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });
  await writeState(projectRoot, state);
}

const MINIMAL_PRD = {
  goals: [] as string[],
  userStories: [{ id: "US-001", title: "T", description: "D", acceptanceCriteria: [{ id: "AC1", text: "T" }] }],
  functionalRequirements: [] as Array<{ id?: string; description: string }>,
};

async function seedPrd(projectRoot: string, iteration: string): Promise<void> {
  await writeFile(
    join(projectRoot, ".agents", "flow", `it_${iteration}_PRD.json`),
    JSON.stringify(MINIMAL_PRD),
    "utf8",
  );
}

async function seedProjectContext(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, ".agents"), { recursive: true });
  await writeFile(join(projectRoot, ".agents", "PROJECT_CONTEXT.md"), "# Project Context\n", "utf8");
}

async function initGitRepo(projectRoot: string): Promise<void> {
  const { $ } = await import("bun");
  await $`git init`.cwd(projectRoot).nothrow().quiet();
  await $`git config user.email "test@test" && git config user.name "Test"`.cwd(projectRoot).nothrow().quiet();
  await $`git add -A && git commit -m init`.cwd(projectRoot).nothrow().quiet();
}

function makeAgentResult(exitCode: number): AgentResult {
  return { exitCode, stdout: "", stderr: "" };
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("create prototype phase validation", () => {
  test("throws when current_phase is define and PRD is not completed", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000009";
    await seedState(root, makeState({ currentPhase: "define", prdStatus: "pending", projectContextStatus: "pending", iteration }));
    await seedPrd(root, iteration);

    await withCwd(root, async () => {
      await expect(runCreatePrototype({ provider: "claude" })).rejects.toThrow(
        "Cannot create prototype: current_phase is define and prerequisites are not met.",
      );
    });
  });

  test("throws when current_phase is define and project_context is not created", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000009";
    await seedState(root, makeState({ currentPhase: "define", prdStatus: "completed", projectContextStatus: "pending", iteration }));
    await seedPrd(root, iteration);

    await withCwd(root, async () => {
      await expect(runCreatePrototype({ provider: "claude" })).rejects.toThrow(
        "Cannot create prototype: current_phase is define and prerequisites are not met.",
      );
    });
  });

  test("prompts and returns when dirty during define-to-prototype transition and confirmation is denied", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000009";
    await seedState(root, makeState({ currentPhase: "define", prdStatus: "completed", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);

    await mkdir(join(root, ".agents"), { recursive: true });
    await writeFile(
      join(root, ".agents", "PROJECT_CONTEXT.md"),
      "# Project\n## Testing Strategy\n### Quality Checks\n```\nbun test\n```\n",
      "utf8",
    );

    const { $ } = await import("bun");
    await $`git init`.cwd(root).nothrow().quiet();
    await $`git config user.email "test@test" && git config user.name "Test"`.cwd(root).nothrow().quiet();
    await $`git add -A && git commit -m init`.cwd(root).nothrow().quiet();
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    const prompts: string[] = [];
    const logs: string[] = [];

    await withCwd(root, async () => {
      await expect(runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async (question) => {
            prompts.push(question);
            return false;
          },
          logFn: (message) => {
            logs.push(message);
          },
        },
      )).resolves.toBeUndefined();
    });

    expect(prompts).toEqual([
      "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
    ]);
    expect(logs).toContain("Aborted. Commit or discard your changes and re-run `bun nvst create prototype`.");

    // No transition happens when confirmation is denied.
    const updatedState = await readState(root);
    expect(updatedState.current_phase).toBe("define");
  });

  test("commits dirty tree on confirmation during define-to-prototype transition and transitions state to prototype", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000009";
    await seedState(root, makeState({ currentPhase: "define", prdStatus: "completed", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    const commitMessages: string[] = [];

    await withCwd(root, async () => {
      await runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async (_question) => true,
          gitAddAndCommitFn: async (projectRoot, commitMessage) => {
            commitMessages.push(commitMessage);
            const { $ } = await import("bun");
            await $`git add -A && git commit -m ${commitMessage}`.cwd(projectRoot).nothrow().quiet();
          },
          loadSkillFn: async () => "Implement story",
          invokeAgentFn: async ({ cwd }) => {
            if (!cwd) throw new Error("Expected cwd");
            await writeFile(join(cwd, "story.txt"), "implemented\n", "utf8");
            return makeAgentResult(0);
          },
          checkGhAvailableFn: async () => false,
        },
      );
    });

    expect(commitMessages).toEqual(["chore: pre-prototype commit it_000009"]);
    const updatedState = await readState(root);
    expect(updatedState.current_phase).toBe("prototype");
  });

  test("throws when current_phase is refactor", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000009";
    await seedState(root, makeState({ currentPhase: "refactor", iteration }));
    await seedPrd(root, iteration);

    await withCwd(root, async () => {
      await expect(runCreatePrototype({ provider: "claude" })).rejects.toThrow(
        "Cannot create prototype: current_phase must be define (with approved PRD) or prototype.",
      );
    });
  });

  test("proceeds when current_phase is already prototype", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    await seedState(root, makeState({ currentPhase: "prototype" }));

    // Passes phase check, fails later at PRD file lookup.
    await withCwd(root, async () => {
      await expect(runCreatePrototype({ provider: "claude" })).rejects.toThrow(
        "PRD source of truth missing",
      );
    });
  });

  test("prompts at the post-transition dirty-tree check when phase is already prototype", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000009";
    await seedState(root, makeState({ currentPhase: "prototype", prdStatus: "completed", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    const prompts: string[] = [];
    const logs: string[] = [];
    let gitAddAndCommitCalled = false;
    const statePath = join(root, ".agents", "state.json");
    const stateBefore = await readFile(statePath, "utf8");
    process.exitCode = 0;

    await withCwd(root, async () => {
      await expect(runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async (question) => {
            prompts.push(question);
            return false;
          },
          logFn: (message) => {
            logs.push(message);
          },
          gitAddAndCommitFn: async () => {
            gitAddAndCommitCalled = true;
          },
        },
      )).resolves.toBeUndefined();
    });

    expect(prompts).toEqual([
      "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
    ]);
    expect(logs).toContain("Aborted. Commit or discard your changes and re-run `bun nvst create prototype`.");
    expect(gitAddAndCommitCalled).toBe(false);
    expect(process.exitCode).not.toBe(1);
    const stateAfter = await readFile(statePath, "utf8");
    expect(stateAfter).toBe(stateBefore);
  });

  test("continues build when dirty-tree prompt is confirmed and calls gitAddAndCommitFn with commit message", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000018";
    await seedState(root, makeState({ currentPhase: "prototype", prdStatus: "completed", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    const prompts: string[] = [];
    const commitMessages: string[] = [];

    await withCwd(root, async () => {
      await expect(runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async (question) => {
            prompts.push(question);
            return true;
          },
          gitAddAndCommitFn: async (_projectRoot, commitMessage) => {
            commitMessages.push(commitMessage);
          },
          loadSkillFn: async () => "Implement story",
          invokeAgentFn: async ({ cwd }) => {
            if (!cwd) {
              throw new Error("Expected cwd");
            }
            await writeFile(join(cwd, "story.txt"), "implemented\n", "utf8");
            return makeAgentResult(0);
          },
          checkGhAvailableFn: async () => false,
        },
      )).resolves.toBeUndefined();
    });

    expect(prompts).toEqual([
      "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
    ]);
    expect(commitMessages).toEqual(["chore: pre-prototype commit it_000018"]);
  });

  test("commits dirty tree on confirmation and proceeds with prototype build", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000018";
    await seedState(root, makeState({ currentPhase: "prototype", prdStatus: "completed", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    let promptCount = 0;

    await withCwd(root, async () => {
      await runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async () => {
            promptCount += 1;
            return true;
          },
          loadSkillFn: async () => "Implement story",
          invokeAgentFn: async ({ cwd }) => {
            if (!cwd) {
              throw new Error("Expected cwd");
            }
            await writeFile(join(cwd, "story.txt"), "implemented\n", "utf8");
            return makeAgentResult(0);
          },
          checkGhAvailableFn: async () => false,
        },
      );
    });

    const { $ } = await import("bun");
    const preCommitCountResult = await $`git log --oneline --grep "chore: pre-prototype commit it_000018"`.cwd(root).nothrow().quiet();
    expect(preCommitCountResult.exitCode).toBe(0);
    expect(preCommitCountResult.stdout.toString().trim().length).toBeGreaterThan(0);

    expect(promptCount).toBe(1);

    const updatedState = await readState(root);
    expect(updatedState.phases.prototype.prototype_build.status).toBe("created");
  });

  test("throws pre-prototype commit failure and does not continue build", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000018";
    await seedState(root, makeState({ currentPhase: "prototype", prdStatus: "completed", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    let agentCalled = false;

    await withCwd(root, async () => {
      await expect(runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async () => true,
          gitAddAndCommitFn: async () => {
            throw new Error("hook rejected");
          },
          invokeAgentFn: async () => {
            agentCalled = true;
            return makeAgentResult(0);
          },
        },
      )).rejects.toThrow("Pre-prototype commit failed:\nhook rejected");
    });

    expect(agentCalled).toBe(false);
  });
});

describe("promptForDirtyTreeCommit", () => {
  test("returns true for lowercase y and uppercase Y", async () => {
    expect(
      await promptForDirtyTreeCommit(
        "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
        async () => "y",
        () => {},
        () => true,
      ),
    ).toBe(true);

    expect(
      await promptForDirtyTreeCommit(
        "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
        async () => "Y",
        () => {},
        () => true,
      ),
    ).toBe(true);
  });

  test("treats other input, empty input, and no input as no", async () => {
    expect(
      await promptForDirtyTreeCommit(
        "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
        async () => "n",
        () => {},
        () => true,
      ),
    ).toBe(false);

    expect(
      await promptForDirtyTreeCommit(
        "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
        async () => "",
        () => {},
        () => true,
      ),
    ).toBe(false);

    expect(
      await promptForDirtyTreeCommit(
        "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
        async () => null,
        () => {},
        () => true,
      ),
    ).toBe(false);
  });

  test("TC-005: returns false immediately without reading input when stdin is not a TTY", async () => {
    let readLineCalled = false;
    let writeCalled = false;

    const result = await promptForDirtyTreeCommit(
      "Working tree has uncommitted changes. Stage and commit them now to proceed? [y/N]",
      async () => {
        readLineCalled = true;
        return "y";
      },
      () => {
        writeCalled = true;
      },
      () => false,
    );

    expect(result).toBe(false);
    expect(readLineCalled).toBe(false);
    expect(writeCalled).toBe(false);
  });
});

describe("runPrePrototypeCommit", () => {
  test("runs git add and creates commit with required message", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    await initGitRepo(root);
    await writeFile(join(root, "dirty.txt"), "dirty\n", "utf8");

    await runPrePrototypeCommit(root, "000018");

    const { $ } = await import("bun");
    const commitMsg = await $`git log -1 --pretty=%s`.cwd(root).nothrow().quiet();
    expect(commitMsg.exitCode).toBe(0);
    expect(commitMsg.stdout.toString().trim()).toBe("chore: pre-prototype commit it_000018");

    const status = await $`git status --porcelain`.cwd(root).nothrow().quiet();
    expect(status.exitCode).toBe(0);
    expect(status.stdout.toString().trim()).toBe("");
  });
});

describe("create prototype gh PR creation", () => {
  test("runs gh pr create with generated title/body when gh is available", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000016";
    await seedState(root, makeState({ currentPhase: "prototype", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);

    let prTitle = "";
    let prBody = "";

    await withCwd(root, async () => {
      await runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async () => true,
          loadSkillFn: async () => "Implement story",
          invokeAgentFn: async ({ cwd }) => {
            if (!cwd) {
              throw new Error("Expected cwd");
            }
            await writeFile(join(cwd, "story.txt"), "implemented\n", "utf8");
            return makeAgentResult(0);
          },
          checkGhAvailableFn: async () => true,
          createPullRequestFn: async (_projectRoot, title, body) => {
            prTitle = title;
            prBody = body;
            return { exitCode: 0, stderr: "" };
          },
        },
      );
    });

    expect(prTitle).toBe("feat: prototype it_000016");
    expect(prBody).toBe("Prototype for iteration it_000016");
  });

  test("logs skip message and exits cleanly when gh is unavailable", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000016";
    await seedState(root, makeState({ currentPhase: "prototype", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);

    let createPrCalled = false;
    const logs: string[] = [];

    await withCwd(root, async () => {
      await runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async () => true,
          loadSkillFn: async () => "Implement story",
          invokeAgentFn: async ({ cwd }) => {
            if (!cwd) {
              throw new Error("Expected cwd");
            }
            await writeFile(join(cwd, "story.txt"), "implemented\n", "utf8");
            return makeAgentResult(0);
          },
          checkGhAvailableFn: async () => false,
          createPullRequestFn: async () => {
            createPrCalled = true;
            return { exitCode: 0, stderr: "" };
          },
          logFn: (message) => {
            logs.push(message);
          },
        },
      );
    });

    expect(createPrCalled).toBe(false);
    expect(logs).toContain("gh CLI not found — skipping PR creation");
  });

  test("treats gh pr create failures as non-fatal warnings and still updates state", async () => {
    const root = await createProjectRoot();
    createdRoots.push(root);
    const iteration = "000016";
    await seedState(root, makeState({ currentPhase: "prototype", projectContextStatus: "created", iteration }));
    await seedPrd(root, iteration);
    await seedProjectContext(root);
    await initGitRepo(root);

    const warnings: string[] = [];

    await withCwd(root, async () => {
      await runCreatePrototype(
        { provider: "claude" },
        {
          promptDirtyTreeCommitFn: async () => true,
          loadSkillFn: async () => "Implement story",
          invokeAgentFn: async ({ cwd }) => {
            if (!cwd) {
              throw new Error("Expected cwd");
            }
            await writeFile(join(cwd, "story.txt"), "implemented\n", "utf8");
            return makeAgentResult(0);
          },
          checkGhAvailableFn: async () => true,
          createPullRequestFn: async () => ({
            exitCode: 1,
            stderr: "a pull request for branch already exists",
          }),
          warnFn: (message) => {
            warnings.push(message);
          },
        },
      );
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("gh pr create failed (non-fatal)");

    const updatedState = await readState(root);
    expect(updatedState.phases.prototype.prototype_build.status).toBe("created");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import type { State } from "../../scaffold/schemas/tmpl_state";
import { readState, writeState } from "../state";
import { runApprovePrototype } from "./approve-prototype";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-approve-prototype-"));
}

async function createBareRemoteRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-approve-prototype-remote-"));
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

async function runGit(projectRoot: string, command: string): Promise<string> {
  const result = await $`bash -lc ${command}`.cwd(projectRoot).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error(`git command failed: ${command}\n${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

interface SeedStateOptions {
  iteration?: string;
  currentPhase?: "define" | "prototype" | "refactor";
  prototypeApproved?: boolean;
}

async function seedState(projectRoot: string, opts: SeedStateOptions = {}): Promise<void> {
  const {
    iteration = "000016",
    currentPhase = "prototype",
    prototypeApproved = false,
  } = opts;
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });
  await writeState(projectRoot, {
    current_iteration: iteration,
    current_phase: currentPhase,
    phases: {
      define: {
        requirement_definition: { status: "approved", file: "it_000016_product-requirement-document.md" },
        prd_generation: { status: "completed", file: "it_000016_PRD.json" },
      },
      prototype: {
        project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
        test_plan: { status: "created", file: "it_000016_test-plan.md" },
        tp_generation: { status: "created", file: "it_000016_TP.json" },
        prototype_build: { status: "created", file: "it_000016_progress.json" },
        test_execution: { status: "completed", file: "it_000016_test-execution-progress.json" },
        prototype_approved: prototypeApproved,
      },
      refactor: {
        evaluation_report: { status: "pending", file: null },
        refactor_plan: { status: "pending", file: null },
        refactor_execution: { status: "pending", file: null },
        changelog: { status: "pending", file: null },
      },
    },
    last_updated: "2026-02-26T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  });
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  process.exitCode = 0;
});

describe("approve prototype command", () => {
  test("registers approve prototype command in CLI dispatch", async () => {
    const source = await Bun.file(join(process.cwd(), "src", "cli.ts")).text();

    expect(source).toContain('import { runApprovePrototype } from "./commands/approve-prototype";');
    expect(source).toContain('if (subcommand === "prototype") {');
    expect(source).toContain("await runApprovePrototype({ force });");
  });

  test("stages all pending changes, commits/pushes, and marks prototype as approved", async () => {
    const projectRoot = await createProjectRoot();
    const remoteRoot = await createBareRemoteRoot();
    createdRoots.push(projectRoot);
    createdRoots.push(remoteRoot);

    await seedState(projectRoot, { iteration: "000016" });
    await runGit(projectRoot, "git init");
    await runGit(projectRoot, "git config user.email 'nvst@example.com'");
    await runGit(projectRoot, "git config user.name 'NVST Test'");
    await runGit(projectRoot, "git branch -M main");
    await runGit(remoteRoot, "git init --bare");
    await runGit(projectRoot, `git remote add origin ${remoteRoot}`);

    await writeFile(join(projectRoot, "tracked-modified.txt"), "before\n", "utf8");
    await writeFile(join(projectRoot, "tracked-deleted.txt"), "delete me\n", "utf8");
    await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");

    await writeFile(join(projectRoot, "tracked-modified.txt"), "after\n", "utf8");
    await rm(join(projectRoot, "tracked-deleted.txt"));
    await writeFile(join(projectRoot, "untracked-added.txt"), "new\n", "utf8");

    const beforeState = await Bun.file(join(projectRoot, ".agents", "state.json")).json();

    await withCwd(projectRoot, async () => {
      await runApprovePrototype();
    });

    const commitMessage = await runGit(projectRoot, "git log -1 --pretty=%s");
    expect(commitMessage).toBe("feat: approve prototype it_000016");

    const changedFiles = await runGit(projectRoot, "git show --name-status --pretty=format: HEAD");
    expect(changedFiles).toContain("tracked-modified.txt");
    expect(changedFiles).toContain("tracked-deleted.txt");
    expect(changedFiles).toContain("untracked-added.txt");

    const upstream = await runGit(projectRoot, "git rev-parse --abbrev-ref --symbolic-full-name @{u}");
    expect(upstream).toBe("origin/main");

    const afterState = await Bun.file(join(projectRoot, ".agents", "state.json")).json();
    expect(afterState.phases.prototype.prototype_approved).toBe(true);
    expect(afterState.last_updated).not.toBe(beforeState.last_updated);
  });

  test("prints informative message and skips commit when working tree is clean", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, { iteration: "000016" });
    await runGit(projectRoot, "git init");
    await runGit(projectRoot, "git config user.email 'nvst@example.com'");
    await runGit(projectRoot, "git config user.name 'NVST Test'");
    await writeFile(join(projectRoot, "tracked.txt"), "stable\n", "utf8");
    await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");

    const beforeHead = await runGit(projectRoot, "git rev-parse HEAD");
    const logs: string[] = [];

    await withCwd(projectRoot, async () => {
      await runApprovePrototype({}, {
        logFn: (message) => {
          logs.push(message);
        },
      });
    });

    const afterHead = await runGit(projectRoot, "git rev-parse HEAD");
    const commitCount = await runGit(projectRoot, "git rev-list --count HEAD");

    expect(afterHead).toBe(beforeHead);
    expect(commitCount).toBe("1");
    expect(logs).toContain("No pending changes to commit; working tree is clean.");
  });

  test("throws Pre-commit hook failed error when commit fails due to pre-commit hook", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, { iteration: "000016" });
    await runGit(projectRoot, "git init");
    await runGit(projectRoot, "git config user.email 'nvst@example.com'");
    await runGit(projectRoot, "git config user.name 'NVST Test'");
    await runGit(projectRoot, "git branch -M main");

    // Seed an initial commit before installing the hook
    await writeFile(join(projectRoot, "file.txt"), "initial\n", "utf8");
    await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");

    // Install a failing pre-commit hook
    const hookPath = join(projectRoot, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/bin/sh\necho 'blocked by pre-commit hook'\nexit 1\n", { mode: 0o755 });

    // Make a change that the command will attempt to stage and commit
    await writeFile(join(projectRoot, "file.txt"), "modified\n", "utf8");

    const statePath = join(projectRoot, ".agents", "state.json");
    const beforeState = await Bun.file(statePath).text();
    process.exitCode = 0;

    let caught: unknown = null;
    await withCwd(projectRoot, async () => {
      try {
        await runApprovePrototype();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/^Pre-commit hook failed:\n/);
    expect(process.exitCode).toBe(1);

    const afterState = await Bun.file(statePath).text();
    expect(afterState).toBe(beforeState);
  });

  test("throws descriptive error on push failure, sets process.exitCode, and does not update state.json", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, { iteration: "000016" });
    await runGit(projectRoot, "git init");
    await runGit(projectRoot, "git config user.email 'nvst@example.com'");
    await runGit(projectRoot, "git config user.name 'NVST Test'");

    await writeFile(join(projectRoot, "tracked.txt"), "before\n", "utf8");
    await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");
    await writeFile(join(projectRoot, "tracked.txt"), "after\n", "utf8");

    const statePath = join(projectRoot, ".agents", "state.json");
    const beforeState = await Bun.file(statePath).text();
    process.exitCode = 0;

    let caught: unknown = null;
    await withCwd(projectRoot, async () => {
      try {
        await runApprovePrototype();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Failed to push prototype approval commit");
    expect(process.exitCode).toBe(1);

    const afterState = await Bun.file(statePath).text();
    expect(afterState).toBe(beforeState);
  });

  test("throws descriptive error when prototype is already approved", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { prototypeApproved: true });

    let caught: unknown = null;
    await withCwd(projectRoot, async () => {
      try {
        await runApprovePrototype();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      "Cannot approve prototype: phases.prototype.prototype_approved is already true.",
    );
  });

  test("blocks approval when current phase is not prototype", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { currentPhase: "define" });

    let caught: unknown = null;
    await withCwd(projectRoot, async () => {
      try {
        await runApprovePrototype();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      "Cannot approve prototype: current_phase must be 'prototype'. Current: 'define'.",
    );
  });

  describe("gh PR creation behaviour", () => {
    const ITERATION = "000016";

    test("when gh is available and gh pr create succeeds, runs it with correct title and body and updates state", async () => {
      const projectRoot = await createProjectRoot();
      createdRoots.push(projectRoot);
      await seedState(projectRoot, { iteration: ITERATION });
      await runGit(projectRoot, "git init");
      await runGit(projectRoot, "git config user.email 'nvst@example.com'");
      await runGit(projectRoot, "git config user.name 'NVST Test'");
      await runGit(projectRoot, "git branch -M main");
      const remoteRoot = await createBareRemoteRoot();
      createdRoots.push(remoteRoot);
      await runGit(remoteRoot, "git init --bare");
      await runGit(projectRoot, `git remote add origin ${remoteRoot}`);
      await writeFile(join(projectRoot, "file.txt"), "initial\n", "utf8");
      await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");
      await writeFile(join(projectRoot, "file.txt"), "modified\n", "utf8");

      const logs: string[] = [];
      const prCreateCalls: Array<{ projectRoot: string; title: string; body: string }> = [];
      let writtenState: State | null = null;

      await withCwd(projectRoot, async () => {
        await runApprovePrototype(
          {},
          {
            logFn: (msg) => logs.push(msg),
            readStateFn: () => readState(projectRoot),
            writeStateFn: async (_root, state) => {
              writtenState = state;
              await writeState(projectRoot, state);
            },
            checkGhAvailableFn: async () => true,
            runGhPrCreateFn: async (root, title, body) => {
              prCreateCalls.push({ projectRoot: root, title, body });
              return { exitCode: 0, stdout: "https://github.com/owner/repo/pull/1", stderr: "" };
            },
          },
        );
      });

      expect(prCreateCalls).toHaveLength(1);
      expect(prCreateCalls[0].title).toBe(`feat: prototype it_${ITERATION}`);
      expect(prCreateCalls[0].body).toBe(`Prototype for iteration it_${ITERATION}`);
      expect(writtenState).not.toBeNull();
      expect(writtenState!.phases.prototype.prototype_approved).toBe(true);
      expect(writtenState!.updated_by).toBe("nvst:approve-prototype");
    });

    test("when gh is not available, prints skip message, exits with code 0, and still updates state", async () => {
      const projectRoot = await createProjectRoot();
      createdRoots.push(projectRoot);
      await seedState(projectRoot, { iteration: ITERATION });
      await runGit(projectRoot, "git init");
      await runGit(projectRoot, "git config user.email 'nvst@example.com'");
      await runGit(projectRoot, "git config user.name 'NVST Test'");
      await runGit(projectRoot, "git branch -M main");
      const remoteRoot = await createBareRemoteRoot();
      createdRoots.push(remoteRoot);
      await runGit(remoteRoot, "git init --bare");
      await runGit(projectRoot, `git remote add origin ${remoteRoot}`);
      await writeFile(join(projectRoot, "file.txt"), "initial\n", "utf8");
      await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");
      await writeFile(join(projectRoot, "file.txt"), "modified\n", "utf8");

      const logs: string[] = [];
      const prCreateCalls: Array<{ projectRoot: string; title: string; body: string }> = [];
      let writtenState: State | null = null;
      process.exitCode = 0;

      await withCwd(projectRoot, async () => {
        await runApprovePrototype(
          {},
          {
            logFn: (msg) => logs.push(msg),
            readStateFn: () => readState(projectRoot),
            writeStateFn: async (_root, state) => {
              writtenState = state;
              await writeState(projectRoot, state);
            },
            checkGhAvailableFn: async () => false,
            runGhPrCreateFn: async (root, title, body) => {
              prCreateCalls.push({ projectRoot: root, title, body });
              return { exitCode: 0, stdout: "", stderr: "" };
            },
          },
        );
      });

      expect(logs).toContain("gh CLI not available; skipping PR creation.");
      expect(prCreateCalls).toHaveLength(0);
      expect(process.exitCode).toBe(0);
      expect(writtenState).not.toBeNull();
      expect(writtenState!.phases.prototype.prototype_approved).toBe(true);
    });

    test("when gh pr create fails, logs non-fatal warning and still updates state", async () => {
      const projectRoot = await createProjectRoot();
      createdRoots.push(projectRoot);
      await seedState(projectRoot, { iteration: ITERATION });
      await runGit(projectRoot, "git init");
      await runGit(projectRoot, "git config user.email 'nvst@example.com'");
      await runGit(projectRoot, "git config user.name 'NVST Test'");
      await runGit(projectRoot, "git branch -M main");
      const remoteRoot = await createBareRemoteRoot();
      createdRoots.push(remoteRoot);
      await runGit(remoteRoot, "git init --bare");
      await runGit(projectRoot, `git remote add origin ${remoteRoot}`);
      await writeFile(join(projectRoot, "file.txt"), "initial\n", "utf8");
      await runGit(projectRoot, "git add -A && git commit -m 'chore: seed'");
      await writeFile(join(projectRoot, "file.txt"), "modified\n", "utf8");

      const logs: string[] = [];
      let writtenState: State | null = null;

      await withCwd(projectRoot, async () => {
        await runApprovePrototype(
          {},
          {
            logFn: (msg) => logs.push(msg),
            readStateFn: () => readState(projectRoot),
            writeStateFn: async (_root, state) => {
              writtenState = state;
              await writeState(projectRoot, state);
            },
            checkGhAvailableFn: async () => true,
            runGhPrCreateFn: async () => ({
              exitCode: 1,
              stdout: "",
              stderr: "a pull request for branch 'main' already exists",
            }),
          },
        );
      });

      expect(logs.some((m) => m.includes("Warning: gh pr create failed"))).toBe(true);
      expect(logs.some((m) => m.includes("already exists"))).toBe(true);
      expect(writtenState).not.toBeNull();
      expect(writtenState!.phases.prototype.prototype_approved).toBe(true);
    });
  });
});

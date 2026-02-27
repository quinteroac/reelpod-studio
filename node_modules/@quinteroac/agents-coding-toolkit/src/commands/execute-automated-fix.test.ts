import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeState } from "../state";
import { runExecuteAutomatedFix } from "./execute-automated-fix";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-execute-automated-fix-"));
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

async function seedState(projectRoot: string, iteration = "000009") {
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });
  await writeState(projectRoot, {
    current_iteration: iteration,
    current_phase: "prototype",
    phases: {
      define: {
        requirement_definition: { status: "approved", file: `it_${iteration}_product-requirement-document.md` },
        prd_generation: { status: "completed", file: `it_${iteration}_PRD.json` },
      },
      prototype: {
        project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
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
  });
}

async function writeIssues(projectRoot: string, iteration: string, data: unknown) {
  const issuesPath = join(projectRoot, ".agents", "flow", `it_${iteration}_ISSUES.json`);
  await writeFile(issuesPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return issuesPath;
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("execute automated-fix", () => {
  test("registers execute automated-fix command in CLI", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runExecuteAutomatedFix } from "./commands/execute-automated-fix";');
    expect(source).toContain('if (subcommand === "automated-fix") {');
    expect(source).toContain("parseOptionalIntegerFlag(postAgentArgs, \"--iterations\", 1);");
    expect(source).toContain("await runExecuteAutomatedFix({ provider, iterations, retryOnFail });");
    expect(source).toContain("execute automated-fix --agent <provider> [--iterations <N>] [--retry-on-fail <N>]");
  });

  test("CLI exits with code 1 when --agent is missing", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "execute", "automated-fix"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required --agent <provider> argument.");
  });

  test("CLI accepts --agent and rejects unknown providers", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "execute", "automated-fix", "--agent", "invalid-provider"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown agent provider");
  });

  test("throws clear error when current-iteration issues file is missing", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");

    await withCwd(projectRoot, async () => {
      await expect(runExecuteAutomatedFix({ provider: "codex" })).rejects.toThrow(
        "Issues file not found: expected .agents/flow/it_000009_ISSUES.json. Run `bun nvst create issue --agent <provider>` first.",
      );
    });
  });

  test("reads current-iteration issues file, processes only open issues sequentially, and commits fixed status", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Already fixed", description: "skip", status: "fixed" },
      { id: "ISSUE-000009-002", title: "Open A", description: "first open", status: "open" },
      { id: "ISSUE-000009-003", title: "Open B", description: "second open", status: "open" },
    ]);

    const prompts: string[] = [];
    const commitMessages: string[] = [];
    const logs: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex", iterations: 2 },
        {
          loadSkillFn: async (_root, name) => {
            expect(name).toBe("automated-fix");
            return "1. Understand the issue.\n2. Reproduce the issue.\n11. Mark as fixed.";
          },
          invokeAgentFn: async (options) => {
            prompts.push(options.prompt);
            return { exitCode: 0, stdout: "ok", stderr: "" };
          },
          runCommitFn: async (_root, message) => {
            commitMessages.push(message);
            return 0;
          },
          logFn: (message) => logs.push(message),
          nowFn: () => new Date("2026-02-22T12:00:00.000Z"),
        },
      );
    });

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ id: string; status: string }>;

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('"id": "ISSUE-000009-002"');
    expect(prompts[1]).toContain('"id": "ISSUE-000009-003"');
    expect(prompts[0]).toContain("1. Understand the issue.");
    expect(prompts[0]).toContain("11. Mark as fixed.");

    expect(issues.find((issue) => issue.id === "ISSUE-000009-001")?.status).toBe("fixed");
    expect(issues.find((issue) => issue.id === "ISSUE-000009-002")?.status).toBe("fixed");
    expect(issues.find((issue) => issue.id === "ISSUE-000009-003")?.status).toBe("fixed");

    expect(commitMessages).toHaveLength(2);
    expect(logs).toContain("ISSUE-000009-002: Fixed");
    expect(logs).toContain("ISSUE-000009-003: Fixed");
    expect(logs).toContain("Summary: Fixed=2 Failed=0");
  });

  test("invokes agent with the provider selected by --agent", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Open A", description: "first open", status: "open" },
    ]);

    const providersUsed: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "cursor" },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async (options) => {
            providersUsed.push(options.provider);
            return { exitCode: 0, stdout: "ok", stderr: "" };
          },
          runCommitFn: async () => 0,
        },
      );
    });

    expect(providersUsed).toEqual(["cursor"]);
  });

  // RI-005: execute-automated-fix is a phase-independent exception to the guardrail system.
  // It must process issues regardless of current_phase because issues can arise and need
  // fixing at any point in the workflow (prototype OR refactor phases).
  test("RI-005: processes open issues regardless of current_phase (phase-independent guardrail exception)", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    // Seed state with current_phase = "refactor", not the typical "prototype"
    await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });
    const { writeState } = await import("../state");
    await writeState(projectRoot, {
      current_iteration: "000009",
      current_phase: "refactor",
      phases: {
        define: {
          requirement_definition: { status: "approved", file: "it_000009_product-requirement-document.md" },
          prd_generation: { status: "completed", file: "it_000009_PRD.json" },
        },
        prototype: {
          project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
          test_plan: { status: "created", file: "it_000009_test-plan.md" },
          tp_generation: { status: "created", file: "it_000009_test-plan.json" },
          prototype_build: { status: "created", file: null },
          test_execution: { status: "completed", file: null },
          prototype_approved: true,
        },
        refactor: {
          evaluation_report: { status: "created", file: null },
          refactor_plan: { status: "approved", file: null },
          refactor_execution: { status: "in_progress", file: null },
          changelog: { status: "pending", file: null },
        },
      },
      last_updated: "2026-02-22T00:00:00.000Z",
      updated_by: "seed",
      history: [],
    });
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Refactor-phase issue", description: "fix me", status: "open" },
    ]);

    let invokeCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex" },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "ok", stderr: "" };
          },
          runCommitFn: async () => 0,
        },
      );
    });

    expect(invokeCount).toBe(1);
  });

  test("logs informative message and exits without changes when zero open issues exist", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Already fixed", description: "skip", status: "fixed" },
      { id: "ISSUE-000009-002", title: "Retrying", description: "skip", status: "retry" },
    ]);

    const logs: string[] = [];
    let invokeCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex" },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "ok", stderr: "" };
          },
          runCommitFn: async () => 0,
          logFn: (message) => logs.push(message),
        },
      );
    });

    expect(invokeCount).toBe(0);
    expect(logs).toContain("No open issues to process. Exiting without changes.");
  });

  // US-001-AC01: When --iterations is not provided, all open issues are processed
  test("US-001-AC01: processes all open issues when --iterations is not provided", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Open A", description: "first open", status: "open" },
      { id: "ISSUE-000009-002", title: "Open B", description: "second open", status: "open" },
      { id: "ISSUE-000009-003", title: "Open C", description: "third open", status: "open" },
    ]);

    let invokeCount = 0;
    const logs: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex" },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          runCommitFn: async () => 0,
          logFn: (message) => logs.push(message),
          nowFn: () => new Date("2026-02-22T12:00:00.000Z"),
        },
      );
    });

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ id: string; status: string }>;

    // All 3 open issues should be processed
    expect(invokeCount).toBe(3);
    expect(issues.find((issue) => issue.id === "ISSUE-000009-001")?.status).toBe("fixed");
    expect(issues.find((issue) => issue.id === "ISSUE-000009-002")?.status).toBe("fixed");
    expect(issues.find((issue) => issue.id === "ISSUE-000009-003")?.status).toBe("fixed");
    // AC04: summary reflects all processed issues
    expect(logs).toContain("Summary: Fixed=3 Failed=0");
    expect(logs).toContain("Processed 3 open issue(s) at 2026-02-22T12:00:00.000Z");
  });

  test("processes only the first N open issues when --iterations is provided", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Open A", description: "first open", status: "open" },
      { id: "ISSUE-000009-002", title: "Open B", description: "second open", status: "open" },
      { id: "ISSUE-000009-003", title: "Open C", description: "third open", status: "open" },
    ]);

    let invokeCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex", iterations: 2 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          runCommitFn: async () => 0,
        },
      );
    });

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ id: string; status: string }>;

    expect(invokeCount).toBe(2);
    expect(issues.find((issue) => issue.id === "ISSUE-000009-001")?.status).toBe("fixed");
    expect(issues.find((issue) => issue.id === "ISSUE-000009-002")?.status).toBe("fixed");
    expect(issues.find((issue) => issue.id === "ISSUE-000009-003")?.status).toBe("open");
  });

  test("throws deterministic validation error when issues file contains entries with missing required fields", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Open A", description: "first open", status: "open" },
      { id: "ISSUE-000009-002", title: "Missing description", status: "open" },
      { id: "ISSUE-000009-003", title: "Fixed", description: "skip", status: "fixed" },
    ]);

    await withCwd(projectRoot, async () => {
      await expect(runExecuteAutomatedFix({ provider: "codex" })).rejects.toThrow(
        "Deterministic validation error: issues schema mismatch in .agents/flow/it_000009_ISSUES.json.",
      );
    });
  });

  test("marks issue as retry when hypothesis is not confirmed and retries remain", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Retry me", description: "test", status: "open" },
    ]);

    const writtenSnapshots: string[] = [];
    let invokeCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "claude", retryOnFail: 1 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            if (invokeCount === 1) {
              return { exitCode: 1, stdout: "", stderr: "no confirmed hypothesis" };
            }
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          runCommitFn: async () => 0,
          writeJsonArtifactFn: async (path, _schema, data) => {
            writtenSnapshots.push(JSON.stringify(data, null, 2));
            await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
          },
        },
      );
    });

    expect(invokeCount).toBe(2);
    expect(writtenSnapshots.some((snapshot) => snapshot.includes('"status": "retry"'))).toBe(true);

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ status: string }>;
    expect(issues[0]?.status).toBe("fixed");
  });

  test("marks issue as manual-fix and commits when retries are exhausted", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Manual fix", description: "test", status: "open" },
    ]);

    const commitMessages: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "gemini", retryOnFail: 0 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => ({ exitCode: 1, stdout: "", stderr: "no confirmed hypothesis" }),
          runCommitFn: async (_root, message) => {
            commitMessages.push(message);
            return 0;
          },
        },
      );
    });

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ status: string }>;

    expect(issues[0]?.status).toBe("manual-fix");
    expect(commitMessages).toHaveLength(1);
    expect(commitMessages[0]).toContain("manual-fix");
  });

  test("stops retrying after reaching max retries", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Retry limit", description: "test", status: "open" },
    ]);

    let invokeCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "gemini", retryOnFail: 2 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 1, stdout: "", stderr: "still failing" };
          },
          runCommitFn: async () => 0,
        },
      );
    });

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ status: string }>;

    expect(invokeCount).toBe(3);
    expect(issues[0]?.status).toBe("manual-fix");
  });

  test("marks issue as manual-fix and does not consume retries on network errors", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "Network", description: "test", status: "open" },
    ]);

    let invokeCount = 0;
    let commitCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "cursor", retryOnFail: 3 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            throw new Error("ENOTFOUND api.provider.example");
          },
          runCommitFn: async () => {
            commitCount += 1;
            return 0;
          },
        },
      );
    });

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ status: string }>;

    expect(invokeCount).toBe(1);
    expect(commitCount).toBe(1);
    expect(issues[0]?.status).toBe("manual-fix");
  });

  test("continues to next issue and marks failed summary when git commit fails", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "First", description: "one", status: "open" },
      { id: "ISSUE-000009-002", title: "Second", description: "two", status: "open" },
    ]);

    const logs: string[] = [];
    let commitAttempt = 0;
    let invokeCount = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex", iterations: 2 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          runCommitFn: async () => {
            commitAttempt += 1;
            return commitAttempt === 1 ? 1 : 0;
          },
          logFn: (message) => logs.push(message),
        },
      );
    });

    expect(invokeCount).toBe(2);
    expect(logs).toContain("ISSUE-000009-001: Failed");
    expect(logs).toContain("Error: git commit failed for ISSUE-000009-001");
    expect(logs).toContain("ISSUE-000009-002: Fixed");
    expect(logs).toContain("Summary: Fixed=1 Failed=1");
  });

  // US-005-AC01/AC02/AC03: report per-issue pass/fail and summary in terminal-verifiable output
  test("US-005: logs `{issueId}: Fixed|Failed` lines per issue and a summary with fixed/failed totals", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeIssues(projectRoot, "000009", [
      { id: "ISSUE-000009-001", title: "First", description: "one", status: "open" },
      { id: "ISSUE-000009-002", title: "Second", description: "two", status: "open" },
      { id: "ISSUE-000009-003", title: "Third", description: "three", status: "open" },
    ]);

    const logs: string[] = [];
    let commitAttempt = 0;

    await withCwd(projectRoot, async () => {
      await runExecuteAutomatedFix(
        { provider: "codex", iterations: 2 },
        {
          loadSkillFn: async () => "debug workflow",
          invokeAgentFn: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
          runCommitFn: async () => {
            commitAttempt += 1;
            return commitAttempt === 1 ? 0 : 1;
          },
          logFn: (message) => logs.push(message),
          nowFn: () => new Date("2026-02-22T15:00:00.000Z"),
        },
      );
    });

    // AC01: one status line per processed issue using the required format
    const statusLines = logs.filter((line) => /^ISSUE-\d{6}-\d{3}: (Fixed|Failed)$/.test(line));
    expect(statusLines).toHaveLength(2);
    expect(statusLines).toContain("ISSUE-000009-001: Fixed");
    expect(statusLines).toContain("ISSUE-000009-002: Failed");

    // AC02: summary includes fixed and failed totals
    expect(logs).toContain("Summary: Fixed=1 Failed=1");

    // AC03: result is directly verifiable from terminal-style output lines
    expect(logs).toContain("Processed 2 open issue(s) at 2026-02-22T15:00:00.000Z");
  });

  test("throws deterministic validation error for malformed issues JSON", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000009");
    await writeFile(join(projectRoot, ".agents", "flow", "it_000009_ISSUES.json"), "{not-json", "utf8");

    await withCwd(projectRoot, async () => {
      await expect(runExecuteAutomatedFix({ provider: "codex" })).rejects.toThrow(
        "Deterministic validation error: invalid issues JSON in .agents/flow/it_000009_ISSUES.json.",
      );
    });
  });
});

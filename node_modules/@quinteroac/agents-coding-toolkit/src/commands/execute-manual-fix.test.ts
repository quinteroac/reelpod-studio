import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeState } from "../state";
import { buildManualFixGuidancePrompt, runExecuteManualFix } from "./execute-manual-fix";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-execute-manual-fix-"));
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

async function seedState(projectRoot: string, iteration = "000010") {
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
    last_updated: "2026-02-23T00:00:00.000Z",
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

describe("execute manual-fix command", () => {
  test("registers execute manual-fix command in CLI", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runExecuteManualFix } from "./commands/execute-manual-fix";');
    expect(source).toContain('if (subcommand === "manual-fix") {');
    expect(source).toContain("await runExecuteManualFix({ provider });");
    expect(source).toContain("execute manual-fix --agent <provider>");
  });

  test("CLI exits with code 1 when --agent is missing", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "execute", "manual-fix"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required --agent <provider> argument.");
  });

  test("CLI accepts --agent and rejects unknown providers", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "execute", "manual-fix", "--agent", "invalid-provider"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown agent provider");
  });

  test("scans issues for current iteration, filters manual-fix status, prints count, and prompts to proceed", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000010");
    await writeIssues(projectRoot, "000010", [
      { id: "ISSUE-000010-001", title: "Open", description: "skip", status: "open" },
      { id: "ISSUE-000010-002", title: "Manual A", description: "take", status: "manual-fix" },
      { id: "ISSUE-000010-003", title: "Retry", description: "skip", status: "retry" },
      { id: "ISSUE-000010-004", title: "Manual B", description: "take", status: "manual-fix" },
    ]);

    const logs: string[] = [];
    const prompts: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteManualFix(
        { provider: "codex" },
        {
          logFn: (message) => logs.push(message),
          promptProceedFn: async (question) => {
            prompts.push(question);
            return false;
          },
        },
      );
    });

    expect(logs).toContain(
      "Found 2 issue(s) with status 'manual-fix' in .agents/flow/it_000010_ISSUES.json.",
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Proceed with manual-fix processing for 2 issue(s)");
    expect(logs).toContain("Manual-fix execution cancelled.");
  });

  test("presents manual-fix issues one by one and runs interactive guidance for each issue", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000010");
    await writeIssues(projectRoot, "000010", [
      { id: "ISSUE-000010-001", title: "Open", description: "skip", status: "open" },
      { id: "ISSUE-000010-002", title: "Manual A", description: "first manual", status: "manual-fix" },
      { id: "ISSUE-000010-003", title: "Retry", description: "skip", status: "retry" },
      { id: "ISSUE-000010-004", title: "Manual B", description: "second manual", status: "manual-fix" },
    ]);

    const logs: string[] = [];
    const prompts: string[] = [];
    const outcomePrompts: string[] = [];
    const interactiveFlags: Array<boolean | undefined> = [];
    const providersUsed: string[] = [];
    const outcomes: Array<"fixed" | "skip" | "exit"> = ["skip", "skip"];

    await withCwd(projectRoot, async () => {
      await runExecuteManualFix(
        { provider: "codex" },
        {
          logFn: (message) => logs.push(message),
          promptProceedFn: async () => true,
          promptIssueOutcomeFn: async (question) => {
            outcomePrompts.push(question);
            return outcomes.shift() ?? "skip";
          },
          invokeAgentFn: async (options) => {
            prompts.push(options.prompt);
            interactiveFlags.push(options.interactive);
            providersUsed.push(options.provider);
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(logs).toContain(
      "Found 2 issue(s) with status 'manual-fix' in .agents/flow/it_000010_ISSUES.json.",
    );
    expect(logs).toContain("Ready to process 2 manual-fix issue(s).");
    expect(logs).toContain("Issue 1/2: ISSUE-000010-002 - Manual A");
    expect(logs).toContain("Issue 2/2: ISSUE-000010-004 - Manual B");

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Issue ID: ISSUE-000010-002");
    expect(prompts[1]).toContain("Issue ID: ISSUE-000010-004");

    expect(interactiveFlags).toEqual([true, true]);
    expect(providersUsed).toEqual(["codex", "codex"]);
    expect(outcomePrompts).toEqual([
      "Action? (f)ixed, (s)kip, (e)xit: ",
      "Action? (f)ixed, (s)kip, (e)xit: ",
    ]);
  });

  test("buildManualFixGuidancePrompt requires summary, reproduction strategy, fixes, and interactive Q&A loop", () => {
    const prompt = buildManualFixGuidancePrompt(
      {
        id: "ISSUE-000010-002",
        title: "Manual A",
        description: "Service returns 500 on malformed payload.",
        status: "manual-fix",
      },
      "000010",
    );

    expect(prompt).toContain("Iteration: 000010");
    expect(prompt).toContain("Issue ID: ISSUE-000010-002");
    expect(prompt).toContain("Start with a concise summary/analysis of the problem.");
    expect(prompt).toContain("Suggest a concrete reproduction strategy or test case.");
    expect(prompt).toContain("Suggest potential fixes or code changes with rationale.");
    expect(prompt).toContain("continue in an interactive chat loop");
    expect(prompt).toContain("Answer clarifying questions.");
    expect(prompt).toContain("Provide code snippets when requested.");
  });

  test("US-003-AC02/AC04: marks issue fixed and persists updated status immediately", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000010");
    await writeIssues(projectRoot, "000010", [
      { id: "ISSUE-000010-001", title: "Manual A", description: "fix me", status: "manual-fix" },
      { id: "ISSUE-000010-002", title: "Manual B", description: "keep", status: "manual-fix" },
    ]);

    const writes: string[] = [];
    await withCwd(projectRoot, async () => {
      await runExecuteManualFix(
        { provider: "codex" },
        {
          promptProceedFn: async () => true,
          promptIssueOutcomeFn: async () => "fixed",
          invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          writeFileFn: async (path, data, options) => {
            writes.push(String(data));
            await writeFile(path, data, options);
          },
        },
      );
    });

    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]).toContain('"id": "ISSUE-000010-001"');
    expect(writes[0]).toContain('"status": "fixed"');

    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000010_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ id: string; status: string }>;
    expect(issues.find((issue) => issue.id === "ISSUE-000010-001")?.status).toBe("fixed");
  });

  test("US-003-AC03: skip leaves issue status as manual-fix and continues", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000010");
    await writeIssues(projectRoot, "000010", [
      { id: "ISSUE-000010-001", title: "Manual A", description: "first", status: "manual-fix" },
      { id: "ISSUE-000010-002", title: "Manual B", description: "second", status: "manual-fix" },
    ]);

    let invokeCount = 0;
    const responses: Array<"fixed" | "skip" | "exit"> = ["skip", "skip"];
    await withCwd(projectRoot, async () => {
      await runExecuteManualFix(
        { provider: "codex" },
        {
          promptProceedFn: async () => true,
          promptIssueOutcomeFn: async () => responses.shift() ?? "skip",
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(invokeCount).toBe(2);
    const issuesRaw = await readFile(join(projectRoot, ".agents", "flow", "it_000010_ISSUES.json"), "utf8");
    const issues = JSON.parse(issuesRaw) as Array<{ status: string }>;
    expect(issues[0]?.status).toBe("manual-fix");
    expect(issues[1]?.status).toBe("manual-fix");
  });

  test("US-003-AC01: prompts Mark as fixed/Skip/Exit and supports Exit to stop processing", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000010");
    await writeIssues(projectRoot, "000010", [
      { id: "ISSUE-000010-001", title: "Manual A", description: "first", status: "manual-fix" },
      { id: "ISSUE-000010-002", title: "Manual B", description: "second", status: "manual-fix" },
    ]);

    const outcomePrompts: string[] = [];
    let invokeCount = 0;
    await withCwd(projectRoot, async () => {
      await runExecuteManualFix(
        { provider: "codex" },
        {
          promptProceedFn: async () => true,
          promptIssueOutcomeFn: async (question) => {
            outcomePrompts.push(question);
            return "exit";
          },
          invokeAgentFn: async () => {
            invokeCount += 1;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(outcomePrompts).toEqual(["Action? (f)ixed, (s)kip, (e)xit: "]);
    expect(invokeCount).toBe(1);
  });

  test("TC-003: handles 0 manual-fix issues gracefully", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "000010");
    await writeIssues(projectRoot, "000010", [
      { id: "ISSUE-000010-001", title: "Open", description: "skip", status: "open" },
    ]);

    const logs: string[] = [];
    const prompts: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteManualFix(
        { provider: "codex" },
        {
          logFn: (message) => logs.push(message),
          promptProceedFn: async (question) => {
            prompts.push(question);
            return true; // Say yes to proceed
          },
        },
      );
    });

    expect(logs).toContain("Found 0 issue(s) with status 'manual-fix' in .agents/flow/it_000010_ISSUES.json.");
    expect(prompts[0]).toContain("Proceed with manual-fix processing for 0 issue(s)");
    expect(logs).toContain("No manual-fix issues to process. Exiting without changes.");
  });
});

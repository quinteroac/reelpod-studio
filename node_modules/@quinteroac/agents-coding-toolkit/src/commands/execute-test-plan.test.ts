import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseProvider, type AgentResult } from "../agent";
import { readState, writeState } from "../state";
import { runExecuteTestPlan, type ManualTestUserInput } from "./execute-test-plan";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-execute-test-plan-"));
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

async function seedState(
  projectRoot: string,
  tpStatus: "pending" | "created",
  tpFile: string | null,
) {
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });

  await writeState(projectRoot, {
    current_iteration: "000005",
    current_phase: "prototype",
    phases: {
      define: {
        requirement_definition: { status: "approved", file: "it_000005_product-requirement-document.md" },
        prd_generation: { status: "completed", file: "it_000005_PRD.json" },
      },
      prototype: {
        project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
        test_plan: { status: "created", file: "it_000005_test-plan.md" },
        tp_generation: { status: tpStatus, file: tpFile },
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
    last_updated: "2026-02-21T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  });
}

async function writeProjectContext(projectRoot: string, content = "# Project Context\n- use bun:test\n") {
  await writeFile(join(projectRoot, ".agents", "PROJECT_CONTEXT.md"), content, "utf8");
}

async function writeApprovedTpJson(projectRoot: string, fileName: string) {
  const tpPath = join(projectRoot, ".agents", "flow", fileName);
  await writeFile(
    tpPath,
    JSON.stringify(
      {
        overallStatus: "pending",
        scope: ["Scope A"],
        environmentData: ["Env A"],
        automatedTests: [
          {
            id: "TC-US001-01",
            description: "Automated case one",
            status: "pending",
            correlatedRequirements: ["US-001", "FR-1"],
          },
          {
            id: "TC-US001-02",
            description: "Automated case two",
            status: "pending",
            correlatedRequirements: ["US-001", "FR-2"],
          },
        ],
        exploratoryManualTests: [
          {
            id: "TC-US001-03",
            description: "Manual case",
            status: "pending",
            correlatedRequirements: ["US-001", "FR-3"],
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("execute test-plan command", () => {
  test("registers execute test-plan command in CLI dispatch with --agent provider", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runExecuteTestPlan } from "./commands/execute-test-plan";');
    expect(source).toContain("if (command === \"execute\") {");
    expect(source).toContain('if (subcommand === "test-plan") {');
    expect(source).toContain("const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));");
    expect(source).toContain("await runExecuteTestPlan({ provider, force });");
    expect(source).toContain("execute test-plan --agent <provider>");
  });

  test("fails when tp_generation.status is not created", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "pending", "it_000005_TP.json");
    await writeProjectContext(projectRoot);

    await withCwd(projectRoot, async () => {
      await expect(runExecuteTestPlan({ provider: "codex" })).rejects.toThrow(
        "Cannot execute test plan: prototype.tp_generation.status must be created. Current status: 'pending'. Run `bun nvst approve test-plan` first.",
      );
    });
  });

  // AC01: automated tests with status != passed are collected and sent to a single agent invocation
  // AC02: agent prompt includes full list of pending automated test cases as JSON array
  // AC03: agent returns JSON array of results with {testCaseId, status, evidence, notes}
  // AC04: each result recorded in progress file and as separate artifact
  test("batches all pending automated tests into a single agent invocation with JSON array prompt and results", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot, "# Project Context\nUse bun test and tsc checks.\n");
    await writeApprovedTpJson(projectRoot, tpFileName);

    let batchInvocationCount = 0;
    let manualPromptCount = 0;
    let capturedBatchPrompt = "";

    const capturedLogs: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      capturedLogs.push(args.map((arg) => String(arg)).join(" "));
    };

    try {
      await withCwd(projectRoot, async () => {
        await runExecuteTestPlan(
          { provider: "gemini" },
          {
            loadSkillFn: async (_projectRoot, skillName) => {
              if (skillName === "execute-test-batch") return "Run batch test cases and output strict JSON array.";
              return "Run this test case and output strict JSON.";
            },
            invokeAgentFn: async (options): Promise<AgentResult> => {
              expect(options.interactive).toBe(false);

              // AC02: batch prompt includes test_cases context with JSON array
              batchInvocationCount += 1;
              capturedBatchPrompt = options.prompt;

              // Verify prompt contains both automated test case IDs
              expect(options.prompt).toContain("TC-US001-01");
              expect(options.prompt).toContain("TC-US001-02");
              // Should NOT contain manual test in batch prompt
              expect(options.prompt).not.toContain("TC-US001-03");
              expect(options.prompt).toContain("### project_context");
              expect(options.prompt).toContain("Use bun test and tsc checks.");

              // AC03: return JSON array of results
              return {
                exitCode: 0,
                stdout: JSON.stringify([
                  {
                    testCaseId: "TC-US001-01",
                    status: "passed",
                    evidence: "Batch evidence for case one",
                    notes: "Batch executed successfully",
                  },
                  {
                    testCaseId: "TC-US001-02",
                    status: "passed",
                    evidence: "Batch evidence for case two",
                    notes: "Batch executed successfully",
                  },
                ]),
                stderr: "",
              };
            },
            promptManualTestFn: async () => {
              manualPromptCount += 1;
              return { status: "passed", evidence: "Manual evidence", notes: "Manual executed successfully" };
            },
          },
        );
      });
    } finally {
      console.log = originalConsoleLog;
    }

    // AC01: single invocation for automated tests
    expect(batchInvocationCount).toBe(1);
    // Manual tests prompted individually to user
    expect(manualPromptCount).toBe(1);

    // AC02: batch prompt includes JSON array of test cases
    expect(capturedBatchPrompt).toContain("### test_cases");
    const testCasesMatch = capturedBatchPrompt.split("### test_cases")[1];
    expect(testCasesMatch).toBeDefined();
    // The test_cases context should contain a valid JSON array
    const testCasesJson = testCasesMatch!.split("###")[0].trim();
    const parsedTestCases = JSON.parse(testCasesJson) as Array<{ id: string }>;
    expect(parsedTestCases).toHaveLength(2);
    expect(parsedTestCases[0]?.id).toBe("TC-US001-01");
    expect(parsedTestCases[1]?.id).toBe("TC-US001-02");

    expect(capturedLogs.at(-1)).toContain("3/3 tests passed, 0 failed");

    // AC04: each result recorded as separate artifact
    const reportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const report = JSON.parse(reportRaw) as {
      executedTestIds: string[];
      results: Array<{
        testCaseId: string;
        description: string;
        correlatedRequirements: string[];
        payload: { status: string; evidence: string; notes: string };
        artifactReferences: string[];
      }>;
    };

    expect(report.executedTestIds).toEqual(["TC-US001-01", "TC-US001-02", "TC-US001-03"]);
    expect(report.results).toHaveLength(3);
    expect(report.results[0]?.payload).toEqual({
      status: "passed",
      evidence: "Batch evidence for case one",
      notes: "Batch executed successfully",
    });
    expect(report.results[0]?.description).toBe("Automated case one");
    expect(report.results[0]?.correlatedRequirements).toEqual(["US-001", "FR-1"]);
    expect(report.results[0]?.artifactReferences).toHaveLength(1);

    // AC04: separate artifact per test case
    const artifactsDirPath = join(projectRoot, ".agents", "flow", "it_000005_test-execution-artifacts");
    const artifactFileNames = await readdir(artifactsDirPath);
    expect(artifactFileNames.length).toBe(3);
    for (const result of report.results) {
      expect(result.artifactReferences.length).toBeGreaterThan(0);
      for (const artifactReference of result.artifactReferences) {
        const artifactRaw = await readFile(join(projectRoot, artifactReference), "utf8");
        const artifact = JSON.parse(artifactRaw) as {
          testCaseId: string;
          attemptNumber: number;
          prompt: string;
          agentExitCode: number;
        };
        expect(artifact.testCaseId).toBe(result.testCaseId);
        expect(artifact.attemptNumber).toBe(1);
        expect(artifact.agentExitCode).toBe(0);
      }
    }

    // AC04: progress file records each individual test
    const progressRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-progress.json"),
      "utf8",
    );
    const progress = JSON.parse(progressRaw) as {
      entries: Array<{
        id: string;
        type: "automated" | "exploratory_manual";
        status: "pending" | "in_progress" | "passed" | "failed";
        attempt_count: number;
        last_agent_exit_code: number | null;
        last_error_summary: string;
      }>;
    };

    expect(progress.entries).toHaveLength(3);
    expect(progress.entries[0]).toMatchObject({
      id: "TC-US001-01",
      type: "automated",
      status: "passed",
      attempt_count: 1,
      last_agent_exit_code: 0,
      last_error_summary: "",
    });
    expect(progress.entries[1]).toMatchObject({
      id: "TC-US001-02",
      type: "automated",
      status: "passed",
      attempt_count: 1,
    });
    expect(progress.entries[2]).toMatchObject({
      id: "TC-US001-03",
      type: "exploratory_manual",
      status: "passed",
      attempt_count: 1,
    });

    const markdownReportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-report.md"),
      "utf8",
    );
    expect(markdownReportRaw).toContain("# Test Execution Report");
    expect(markdownReportRaw).toContain("**Iteration:** it_000005");
    expect(markdownReportRaw).toContain("**Total:** 3");
    expect(markdownReportRaw).toContain("**Passed:** 3");
    expect(markdownReportRaw).toContain("**Failed:** 0");

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_execution.status).toBe("completed");
    expect(state.phases.prototype.prototype_approved).toBe(false);
    expect(state.updated_by).toBe("nvst:execute-test-plan");
  });

  // AC05: if agent session fails (non-zero exit), all automated tests in batch marked as failed with invocation_failed
  test("marks all automated tests as failed with invocation_failed when batch agent session fails", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "created", "it_000005_TP.json");
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, "it_000005_TP.json");

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            // Batch invocation fails
            return { exitCode: 1, stdout: "", stderr: "agent crashed" };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "ok" };
          },
        },
      );
    });

    const reportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const report = JSON.parse(reportRaw) as {
      results: Array<{
        testCaseId: string;
        payload: { status: string; notes: string };
        passFail: "pass" | "fail" | null;
        agentExitCode: number;
      }>;
    };

    // Both automated tests marked as invocation_failed
    expect(report.results[0]?.payload.status).toBe("invocation_failed");
    expect(report.results[0]?.payload.notes).toContain("Agent invocation failed with exit code 1");
    expect(report.results[0]?.passFail).toBeNull();
    expect(report.results[0]?.agentExitCode).toBe(1);

    expect(report.results[1]?.payload.status).toBe("invocation_failed");
    expect(report.results[1]?.passFail).toBeNull();
    expect(report.results[1]?.agentExitCode).toBe(1);

    // Manual test still passed (via user prompt)
    expect(report.results[2]?.payload.status).toBe("passed");
    expect(report.results[2]?.passFail).toBe("pass");

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_execution.status).toBe("failed");
  });

  // AC06: if agent returns partial results, unmatched tests marked as failed
  test("marks unmatched automated tests as failed when agent returns partial batch results", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "created", "it_000005_TP.json");
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, "it_000005_TP.json");

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "codex" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            // Return results for only the first test case (partial)
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  testCaseId: "TC-US001-01",
                  status: "passed",
                  evidence: "First test ok",
                  notes: "Passed",
                },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "ok" };
          },
        },
      );
    });

    const reportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const report = JSON.parse(reportRaw) as {
      results: Array<{
        testCaseId: string;
        payload: { status: string; evidence: string; notes: string };
        passFail: "pass" | "fail" | null;
      }>;
    };

    // First automated test passed
    expect(report.results[0]?.testCaseId).toBe("TC-US001-01");
    expect(report.results[0]?.payload.status).toBe("passed");
    expect(report.results[0]?.passFail).toBe("pass");

    // Second automated test: no result from agent -> failed
    expect(report.results[1]?.testCaseId).toBe("TC-US001-02");
    expect(report.results[1]?.payload.status).toBe("failed");
    expect(report.results[1]?.payload.notes).toContain("No result returned by agent");
    expect(report.results[1]?.passFail).toBe("fail");

    // Manual test still passed
    expect(report.results[2]?.testCaseId).toBe("TC-US001-03");
    expect(report.results[2]?.payload.status).toBe("passed");

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_execution.status).toBe("failed");
  });

  // AC07: resume behavior preserved - already-passed automated tests excluded from batch
  test("excludes already-passed automated tests from the batch on resume", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      // First run: first automated test passes, second fails
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  testCaseId: "TC-US001-01",
                  status: "passed",
                  evidence: "ok",
                  notes: "ok",
                },
                {
                  testCaseId: "TC-US001-02",
                  status: "failed",
                  evidence: "assertion mismatch",
                  notes: "failed on second case",
                },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "ok" };
          },
        },
      );

      // Second run: only the failed test should be in the batch
      let rerunBatchPrompt = "";
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            rerunBatchPrompt = options.prompt;
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  testCaseId: "TC-US001-02",
                  status: "passed",
                  evidence: "retry ok",
                  notes: "retry succeeded",
                },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            // Manual test already passed, should not be called
            throw new Error("Should not prompt for already-passed manual test");
          },
        },
      );

      // AC07: already-passed TC-US001-01 excluded from batch
      expect(rerunBatchPrompt).toContain("TC-US001-02");
      expect(rerunBatchPrompt).not.toContain("TC-US001-01");
    });

    // After retry, all pass -> test execution completed but prototype_approved requires explicit approve
    const stateAfterRetry = await readState(projectRoot);
    expect(stateAfterRetry.phases.prototype.prototype_approved).toBe(false);

    const progressRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-progress.json"),
      "utf8",
    );
    const progress = JSON.parse(progressRaw) as {
      entries: Array<{ id: string; status: string; attempt_count: number }>;
    };

    expect(progress.entries.find((entry) => entry.id === "TC-US001-01")).toMatchObject({
      status: "passed",
      attempt_count: 1,
    });
    expect(progress.entries.find((entry) => entry.id === "TC-US001-02")).toMatchObject({
      status: "passed",
      attempt_count: 2,
    });
    expect(progress.entries.find((entry) => entry.id === "TC-US001-03")).toMatchObject({
      status: "passed",
      attempt_count: 1,
    });
  });

  test("derives pass/fail from payload status for automated batch and manual user input", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "created", "it_000005_TP.json");
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, "it_000005_TP.json");

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  testCaseId: "TC-US001-01",
                  status: "failed",
                  evidence: "Assertion mismatch",
                  notes: "Expected error message not found",
                },
                {
                  testCaseId: "TC-US001-02",
                  status: "skipped",
                  evidence: "",
                  notes: "Blocked by missing credentials",
                },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "failed", evidence: "UI broken", notes: "Button not clickable" };
          },
        },
      );
    });

    const reportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const report = JSON.parse(reportRaw) as {
      results: Array<{
        testCaseId: string;
        payload: { status: string; evidence: string; notes: string };
        passFail: "pass" | "fail" | null;
        agentExitCode: number;
      }>;
    };

    expect(report.results[0]?.payload.status).toBe("failed");
    expect(report.results[0]?.passFail).toBe("fail");

    expect(report.results[1]?.payload.status).toBe("skipped");
    expect(report.results[1]?.passFail).toBeNull();

    // Manual test: user reported failed
    expect(report.results[2]?.payload.status).toBe("failed");
    expect(report.results[2]?.payload.evidence).toBe("UI broken");
    expect(report.results[2]?.payload.notes).toBe("Button not clickable");
    expect(report.results[2]?.passFail).toBe("fail");
    expect(report.results[2]?.agentExitCode).toBe(0);

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_execution.status).toBe("failed");
  });

  test("supports claude, codex, gemini, and cursor providers", () => {
    expect(parseProvider("claude")).toBe("claude");
    expect(parseProvider("codex")).toBe("codex");
    expect(parseProvider("gemini")).toBe("gemini");
    expect(parseProvider("cursor")).toBe("cursor");
  });

  test("updates execution progress file after each test case result from batch", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    const progressSnapshots: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "codex" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "ok" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "ok" };
          },
          writeJsonArtifactFn: async (path, _schema, data) => {
            const pathAsString = path.toString();
            if (pathAsString.endsWith("it_000005_test-execution-progress.json")) {
              progressSnapshots.push(JSON.stringify(data, null, 2));
            }
            await writeFile(pathAsString, `${JSON.stringify(data, null, 2)}\n`, "utf8");
          },
        },
      );
    });

    // Progress should be written: initial, in_progress for batch, result per automated test, manual in_progress, manual result
    expect(progressSnapshots.length).toBeGreaterThanOrEqual(5);
    expect(progressSnapshots.at(-1)).toContain('"attempt_count": 1');
    expect(progressSnapshots.at(-1)).toContain('"status": "passed"');
  });

  test("fails with a descriptive error when execute-test-case skill is missing", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "created", "it_000005_TP.json");
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, "it_000005_TP.json");

    await withCwd(projectRoot, async () => {
      await expect(
        runExecuteTestPlan(
          { provider: "codex" },
          {
            loadSkillFn: async (_pr, name) => {
              if (name === "execute-test-case") throw new Error("missing");
              return "batch skill";
            },
          },
        ),
      ).rejects.toThrow(
        "Required skill missing: expected .agents/skills/execute-test-case/SKILL.md.",
      );
    });
  });

  test("fails with a descriptive error when execute-test-batch skill is missing", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    await seedState(projectRoot, "created", "it_000005_TP.json");
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, "it_000005_TP.json");

    await withCwd(projectRoot, async () => {
      await expect(
        runExecuteTestPlan(
          { provider: "codex" },
          {
            loadSkillFn: async (_pr, name) => {
              if (name === "execute-test-batch") throw new Error("missing");
              return "single skill";
            },
          },
        ),
      ).rejects.toThrow(
        "Required skill missing: expected .agents/skills/execute-test-batch/SKILL.md.",
      );
    });
  });

  test("handles batch with no pending automated tests (all already passed)", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      // First run: all pass
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "ok" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "ok" };
          },
        },
      );

      // Second run: no batch invocation should happen
      let batchCalled = false;
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            if (options.prompt.includes("test_cases")) {
              batchCalled = true;
            }
            return {
              exitCode: 0,
              stdout: JSON.stringify([]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            // Manual test already passed, should not be called
            throw new Error("Should not prompt for already-passed manual test");
          },
        },
      );

      expect(batchCalled).toBe(false);
    });
  });
});

describe("US-003: execute-test-case skill batch mode", () => {
  // US-003-AC01: skill accepts an array of test case definitions
  test("AC01: skill instructs agent to accept an array of test case definitions", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "execute-test-case",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source.startsWith("---\n")).toBe(true);
    expect(source).toContain("name: execute-test-case");
    expect(source).toContain("description:");
    expect(source).toContain("user-invocable: false");
    expect(source).toContain("`test_cases`");
    expect(source).toContain("`project_context`");
    expect(source).toContain("JSON array of test case objects");
  });

  // US-003-AC02: skill instructs return of JSON array with {testCaseId, status, evidence, notes}
  test("AC02: skill instructs agent to return JSON array with testCaseId, status, evidence, notes", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "execute-test-case",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source).toContain('"testCaseId"');
    expect(source).toContain('"status": "passed|failed|skipped"');
    expect(source).toContain('"evidence": "string"');
    expect(source).toContain('"notes": "string"');
    expect(source).toContain("Do not output markdown or additional text outside the JSON array.");
  });

  // US-003-AC03: skill states agent must execute each test in order and report individual results
  test("AC03: skill states agent must execute each test in order and report individual results", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "execute-test-case",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source).toContain("Execute each test case in order");
    expect(source).toContain("one result object per test case");
    expect(source).toContain("Every test case in the input must have a corresponding result in the output array.");
  });

  // US-003-AC04: backward references to single-test-case mode are removed
  test("AC04: no backward references to single-test-case mode in skill", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "execute-test-case",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source).not.toContain("Execute exactly one test case");
    expect(source).not.toContain("`test_case_definition`");
    expect(source).not.toContain("single test case");
    expect(source).not.toContain("outside the JSON object");
  });

  // US-003-AC04: backward references removed from production code
  test("AC04: unused single-test-case functions removed from production code", async () => {
    const source = await readFile(join(process.cwd(), "src", "commands", "execute-test-plan.ts"), "utf8");

    expect(source).not.toContain("function buildExecutionPrompt(");
    expect(source).not.toContain("function parseExecutionPayload(");
    expect(source).not.toContain("test_case_definition");
  });
});

describe("US-002: manual tests with user interaction", () => {
  // US-002-AC01: After automated tests complete, each pending manual test is presented sequentially
  test("presents pending manual tests sequentially after automated tests complete", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);

    // Test plan with two manual tests
    const tpPath = join(projectRoot, ".agents", "flow", tpFileName);
    await writeFile(
      tpPath,
      JSON.stringify({
        overallStatus: "pending",
        scope: ["Scope A"],
        environmentData: ["Env A"],
        automatedTests: [
          { id: "TC-AUTO-01", description: "Auto test", status: "pending", correlatedRequirements: ["US-001"] },
        ],
        exploratoryManualTests: [
          { id: "TC-MAN-01", description: "First manual test", status: "pending", correlatedRequirements: ["US-002", "FR-1"] },
          { id: "TC-MAN-02", description: "Second manual test", status: "pending", correlatedRequirements: ["US-002", "FR-2"] },
        ],
      }, null, 2) + "\n",
      "utf8",
    );

    const promptedTestIds: string[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-AUTO-01", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async (testCase) => {
            promptedTestIds.push(testCase.id);
            return { status: "passed", evidence: "Looks good", notes: "" };
          },
        },
      );
    });

    // AC01: both manual tests were prompted sequentially
    expect(promptedTestIds).toEqual(["TC-MAN-01", "TC-MAN-02"]);
  });

  // US-002-AC02: For each manual test, user sees test ID, description, correlated requirements, and expected result
  test("passes test ID, description, and correlated requirements to user prompt function", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    interface CapturedTestCase {
      id: string;
      description: string;
      correlatedRequirements: string[];
    }
    const capturedTestCases: CapturedTestCase[] = [];

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "ok" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async (testCase) => {
            capturedTestCases.push({
              id: testCase.id,
              description: testCase.description,
              correlatedRequirements: testCase.correlatedRequirements,
            });
            return { status: "passed", evidence: "ok", notes: "" };
          },
        },
      );
    });

    // AC02: prompt received the full test case info
    expect(capturedTestCases).toHaveLength(1);
    expect(capturedTestCases[0]?.id).toBe("TC-US001-03");
    expect(capturedTestCases[0]?.description).toBe("Manual case");
    expect(capturedTestCases[0]?.correlatedRequirements).toEqual(["US-001", "FR-3"]);
  });

  // US-002-AC03: user enters status, evidence, and notes
  test("records user-provided status, evidence, and notes for manual tests", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "ok" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return {
              status: "failed" as const,
              evidence: "Button did not respond to click",
              notes: "Tested on Chrome 120",
            };
          },
        },
      );
    });

    const reportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const report = JSON.parse(reportRaw) as {
      results: Array<{
        testCaseId: string;
        payload: { status: string; evidence: string; notes: string };
        passFail: "pass" | "fail" | null;
      }>;
    };

    const manualResult = report.results.find((r) => r.testCaseId === "TC-US001-03");
    expect(manualResult).toBeDefined();
    expect(manualResult!.payload.status).toBe("failed");
    expect(manualResult!.payload.evidence).toBe("Button did not respond to click");
    expect(manualResult!.payload.notes).toBe("Tested on Chrome 120");
    expect(manualResult!.passFail).toBe("fail");
  });

  // US-002-AC04: each manual test result recorded in progress file and as separate artifact
  test("records each manual test in progress file and writes artifact", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "ok" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "All good", notes: "Verified manually" };
          },
        },
      );
    });

    // Check progress file
    const progressRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-progress.json"),
      "utf8",
    );
    const progress = JSON.parse(progressRaw) as {
      entries: Array<{
        id: string;
        type: string;
        status: string;
        attempt_count: number;
        last_agent_exit_code: number | null;
      }>;
    };

    const manualEntry = progress.entries.find((e) => e.id === "TC-US001-03");
    expect(manualEntry).toBeDefined();
    expect(manualEntry!.type).toBe("exploratory_manual");
    expect(manualEntry!.status).toBe("passed");
    expect(manualEntry!.attempt_count).toBe(1);
    expect(manualEntry!.last_agent_exit_code).toBeNull();

    // Check artifact file
    const artifactsDirPath = join(projectRoot, ".agents", "flow", "it_000005_test-execution-artifacts");
    const artifactFileNames = await readdir(artifactsDirPath);
    const manualArtifact = artifactFileNames.find((name) => name.includes("TC-US001-03"));
    expect(manualArtifact).toBeDefined();

    const artifactRaw = await readFile(join(artifactsDirPath, manualArtifact!), "utf8");
    const artifact = JSON.parse(artifactRaw) as {
      testCaseId: string;
      attemptNumber: number;
      prompt: string;
      agentExitCode: number;
      payload: { status: string; evidence: string; notes: string };
    };
    expect(artifact.testCaseId).toBe("TC-US001-03");
    expect(artifact.attemptNumber).toBe(1);
    expect(artifact.prompt).toBe("manual-user-input");
    expect(artifact.agentExitCode).toBe(0);
    expect(artifact.payload.status).toBe("passed");
    expect(artifact.payload.evidence).toBe("All good");
    expect(artifact.payload.notes).toBe("Verified manually");
  });

  // US-002-AC05: resume behavior preserved - already-passed manual tests are skipped
  test("skips already-passed manual tests on resume", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);

    // Two manual tests
    const tpPath = join(projectRoot, ".agents", "flow", tpFileName);
    await writeFile(
      tpPath,
      JSON.stringify({
        overallStatus: "pending",
        scope: ["Scope A"],
        environmentData: ["Env A"],
        automatedTests: [],
        exploratoryManualTests: [
          { id: "TC-MAN-01", description: "First manual", status: "pending", correlatedRequirements: ["US-002"] },
          { id: "TC-MAN-02", description: "Second manual", status: "pending", correlatedRequirements: ["US-002"] },
        ],
      }, null, 2) + "\n",
      "utf8",
    );

    await withCwd(projectRoot, async () => {
      // First run: first passes, second fails
      let firstRunCount = 0;
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async () => "skill",
          invokeAgentFn: async (): Promise<AgentResult> => {
            return { exitCode: 0, stdout: JSON.stringify([]), stderr: "" };
          },
          promptManualTestFn: async (testCase) => {
            firstRunCount += 1;
            if (testCase.id === "TC-MAN-01") {
              return { status: "passed", evidence: "ok", notes: "" };
            }
            return { status: "failed", evidence: "broken", notes: "error" };
          },
        },
      );
      expect(firstRunCount).toBe(2);

      // Second run: only the failed test should be prompted
      const secondRunPromptedIds: string[] = [];
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async () => "skill",
          invokeAgentFn: async (): Promise<AgentResult> => {
            return { exitCode: 0, stdout: JSON.stringify([]), stderr: "" };
          },
          promptManualTestFn: async (testCase) => {
            secondRunPromptedIds.push(testCase.id);
            return { status: "passed", evidence: "fixed", notes: "" };
          },
        },
      );

      // AC05: already-passed TC-MAN-01 was skipped
      expect(secondRunPromptedIds).toEqual(["TC-MAN-02"]);
    });

    const progressRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-progress.json"),
      "utf8",
    );
    const progress = JSON.parse(progressRaw) as {
      entries: Array<{ id: string; status: string; attempt_count: number }>;
    };

    expect(progress.entries.find((e) => e.id === "TC-MAN-01")).toMatchObject({
      status: "passed",
      attempt_count: 1,
    });
    expect(progress.entries.find((e) => e.id === "TC-MAN-02")).toMatchObject({
      status: "passed",
      attempt_count: 2,
    });
  });

  // US-002-AC03: user can enter skipped status
  test("handles skipped status from manual user input", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "ok" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "ok" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "skipped", evidence: "", notes: "Not applicable for this environment" };
          },
        },
      );
    });

    const reportRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const report = JSON.parse(reportRaw) as {
      results: Array<{
        testCaseId: string;
        payload: { status: string; notes: string };
        passFail: "pass" | "fail" | null;
      }>;
    };

    const manualResult = report.results.find((r) => r.testCaseId === "TC-US001-03");
    expect(manualResult).toBeDefined();
    expect(manualResult!.payload.status).toBe("skipped");
    expect(manualResult!.passFail).toBeNull();
  });
});

describe("execute-test-batch skill definition", () => {
  test("includes required batch execution guidance and JSON array contract", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "execute-test-batch",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source.startsWith("---\n")).toBe(true);
    expect(source).toContain("name: execute-test-batch");
    expect(source).toContain("description:");
    expect(source).toContain("user-invocable: false");
    expect(source).toContain("`test_cases`");
    expect(source).toContain("`project_context`");
    expect(source).toContain('"testCaseId"');
    expect(source).toContain('"status": "passed|failed|skipped"');
    expect(source).toContain('"evidence": "string"');
    expect(source).toContain('"notes": "string"');
    expect(source).toContain("Do not output markdown or additional text outside the JSON array.");
  });
});

describe("US-004: preserve report and state tracking compatibility", () => {
  // US-004-AC01: progress file tracks all tests with correct statuses and attempt counts
  test("AC01: progress file tracks all tests (automated + manual) with correct statuses and attempt counts", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "" },
                { testCaseId: "TC-US001-02", status: "failed", evidence: "err", notes: "assertion fail" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "manual ok", notes: "" };
          },
        },
      );
    });

    const progressRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-progress.json"),
      "utf8",
    );
    const progress = JSON.parse(progressRaw) as {
      entries: Array<{
        id: string;
        type: string;
        status: string;
        attempt_count: number;
        last_agent_exit_code: number | null;
        last_error_summary: string;
        updated_at: string;
      }>;
    };

    // All three tests tracked
    expect(progress.entries).toHaveLength(3);

    // Automated passed test
    expect(progress.entries[0]).toMatchObject({
      id: "TC-US001-01",
      type: "automated",
      status: "passed",
      attempt_count: 1,
      last_agent_exit_code: 0,
      last_error_summary: "",
    });
    expect(progress.entries[0]!.updated_at).toBeTruthy();

    // Automated failed test
    expect(progress.entries[1]).toMatchObject({
      id: "TC-US001-02",
      type: "automated",
      status: "failed",
      attempt_count: 1,
      last_agent_exit_code: 0,
      last_error_summary: "assertion fail",
    });

    // Manual passed test
    expect(progress.entries[2]).toMatchObject({
      id: "TC-US001-03",
      type: "exploratory_manual",
      status: "passed",
      attempt_count: 1,
      last_agent_exit_code: null,
      last_error_summary: "",
    });
  });

  // US-004-AC01: attempt counts increment on retry
  test("AC01: attempt counts increment correctly on retries", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      // First run: one automated fails
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "" },
                { testCaseId: "TC-US001-02", status: "failed", evidence: "err", notes: "fail" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "" };
          },
        },
      );

      // Second run: retry fixes the failure
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-02", status: "passed", evidence: "retry ok", notes: "" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            throw new Error("Should not prompt for already-passed manual test");
          },
        },
      );
    });

    const progressRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-progress.json"),
      "utf8",
    );
    const progress = JSON.parse(progressRaw) as {
      entries: Array<{ id: string; attempt_count: number; status: string }>;
    };

    expect(progress.entries.find((e) => e.id === "TC-US001-01")).toMatchObject({
      attempt_count: 1,
      status: "passed",
    });
    expect(progress.entries.find((e) => e.id === "TC-US001-02")).toMatchObject({
      attempt_count: 2,
      status: "passed",
    });
    expect(progress.entries.find((e) => e.id === "TC-US001-03")).toMatchObject({
      attempt_count: 1,
      status: "passed",
    });
  });

  // US-004-AC02: execution artifacts written per test case per attempt with correct schema
  test("AC02: artifacts written per test case per attempt with correct directory structure and schema", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      // First run: one test fails
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "fine" },
                { testCaseId: "TC-US001-02", status: "failed", evidence: "err", notes: "broken" },
              ]),
              stderr: "some stderr",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "manual ok", notes: "verified" };
          },
        },
      );

      // Second run: retry the failed test
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-02", status: "passed", evidence: "fixed", notes: "ok now" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            throw new Error("Should not prompt for already-passed manual test");
          },
        },
      );
    });

    const artifactsDirPath = join(projectRoot, ".agents", "flow", "it_000005_test-execution-artifacts");
    const artifactFileNames = (await readdir(artifactsDirPath)).sort();

    // 3 from first run + 1 retry = 4 artifacts
    expect(artifactFileNames).toHaveLength(4);

    // Verify artifact file naming: {sanitized_id}_attempt_{padded_number}.json
    expect(artifactFileNames).toContain("TC-US001-01_attempt_001.json");
    expect(artifactFileNames).toContain("TC-US001-02_attempt_001.json");
    expect(artifactFileNames).toContain("TC-US001-02_attempt_002.json");
    expect(artifactFileNames).toContain("TC-US001-03_attempt_001.json");

    // Verify automated artifact schema
    const autoArtifactRaw = await readFile(
      join(artifactsDirPath, "TC-US001-01_attempt_001.json"),
      "utf8",
    );
    const autoArtifact = JSON.parse(autoArtifactRaw) as Record<string, unknown>;
    expect(autoArtifact).toHaveProperty("testCaseId", "TC-US001-01");
    expect(autoArtifact).toHaveProperty("attemptNumber", 1);
    expect(autoArtifact).toHaveProperty("prompt");
    expect(typeof autoArtifact.prompt).toBe("string");
    expect(autoArtifact).toHaveProperty("agentExitCode", 0);
    expect(autoArtifact).toHaveProperty("stdout");
    expect(autoArtifact).toHaveProperty("stderr", "some stderr");
    expect(autoArtifact).toHaveProperty("payload");
    const autoPayload = autoArtifact.payload as Record<string, unknown>;
    expect(autoPayload).toMatchObject({ status: "passed", evidence: "ok", notes: "fine" });

    // Verify manual artifact schema
    const manualArtifactRaw = await readFile(
      join(artifactsDirPath, "TC-US001-03_attempt_001.json"),
      "utf8",
    );
    const manualArtifact = JSON.parse(manualArtifactRaw) as Record<string, unknown>;
    expect(manualArtifact).toHaveProperty("testCaseId", "TC-US001-03");
    expect(manualArtifact).toHaveProperty("attemptNumber", 1);
    expect(manualArtifact).toHaveProperty("prompt", "manual-user-input");
    expect(manualArtifact).toHaveProperty("agentExitCode", 0);
    expect(manualArtifact).toHaveProperty("stdout");
    expect(manualArtifact).toHaveProperty("stderr", "");
    const manualPayload = manualArtifact.payload as Record<string, unknown>;
    expect(manualPayload).toMatchObject({ status: "passed", evidence: "manual ok", notes: "verified" });

    // Verify retry artifact has incremented attempt number
    const retryArtifactRaw = await readFile(
      join(artifactsDirPath, "TC-US001-02_attempt_002.json"),
      "utf8",
    );
    const retryArtifact = JSON.parse(retryArtifactRaw) as Record<string, unknown>;
    expect(retryArtifact).toHaveProperty("testCaseId", "TC-US001-02");
    expect(retryArtifact).toHaveProperty("attemptNumber", 2);
  });

  // US-004-AC03: markdown report and JSON results have identical structure
  test("AC03: markdown report and JSON results files generated with correct structure", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ev1", notes: "n1" },
                { testCaseId: "TC-US001-02", status: "failed", evidence: "ev2", notes: "n2" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "skipped", evidence: "", notes: "N/A" };
          },
        },
      );
    });

    // Verify JSON results structure
    const resultsRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const results = JSON.parse(resultsRaw) as Record<string, unknown>;

    expect(results).toHaveProperty("iteration", "000005");
    expect(results).toHaveProperty("testPlanFile", tpFileName);
    expect(results).toHaveProperty("executedTestIds");
    expect(Array.isArray(results.executedTestIds)).toBe(true);
    expect(results).toHaveProperty("results");
    expect(Array.isArray(results.results)).toBe(true);

    const resultEntries = results.results as Array<Record<string, unknown>>;
    expect(resultEntries).toHaveLength(3);

    // Verify each result has required fields
    for (const entry of resultEntries) {
      expect(entry).toHaveProperty("testCaseId");
      expect(entry).toHaveProperty("description");
      expect(entry).toHaveProperty("correlatedRequirements");
      expect(Array.isArray(entry.correlatedRequirements)).toBe(true);
      expect(entry).toHaveProperty("mode");
      expect(["automated", "exploratory_manual"]).toContain(entry.mode as string);
      expect(entry).toHaveProperty("payload");
      const payload = entry.payload as Record<string, unknown>;
      expect(payload).toHaveProperty("status");
      expect(payload).toHaveProperty("evidence");
      expect(payload).toHaveProperty("notes");
      expect(entry).toHaveProperty("passFail");
      expect([null, "pass", "fail"]).toContain(entry.passFail as string | null);
      expect(entry).toHaveProperty("agentExitCode");
      expect(typeof entry.agentExitCode).toBe("number");
      expect(entry).toHaveProperty("artifactReferences");
      expect(Array.isArray(entry.artifactReferences)).toBe(true);
    }

    // Verify passFail derivation
    expect(resultEntries[0]!.passFail).toBe("pass"); // passed -> pass
    expect(resultEntries[1]!.passFail).toBe("fail"); // failed -> fail
    expect(resultEntries[2]!.passFail).toBeNull(); // skipped -> null

    // Verify mode field
    expect(resultEntries[0]!.mode).toBe("automated");
    expect(resultEntries[1]!.mode).toBe("automated");
    expect(resultEntries[2]!.mode).toBe("exploratory_manual");

    // Verify markdown report structure
    const markdownRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-report.md"),
      "utf8",
    );

    expect(markdownRaw).toContain("# Test Execution Report");
    expect(markdownRaw).toContain("**Iteration:** it_000005");
    expect(markdownRaw).toContain("**Test Plan:** `it_000005_TP.json`");
    expect(markdownRaw).toContain("**Total:** 3");
    expect(markdownRaw).toContain("**Passed:** 1");
    expect(markdownRaw).toContain("**Failed:** 2");
    expect(markdownRaw).toContain("| Test ID | Description | Status | Correlated Requirements | Artifacts |");
    expect(markdownRaw).toContain("|---------|-------------|--------|------------------------|-----------|");
    // All three test cases appear in table
    expect(markdownRaw).toContain("TC-US001-01");
    expect(markdownRaw).toContain("TC-US001-02");
    expect(markdownRaw).toContain("TC-US001-03");
    // Artifact references present in table
    expect(markdownRaw).toContain("_attempt_001.json");
  });

  // US-004-AC04: state transitions follow the same rules
  test("AC04: state is in_progress during execution, completed when all pass", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    const stateSnapshots: Array<{ status: string; file: string | null }> = [];

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            // Capture state during execution
            const midState = await readState(projectRoot);
            stateSnapshots.push({
              status: midState.phases.prototype.test_execution.status,
              file: midState.phases.prototype.test_execution.file,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "" },
                { testCaseId: "TC-US001-02", status: "passed", evidence: "ok", notes: "" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "" };
          },
        },
      );
    });

    // During execution: in_progress
    expect(stateSnapshots).toHaveLength(1);
    expect(stateSnapshots[0]!.status).toBe("in_progress");
    expect(stateSnapshots[0]!.file).toBe("it_000005_test-execution-progress.json");

    // After execution (all passed): completed; prototype_approved requires explicit approve command
    const finalState = await readState(projectRoot);
    expect(finalState.phases.prototype.test_execution.status).toBe("completed");
    expect(finalState.phases.prototype.test_execution.file).toBe("it_000005_test-execution-progress.json");
    expect(finalState.phases.prototype.prototype_approved).toBe(false);
    expect(finalState.updated_by).toBe("nvst:execute-test-plan");
  });

  test("AC04: state is failed when any test fails", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "" },
                { testCaseId: "TC-US001-02", status: "failed", evidence: "err", notes: "fail" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "" };
          },
        },
      );
    });

    const finalState = await readState(projectRoot);
    expect(finalState.phases.prototype.test_execution.status).toBe("failed");
    expect(finalState.phases.prototype.prototype_approved).toBe(false);
    expect(finalState.phases.prototype.test_execution.file).toBe("it_000005_test-execution-progress.json");
    expect(finalState.updated_by).toBe("nvst:execute-test-plan");
  });

  test("AC04: state is failed when agent invocation fails", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return { exitCode: 1, stdout: "", stderr: "crashed" };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "" };
          },
        },
      );
    });

    const finalState = await readState(projectRoot);
    expect(finalState.phases.prototype.test_execution.status).toBe("failed");
  });

  // US-004-AC03: executedTestIds in JSON results tracks only tests run in this execution
  test("AC03: executedTestIds tracks only tests executed in current run, not previously passed", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);

    const tpFileName = "it_000005_TP.json";
    await seedState(projectRoot, "created", tpFileName);
    await writeProjectContext(projectRoot);
    await writeApprovedTpJson(projectRoot, tpFileName);

    await withCwd(projectRoot, async () => {
      // First run: one automated fails
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-01", status: "passed", evidence: "ok", notes: "" },
                { testCaseId: "TC-US001-02", status: "failed", evidence: "err", notes: "fail" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            return { status: "passed", evidence: "ok", notes: "" };
          },
        },
      );

      // Second run: only failed test retried
      await runExecuteTestPlan(
        { provider: "claude" },
        {
          loadSkillFn: async (_pr, name) => {
            if (name === "execute-test-batch") return "batch skill";
            return "single skill";
          },
          invokeAgentFn: async (): Promise<AgentResult> => {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                { testCaseId: "TC-US001-02", status: "passed", evidence: "fixed", notes: "" },
              ]),
              stderr: "",
            };
          },
          promptManualTestFn: async () => {
            throw new Error("Should not prompt");
          },
        },
      );
    });

    const resultsRaw = await readFile(
      join(projectRoot, ".agents", "flow", "it_000005_test-execution-results.json"),
      "utf8",
    );
    const results = JSON.parse(resultsRaw) as {
      executedTestIds: string[];
      results: Array<{ testCaseId: string }>;
    };

    // Only TC-US001-02 was executed in the second run
    expect(results.executedTestIds).toEqual(["TC-US001-02"]);
    // But all results are still present
    expect(results.results).toHaveLength(3);
    expect(results.results.map((r) => r.testCaseId)).toEqual(["TC-US001-01", "TC-US001-02", "TC-US001-03"]);
  });
});

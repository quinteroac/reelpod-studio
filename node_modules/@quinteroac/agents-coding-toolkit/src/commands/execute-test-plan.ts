import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { z } from "zod";

import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { assertGuardrail } from "../guardrail";
import { applyStatusUpdate, idsMatchExactly, sortedValues } from "../progress-utils";
import { exists, FLOW_REL_DIR, readState, writeState } from "../state";
import { writeJsonArtifact, type WriteJsonArtifactFn } from "../write-json-artifact";
import { TestPlanSchema, type TestPlan } from "../../scaffold/schemas/tmpl_test-plan";
import {
  TestExecutionProgressSchema,
  type TestExecutionProgress,
} from "../../scaffold/schemas/tmpl_test-execution-progress";
import { extractJson } from "./create-issue";

export interface ExecuteTestPlanOptions {
  provider: AgentProvider;
  force?: boolean;
}

const ExecutionPayloadSchema = z.object({
  status: z.enum(["passed", "failed", "skipped"]),
  evidence: z.string(),
  notes: z.string(),
});

type ExecutionPayload = z.infer<typeof ExecutionPayloadSchema>;

const BatchResultItemSchema = z.object({
  testCaseId: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  evidence: z.string(),
  notes: z.string(),
});

const BatchResultSchema = z.array(BatchResultItemSchema);

type BatchResultItem = z.infer<typeof BatchResultItemSchema>;

interface FlatTestCase {
  id: string;
  description: string;
  mode: "automated" | "exploratory_manual";
  correlatedRequirements: string[];
}

export interface ManualTestUserInput {
  status: "passed" | "failed" | "skipped";
  evidence: string;
  notes: string;
}

async function promptManualTest(testCase: FlatTestCase): Promise<ManualTestUserInput> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("");
    console.log("─".repeat(60));
    console.log(`Manual Test: ${testCase.id}`);
    console.log(`Description: ${testCase.description}`);
    console.log(`Correlated Requirements: ${testCase.correlatedRequirements.join(", ")}`);
    console.log(`Expected Result: ${testCase.description}`);
    console.log("─".repeat(60));

    let status: "passed" | "failed" | "skipped" | undefined;
    while (!status) {
      const answer = await rl.question("Status (passed / failed / skipped): ");
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "passed" || trimmed === "failed" || trimmed === "skipped") {
        status = trimmed;
      } else {
        console.log("Invalid status. Please enter: passed, failed, or skipped.");
      }
    }

    const evidence = (await rl.question("Evidence (what you observed): ")).trim();
    const notes = (await rl.question("Notes (optional, press Enter to skip): ")).trim();

    return { status, evidence, notes };
  } finally {
    rl.close();
  }
}

interface TestExecutionResult {
  testCaseId: string;
  description: string;
  correlatedRequirements: string[];
  mode: "automated" | "exploratory_manual";
  payload: {
    status: "passed" | "failed" | "skipped" | "invocation_failed";
    evidence: string;
    notes: string;
  };
  passFail: "pass" | "fail" | null;
  agentExitCode: number;
  artifactReferences: string[];
}

interface TestExecutionReport {
  iteration: string;
  testPlanFile: string;
  executedTestIds: string[];
  results: TestExecutionResult[];
}

interface ExecuteTestPlanDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  mkdirFn: typeof mkdir;
  nowFn: () => Date;
  promptManualTestFn: (testCase: FlatTestCase) => Promise<ManualTestUserInput>;
  readFileFn: typeof readFile;
  writeFileFn: typeof Bun.write;
  writeJsonArtifactFn: WriteJsonArtifactFn;
}

const defaultDeps: ExecuteTestPlanDeps = {
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  mkdirFn: mkdir,
  nowFn: () => new Date(),
  promptManualTestFn: promptManualTest,
  readFileFn: readFile,
  writeFileFn: Bun.write,
  writeJsonArtifactFn: writeJsonArtifact,
};

function flattenTests(testPlan: TestPlan): FlatTestCase[] {
  const automated = testPlan.automatedTests.map((item) => ({
    id: item.id,
    description: item.description,
    mode: "automated" as const,
    correlatedRequirements: item.correlatedRequirements,
  }));
  const manual = testPlan.exploratoryManualTests.map((item) => ({
    id: item.id,
    description: item.description,
    mode: "exploratory_manual" as const,
    correlatedRequirements: item.correlatedRequirements,
  }));
  return [...automated, ...manual];
}

function buildBatchExecutionPrompt(
  skillBody: string,
  testCases: FlatTestCase[],
  projectContextContent: string,
): string {
  return buildPrompt(skillBody, {
    project_context: projectContextContent,
    test_cases: JSON.stringify(testCases, null, 2),
  });
}

function parseBatchExecutionPayload(raw: string): BatchResultItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (error) {
    throw new Error("Agent batch output was not valid JSON.", { cause: error });
  }

  const validation = BatchResultSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error("Agent batch output did not match required batch result schema.", {
      cause: validation.error,
    });
  }

  return validation.data;
}

function derivePassFail(status: ExecutionPayload["status"]): "pass" | "fail" | null {
  if (status === "passed") return "pass";
  if (status === "failed") return "fail";
  return null;
}

function toArtifactSafeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildArtifactFileName(testCaseId: string, attemptNumber: number): string {
  const safeId = toArtifactSafeSegment(testCaseId);
  const paddedAttempt = attemptNumber.toString().padStart(3, "0");
  return `${safeId}_attempt_${paddedAttempt}.json`;
}

function buildMarkdownReport(report: TestExecutionReport): string {
  const totalTests = report.results.length;
  const passedCount = report.results.filter((result) => result.payload.status === "passed").length;
  const failedCount = totalTests - passedCount;

  const lines = [
    "# Test Execution Report",
    "",
    `**Iteration:** it_${report.iteration}`,
    `**Test Plan:** \`${report.testPlanFile}\``,
    `**Total:** ${totalTests}`,
    `**Passed:** ${passedCount}`,
    `**Failed:** ${failedCount}`,
    "",
    "| Test ID | Description | Status | Correlated Requirements | Artifacts |",
    "|---------|-------------|--------|------------------------|-----------|",
  ];

  for (const result of report.results) {
    const correlatedRequirements = result.correlatedRequirements.join(", ");
    const artifactReferences = result.artifactReferences.map((path) => `\`${path}\``).join("<br>");
    lines.push(
      `| ${result.testCaseId} | ${result.description} | ${result.payload.status} | ${correlatedRequirements} | ${artifactReferences} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function recordTestResult(
  testCase: FlatTestCase,
  payload: { status: "passed" | "failed" | "skipped" | "invocation_failed"; evidence: string; notes: string },
  agentExitCode: number,
  batchPrompt: string,
  agentStdout: string,
  agentStderr: string,
  progressEntry: TestExecutionProgress["entries"][number],
  artifactsDirName: string,
  projectRoot: string,
  executionByTestId: Map<string, TestExecutionResult>,
  executedTestIds: string[],
  writeProgress: () => Promise<void>,
  mergedDeps: ExecuteTestPlanDeps,
): Promise<void> {
  const attemptNumber = progressEntry.attempt_count + 1;
  const artifactFileName = buildArtifactFileName(testCase.id, attemptNumber);
  const artifactRelativePath = join(FLOW_REL_DIR, artifactsDirName, artifactFileName);
  const artifactAbsolutePath = join(projectRoot, artifactRelativePath);

  progressEntry.attempt_count += 1;
  progressEntry.last_agent_exit_code = agentExitCode;
  if (payload.status === "invocation_failed") {
    progressEntry.last_error_summary = payload.notes;
    progressEntry.status = "failed";
  } else {
    progressEntry.last_error_summary = payload.status === "passed" ? "" : payload.notes;
    progressEntry.status = payload.status === "passed" ? "passed" : "failed";
  }
  progressEntry.updated_at = new Date().toISOString();
  await writeProgress();

  await mergedDeps.writeFileFn(
    artifactAbsolutePath,
    `${JSON.stringify(
      {
        testCaseId: testCase.id,
        attemptNumber,
        prompt: batchPrompt,
        agentExitCode,
        stdout: agentStdout,
        stderr: agentStderr,
        payload,
      },
      null,
      2,
    )}\n`,
  );

  executedTestIds.push(testCase.id);
  executionByTestId.set(testCase.id, {
    testCaseId: testCase.id,
    description: testCase.description,
    correlatedRequirements: testCase.correlatedRequirements,
    mode: testCase.mode,
    payload,
    passFail: payload.status === "invocation_failed" ? null : derivePassFail(payload.status),
    agentExitCode,
    artifactReferences: [artifactRelativePath],
  });
}

export async function runExecuteTestPlan(
  opts: ExecuteTestPlanOptions,
  deps: Partial<ExecuteTestPlanDeps> = {},
): Promise<void> {
  const projectRoot = process.cwd();
  const mergedDeps: ExecuteTestPlanDeps = { ...defaultDeps, ...deps };
  const state = await readState(projectRoot);
  const force = opts.force ?? false;

  const tpGeneration = state.phases.prototype.tp_generation;
  await assertGuardrail(
    state,
    tpGeneration.status !== "created",
    `Cannot execute test plan: prototype.tp_generation.status must be created. Current status: '${tpGeneration.status}'. Run \`bun nvst approve test-plan\` first.`,
    { force },
  );

  if (!tpGeneration.file) {
    throw new Error("Cannot execute test plan: prototype.tp_generation.file is missing.");
  }

  const testPlanPath = join(projectRoot, FLOW_REL_DIR, tpGeneration.file);
  if (!(await mergedDeps.existsFn(testPlanPath))) {
    throw new Error(`Cannot execute test plan: file not found at ${testPlanPath}`);
  }

  let parsedTestPlan: unknown;
  try {
    parsedTestPlan = JSON.parse(await mergedDeps.readFileFn(testPlanPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid test plan JSON at ${join(FLOW_REL_DIR, tpGeneration.file)}.`, {
      cause: error,
    });
  }

  const testPlanValidation = TestPlanSchema.safeParse(parsedTestPlan);
  if (!testPlanValidation.success) {
    throw new Error(
      `Test plan JSON schema mismatch at ${join(FLOW_REL_DIR, tpGeneration.file)}.`,
      { cause: testPlanValidation.error },
    );
  }

  const projectContextPath = join(projectRoot, ".agents", "PROJECT_CONTEXT.md");
  if (!(await mergedDeps.existsFn(projectContextPath))) {
    throw new Error("Project context missing: expected .agents/PROJECT_CONTEXT.md.");
  }
  const projectContextContent = await mergedDeps.readFileFn(projectContextPath, "utf8");

  try {
    await mergedDeps.loadSkillFn(projectRoot, "execute-test-case");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/execute-test-case/SKILL.md.",
    );
  }

  let batchSkillBody: string;
  try {
    batchSkillBody = await mergedDeps.loadSkillFn(projectRoot, "execute-test-batch");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/execute-test-batch/SKILL.md.",
    );
  }

  const testCases = flattenTests(testPlanValidation.data);
  const now = new Date().toISOString();
  const progressFileName = `it_${state.current_iteration}_test-execution-progress.json`;
  const progressPath = join(projectRoot, FLOW_REL_DIR, progressFileName);
  const artifactsDirName = `it_${state.current_iteration}_test-execution-artifacts`;
  const artifactsDirPath = join(projectRoot, FLOW_REL_DIR, artifactsDirName);

  state.phases.prototype.test_execution.status = "in_progress";
  state.phases.prototype.test_execution.file = progressFileName;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:execute-test-plan";
  await writeState(projectRoot, state);

  let progress: TestExecutionProgress;
  if (await mergedDeps.existsFn(progressPath)) {
    let parsedProgress: unknown;
    try {
      parsedProgress = JSON.parse(await mergedDeps.readFileFn(progressPath, "utf8"));
    } catch (error) {
      throw new Error(`Invalid progress JSON at ${join(FLOW_REL_DIR, progressFileName)}.`, {
        cause: error,
      });
    }

    const progressValidation = TestExecutionProgressSchema.safeParse(parsedProgress);
    if (!progressValidation.success) {
      throw new Error(
        `Progress JSON schema mismatch at ${join(FLOW_REL_DIR, progressFileName)}.`,
        { cause: progressValidation.error },
      );
    }

    const expectedIds = sortedValues(testCases.map((testCase) => testCase.id));
    const existingIds = sortedValues(progressValidation.data.entries.map((entry) => entry.id));
    if (!idsMatchExactly(existingIds, expectedIds)) {
      throw new Error(
        "Test execution progress file out of sync: entry ids do not match approved test plan test ids.",
      );
    }

    progress = progressValidation.data;
  } else {
    progress = {
      entries: testCases.map((testCase) => ({
        id: testCase.id,
        type: testCase.mode,
        status: "pending",
        attempt_count: 0,
        last_agent_exit_code: null,
        last_error_summary: "",
        updated_at: now,
      })),
    };
  }

  const executionByTestId = new Map<string, TestExecutionResult>();
  const executedTestIds: string[] = [];

  const writeProgress = async () => {
    await mergedDeps.writeJsonArtifactFn(progressPath, TestExecutionProgressSchema, progress);
  };

  await mergedDeps.mkdirFn(join(projectRoot, FLOW_REL_DIR), { recursive: true });
  await mergedDeps.mkdirFn(artifactsDirPath, { recursive: true });
  await writeProgress();

  // --- Batch execution for automated tests ---
  const pendingAutomatedTests = testCases.filter((tc) => {
    if (tc.mode !== "automated") return false;
    const entry = progress.entries.find((e) => e.id === tc.id);
    return entry !== undefined && entry.status !== "passed";
  });

  if (pendingAutomatedTests.length > 0) {
    // Mark all pending automated tests as in_progress
    for (const tc of pendingAutomatedTests) {
      const entry = progress.entries.find((e) => e.id === tc.id);
      if (entry) {
        applyStatusUpdate(entry, "in_progress", new Date().toISOString());
      }
    }
    await writeProgress();

    const batchPrompt = buildBatchExecutionPrompt(
      batchSkillBody,
      pendingAutomatedTests,
      projectContextContent,
    );

    const agentResult = await mergedDeps.invokeAgentFn({
      provider: opts.provider,
      prompt: batchPrompt,
      cwd: projectRoot,
      interactive: false,
    });

    if (agentResult.exitCode !== 0) {
      // All automated tests in the batch fail with invocation_failed
      for (const tc of pendingAutomatedTests) {
        const entry = progress.entries.find((e) => e.id === tc.id);
        if (!entry) continue;
        const errorSummary = `Agent invocation failed with exit code ${agentResult.exitCode}.`;
        await recordTestResult(
          tc,
          { status: "invocation_failed", evidence: "", notes: errorSummary },
          agentResult.exitCode,
          batchPrompt,
          agentResult.stdout,
          agentResult.stderr,
          entry,
          artifactsDirName,
          projectRoot,
          executionByTestId,
          executedTestIds,
          writeProgress,
          mergedDeps,
        );
      }
    } else {
      // Parse batch results
      let batchResults: BatchResultItem[];
      try {
        batchResults = parseBatchExecutionPayload(agentResult.stdout.trim());
      } catch (error) {
        // Fallback: agent may have written results to it_{iteration}_test-batch-results.json
        const fallbackPath = join(
          projectRoot,
          FLOW_REL_DIR,
          `it_${state.current_iteration}_test-batch-results.json`,
        );
        try {
          if (await mergedDeps.existsFn(fallbackPath)) {
            const fallbackRaw = await mergedDeps.readFileFn(fallbackPath, "utf8");
            batchResults = parseBatchExecutionPayload(fallbackRaw.trim());
          } else {
            throw error;
          }
        } catch {
          // Parse failure: mark all as failed
          const summary = error instanceof Error ? error.message : "Unknown batch parsing error.";
          for (const tc of pendingAutomatedTests) {
            const entry = progress.entries.find((e) => e.id === tc.id);
            if (!entry) continue;
            await recordTestResult(
              tc,
              { status: "invocation_failed", evidence: "", notes: summary },
              agentResult.exitCode,
              batchPrompt,
              agentResult.stdout,
              agentResult.stderr,
              entry,
              artifactsDirName,
              projectRoot,
              executionByTestId,
              executedTestIds,
              writeProgress,
              mergedDeps,
            );
          }
          batchResults = [];
        }
      }

      if (batchResults.length > 0) {
        // Build a map from testCaseId to result
        const resultMap = new Map<string, BatchResultItem>();
        for (const item of batchResults) {
          resultMap.set(item.testCaseId, item);
        }

        for (const tc of pendingAutomatedTests) {
          const entry = progress.entries.find((e) => e.id === tc.id);
          if (!entry) continue;

          const batchItem = resultMap.get(tc.id);
          if (batchItem) {
            // Matched result
            await recordTestResult(
              tc,
              { status: batchItem.status, evidence: batchItem.evidence, notes: batchItem.notes },
              agentResult.exitCode,
              batchPrompt,
              agentResult.stdout,
              agentResult.stderr,
              entry,
              artifactsDirName,
              projectRoot,
              executionByTestId,
              executedTestIds,
              writeProgress,
              mergedDeps,
            );
          } else {
            // Partial results: unmatched test marked as failed
            await recordTestResult(
              tc,
              { status: "failed", evidence: "", notes: "No result returned by agent for this test case." },
              agentResult.exitCode,
              batchPrompt,
              agentResult.stdout,
              agentResult.stderr,
              entry,
              artifactsDirName,
              projectRoot,
              executionByTestId,
              executedTestIds,
              writeProgress,
              mergedDeps,
            );
          }
        }
      }
    }
  }

  // --- One-by-one user-interactive execution for manual/exploratory tests ---
  const manualTests = testCases.filter((tc) => tc.mode === "exploratory_manual");
  for (const testCase of manualTests) {
    const progressEntry = progress.entries.find((entry) => entry.id === testCase.id);
    if (!progressEntry) {
      throw new Error(`Missing progress entry for test case '${testCase.id}'.`);
    }

    if (progressEntry.status === "passed") {
      continue;
    }

    applyStatusUpdate(progressEntry, "in_progress", new Date().toISOString());
    await writeProgress();

    const userInput = await mergedDeps.promptManualTestFn(testCase);

    const attemptNumber = progressEntry.attempt_count + 1;
    const artifactFileName = buildArtifactFileName(testCase.id, attemptNumber);
    const artifactRelativePath = join(FLOW_REL_DIR, artifactsDirName, artifactFileName);
    const artifactAbsolutePath = join(projectRoot, artifactRelativePath);

    const payload: ExecutionPayload = {
      status: userInput.status,
      evidence: userInput.evidence,
      notes: userInput.notes,
    };

    progressEntry.attempt_count += 1;
    progressEntry.last_agent_exit_code = null;
    progressEntry.last_error_summary = payload.status === "passed" ? "" : payload.notes;
    applyStatusUpdate(progressEntry, payload.status === "passed" ? "passed" : "failed", new Date().toISOString());
    await writeProgress();

    await mergedDeps.writeFileFn(
      artifactAbsolutePath,
      `${JSON.stringify(
        {
          testCaseId: testCase.id,
          attemptNumber,
          prompt: "manual-user-input",
          agentExitCode: 0,
          stdout: JSON.stringify(userInput),
          stderr: "",
          payload,
        },
        null,
        2,
      )}\n`,
    );

    executedTestIds.push(testCase.id);
    executionByTestId.set(testCase.id, {
      testCaseId: testCase.id,
      description: testCase.description,
      correlatedRequirements: testCase.correlatedRequirements,
      mode: testCase.mode,
      payload,
      passFail: derivePassFail(payload.status),
      agentExitCode: 0,
      artifactReferences: [artifactRelativePath],
    });
  }

  const results: TestExecutionResult[] = testCases.map((testCase) => {
    const progressEntry = progress.entries.find((entry) => entry.id === testCase.id);
    if (!progressEntry) {
      throw new Error(`Missing progress entry for test case '${testCase.id}' after execution.`);
    }

    const latestExecution = executionByTestId.get(testCase.id);
    if (latestExecution) {
      return latestExecution;
    }

    const attemptArtifacts = Array.from({ length: progressEntry.attempt_count }, (_, index) => {
      const attemptNumber = index + 1;
      const artifactFileName = buildArtifactFileName(testCase.id, attemptNumber);
      return join(FLOW_REL_DIR, artifactsDirName, artifactFileName);
    });

    return {
      testCaseId: testCase.id,
      description: testCase.description,
      correlatedRequirements: testCase.correlatedRequirements,
      mode: testCase.mode,
      payload: {
        status: progressEntry.status === "passed" ? "passed" : "failed",
        evidence: "",
        notes: progressEntry.last_error_summary,
      },
      passFail: progressEntry.status === "passed" ? "pass" : "fail",
      agentExitCode: progressEntry.last_agent_exit_code ?? 0,
      artifactReferences: attemptArtifacts,
    };
  });

  const report: TestExecutionReport = {
    iteration: state.current_iteration,
    testPlanFile: tpGeneration.file,
    executedTestIds,
    results,
  };

  const outFileName = `it_${state.current_iteration}_test-execution-results.json`;
  const outPath = join(projectRoot, FLOW_REL_DIR, outFileName);
  await mergedDeps.writeFileFn(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdownReportFileName = `it_${state.current_iteration}_test-execution-report.md`;
  const markdownReportPath = join(projectRoot, FLOW_REL_DIR, markdownReportFileName);
  await mergedDeps.writeFileFn(markdownReportPath, buildMarkdownReport(report));

  const hasFailedTests = progress.entries.some((entry) => entry.status === "failed");
  state.phases.prototype.test_execution.status = hasFailedTests ? "failed" : "completed";
  state.phases.prototype.test_execution.file = progressFileName;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:execute-test-plan";
  await writeState(projectRoot, state);

  const passedCount = results.filter((result) => result.payload.status === "passed").length;
  const failedCount = results.length - passedCount;
  console.log(
    `${passedCount}/${results.length} tests passed, ${failedCount} failed. Report: ${join(FLOW_REL_DIR, markdownReportFileName)}`,
  );
}

import { $ } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RefactorPrdSchema } from "../../scaffold/schemas/tmpl_refactor-prd";
import {
  RefactorExecutionProgressSchema,
  type RefactorExecutionProgress,
} from "../../scaffold/schemas/tmpl_refactor-execution-progress";
import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { CLI_PATH } from "../cli-path";
import { assertGuardrail } from "../guardrail";
import { applyStatusUpdate, idsMatchExactly, sortedValues } from "../progress-utils";
import { exists, FLOW_REL_DIR, readState, writeState } from "../state";

export interface ExecuteRefactorOptions {
  provider: AgentProvider;
  force?: boolean;
}

export { RefactorExecutionProgressSchema };
export type { RefactorExecutionProgress };

interface WriteJsonResult {
  exitCode: number;
  stderr: string;
}

interface ExecuteRefactorDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  invokeWriteJsonFn: (
    projectRoot: string,
    schemaName: string,
    outPath: string,
    data: string,
  ) => Promise<WriteJsonResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  logFn: (message: string) => void;
  nowFn: () => Date;
  readFileFn: typeof readFile;
  writeFileFn: typeof writeFile;
}

async function runWriteJsonCommand(
  projectRoot: string,
  schemaName: string,
  outPath: string,
  data: string,
): Promise<WriteJsonResult> {
  const result =
    await $`bun ${CLI_PATH} write-json --schema ${schemaName} --out ${outPath} --data ${data}`
      .cwd(projectRoot)
      .nothrow()
      .quiet();
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString().trim(),
  };
}

const defaultDeps: ExecuteRefactorDeps = {
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  invokeWriteJsonFn: runWriteJsonCommand,
  loadSkillFn: loadSkill,
  logFn: console.log,
  nowFn: () => new Date(),
  readFileFn: readFile,
  writeFileFn: writeFile,
};

export async function runExecuteRefactor(
  opts: ExecuteRefactorOptions,
  deps: Partial<ExecuteRefactorDeps> = {},
): Promise<void> {
  const mergedDeps: ExecuteRefactorDeps = { ...defaultDeps, ...deps };
  const force = opts.force ?? false;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);

  // AC02: Reject if current_phase !== "refactor"
  await assertGuardrail(
    state,
    state.current_phase !== "refactor",
    `Cannot execute refactor: current_phase must be 'refactor'. Current phase: '${state.current_phase}'.`,
    { force },
  );

  // AC03: Reject if refactor_plan.status !== "approved"
  await assertGuardrail(
    state,
    state.phases.refactor.refactor_plan.status !== "approved",
    `Cannot execute refactor: refactor_plan.status must be 'approved'. Current status: '${state.phases.refactor.refactor_plan.status}'. Run \`bun nvst approve refactor-plan\` first.`,
    { force },
  );

  // AC04: Reject if refactor_execution.status is already "completed"
  await assertGuardrail(
    state,
    state.phases.refactor.refactor_execution.status === "completed",
    "Cannot execute refactor: refactor_execution.status is already 'completed'.",
    { force },
  );

  // AC05: Read and validate refactor-prd.json
  const iteration = state.current_iteration;
  const refactorPrdFileName = `it_${iteration}_refactor-prd.json`;
  const refactorPrdPath = join(projectRoot, FLOW_REL_DIR, refactorPrdFileName);

  if (!(await mergedDeps.existsFn(refactorPrdPath))) {
    throw new Error(
      `Refactor PRD file missing: expected ${join(FLOW_REL_DIR, refactorPrdFileName)}. Run \`bun nvst approve refactor-plan\` first.`,
    );
  }

  let parsedPrd: unknown;
  try {
    parsedPrd = JSON.parse(await mergedDeps.readFileFn(refactorPrdPath, "utf8"));
  } catch {
    throw new Error(
      `Invalid refactor PRD JSON in ${join(FLOW_REL_DIR, refactorPrdFileName)}.`,
    );
  }

  const prdValidation = RefactorPrdSchema.safeParse(parsedPrd);
  if (!prdValidation.success) {
    throw new Error(
      `Refactor PRD schema mismatch in ${join(FLOW_REL_DIR, refactorPrdFileName)}.`,
    );
  }

  const refactorItems = prdValidation.data.refactorItems;

  // Load skill
  let skillTemplate: string;
  try {
    skillTemplate = await mergedDeps.loadSkillFn(projectRoot, "execute-refactor-item");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/execute-refactor-item/SKILL.md.",
    );
  }

  // AC13: Progress file name
  const progressFileName = `it_${iteration}_refactor-execution-progress.json`;
  const progressPath = join(projectRoot, FLOW_REL_DIR, progressFileName);

  // AC06: Set refactor_execution.status = "in_progress" before processing
  // AC13: Set refactor_execution.file
  state.phases.refactor.refactor_execution.status = "in_progress";
  state.phases.refactor.refactor_execution.file = progressFileName;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:execute-refactor";
  await writeState(projectRoot, state);

  // Initialize or load progress file
  let progressData: RefactorExecutionProgress;

  if (await mergedDeps.existsFn(progressPath)) {
    let parsedProgress: unknown;
    try {
      parsedProgress = JSON.parse(await mergedDeps.readFileFn(progressPath, "utf8"));
    } catch {
      throw new Error(
        `Invalid progress JSON in ${join(FLOW_REL_DIR, progressFileName)}.`,
      );
    }

    const progressValidation = RefactorExecutionProgressSchema.safeParse(parsedProgress);
    if (!progressValidation.success) {
      throw new Error(
        `Progress schema mismatch in ${join(FLOW_REL_DIR, progressFileName)}.`,
      );
    }

    // AC05: Verify progress item IDs match refactor PRD item IDs
    const expectedIds = sortedValues(refactorItems.map((item) => item.id));
    const existingIds = sortedValues(progressValidation.data.entries.map((entry) => entry.id));
    if (!idsMatchExactly(existingIds, expectedIds)) {
      throw new Error(
        "Refactor execution progress file out of sync: entry ids do not match refactor PRD item ids.",
      );
    }

    progressData = progressValidation.data;
  } else {
    const now = mergedDeps.nowFn().toISOString();
    progressData = {
      entries: refactorItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: "pending" as const,
        attempt_count: 0,
        last_agent_exit_code: null,
        updated_at: now,
      })),
    };
    const writeResult = await mergedDeps.invokeWriteJsonFn(
      projectRoot,
      "refactor-execution-progress",
      join(FLOW_REL_DIR, progressFileName),
      JSON.stringify(progressData),
    );
    if (writeResult.exitCode !== 0) {
      throw new Error(
        `Failed to write refactor execution progress: ${writeResult.stderr || "write-json exited non-zero"}.`,
      );
    }
  }

  // AC07, AC08, AC09, AC10: Process each item in order
  for (const item of refactorItems) {
    const entry = progressData.entries.find((e) => e.id === item.id);
    if (!entry || entry.status === "completed") {
      continue;
    }

    // Set current item to in_progress before invoking agent (FR-4; observability on interrupt)
    applyStatusUpdate(entry, "in_progress", mergedDeps.nowFn().toISOString());
    const writeInProgressResult = await mergedDeps.invokeWriteJsonFn(
      projectRoot,
      "refactor-execution-progress",
      join(FLOW_REL_DIR, progressFileName),
      JSON.stringify(progressData),
    );
    if (writeInProgressResult.exitCode !== 0) {
      throw new Error(
        `Failed to write refactor execution progress: ${writeInProgressResult.stderr || "write-json exited non-zero"}.`,
      );
    }

    // AC07: Build prompt with skill and item context (FR-6 variable names)
    const prompt = buildPrompt(skillTemplate, {
      current_iteration: iteration,
      item_id: item.id,
      item_title: item.title,
      item_description: item.description,
      item_rationale: item.rationale,
    });

    // US-002-AC01: Invoke agent in non-interactive mode (autonomous execution)
    const agentResult = await mergedDeps.invokeAgentFn({
      provider: opts.provider,
      prompt,
      cwd: projectRoot,
      interactive: false,
    });

    // AC09 & AC10: Record result after each invocation, continue on failure
    const succeeded = agentResult.exitCode === 0;
    entry.attempt_count = entry.attempt_count + 1;
    entry.last_agent_exit_code = agentResult.exitCode;
    applyStatusUpdate(entry, succeeded ? "completed" : "failed", mergedDeps.nowFn().toISOString());

    const writeResult = await mergedDeps.invokeWriteJsonFn(
      projectRoot,
      "refactor-execution-progress",
      join(FLOW_REL_DIR, progressFileName),
      JSON.stringify(progressData),
    );
    if (writeResult.exitCode !== 0) {
      throw new Error(
        `Failed to write refactor execution progress: ${writeResult.stderr || "write-json exited non-zero"}.`,
      );
    }

    mergedDeps.logFn(
      `iteration=it_${iteration} item=${item.id} outcome=${entry.status}`,
    );
  }

  // US-003: Generate markdown execution report (written regardless of failures)
  const reportFileName = `it_${iteration}_refactor-execution-report.md`;
  const reportPath = join(projectRoot, FLOW_REL_DIR, reportFileName);
  const reportContent = buildRefactorExecutionReport(iteration, progressData);
  await mergedDeps.writeFileFn(reportPath, reportContent, "utf8");

  // AC11 & AC12: Update state based on overall result
  const allCompleted = progressData.entries.every((entry) => entry.status === "completed");

  if (allCompleted) {
    // AC11: All completed → set status to "completed"
    state.phases.refactor.refactor_execution.status = "completed";
  }
  // AC12: Any failure → stays "in_progress" (already set above)

  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:execute-refactor";
  await writeState(projectRoot, state);

  if (allCompleted) {
    mergedDeps.logFn("Refactor execution completed for all items.");
  } else {
    mergedDeps.logFn("Refactor execution paused with remaining pending or failed items.");
  }
}

export function buildRefactorExecutionReport(
  iteration: string,
  progress: RefactorExecutionProgress,
): string {
  const total = progress.entries.length;
  const completed = progress.entries.filter((e) => e.status === "completed").length;
  const failed = progress.entries.filter((e) => e.status === "failed").length;

  const tableRows = progress.entries
    .map((e) => {
      const exitCode = e.last_agent_exit_code === null ? "N/A" : String(e.last_agent_exit_code);
      return `| ${e.id} | ${e.title} | ${e.status} | ${exitCode} |`;
    })
    .join("\n");

  return `# Refactor Execution Report

**Iteration:** it_${iteration}
**Total:** ${total}
**Completed:** ${completed}
**Failed:** ${failed}

| RI ID | Title | Status | Agent Exit Code |
|-------|-------|--------|-----------------|
${tableRows}
`;
}

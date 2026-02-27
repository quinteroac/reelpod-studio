import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

import { CLI_PATH } from "../cli-path";
import { assertGuardrail } from "../guardrail";
import type { TestPlan } from "../../scaffold/schemas/tmpl_test-plan";
import { exists, FLOW_REL_DIR, readState, writeState } from "../state";

interface WriteJsonResult {
  exitCode: number;
  stderr: string;
}

interface ApproveTestPlanDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeWriteJsonFn: (
    projectRoot: string,
    schemaName: string,
    outPath: string,
    data: string,
  ) => Promise<WriteJsonResult>;
  nowFn: () => Date;
  readFileFn: typeof readFile;
}

const defaultDeps: ApproveTestPlanDeps = {
  existsFn: exists,
  invokeWriteJsonFn: runWriteJsonCommand,
  nowFn: () => new Date(),
  readFileFn: readFile,
};

export function parseTestPlan(markdown: string): TestPlan {
  const scope: string[] = [];
  const environmentData: string[] = [];
  const automatedTests: TestPlan["automatedTests"] = [];
  const exploratoryManualTests: TestPlan["exploratoryManualTests"] = [];

  type Section = "scope" | "environmentData" | null;
  let currentSection: Section = null;
  let inTable = false;

  const parseRequirements = (cell: string): string[] =>
    cell
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^(US-\d{3}|FR-\d+)$/i.test(entry))
      .map((entry) => entry.toUpperCase());

  const lines = markdown.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^##\s+Scope$/i.test(trimmed)) {
      currentSection = "scope";
      inTable = false;
      continue;
    }
    if (/^##\s+Environment\s*(?:and|&)\s*data$/i.test(trimmed)) {
      currentSection = "environmentData";
      inTable = false;
      continue;
    }

    if (
      trimmed.startsWith("|")
      && trimmed.includes("Test Case ID")
      && trimmed.includes("Correlated Requirements")
    ) {
      inTable = true;
      currentSection = null;
      continue;
    }

    if (inTable && trimmed.startsWith("|")) {
      if (trimmed.includes("---|")) continue;

      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c, i, a) => i > 0 && i < a.length - 1);

      if (cells.length >= 6) {
        const [id, description, , mode, correlatedRequirementsCell] = cells;
        if (id === "Test Case ID") continue;

        const item = {
          id,
          description,
          status: "pending" as const,
          correlatedRequirements: parseRequirements(correlatedRequirementsCell),
        };
        if (mode.toLowerCase().includes("automated")) {
          automatedTests.push(item);
        } else {
          exploratoryManualTests.push(item);
        }
      }
      continue;
    }

    if (inTable && trimmed.length === 0) {
      inTable = false;
      continue;
    }

    if (!currentSection || trimmed.length === 0 || /^<!--/.test(trimmed)) {
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const value = bulletMatch ? bulletMatch[1].trim() : trimmed;
    if (!value) continue;

    if (currentSection === "scope") scope.push(value);
    if (currentSection === "environmentData") environmentData.push(value);
  }

  return {
    overallStatus: "pending",
    scope,
    environmentData,
    automatedTests,
    exploratoryManualTests,
  };
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

export async function runApproveTestPlan(
  optsOrDeps: { force?: boolean } | Partial<ApproveTestPlanDeps> = {},
  maybeDeps: Partial<ApproveTestPlanDeps> = {},
): Promise<void> {
  const isDepsArg =
    typeof optsOrDeps === "object"
    && optsOrDeps !== null
    && (
      "existsFn" in optsOrDeps
      || "invokeWriteJsonFn" in optsOrDeps
      || "nowFn" in optsOrDeps
      || "readFileFn" in optsOrDeps
    );
  const force = isDepsArg ? false : ((optsOrDeps as { force?: boolean }).force ?? false);
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const deps = isDepsArg ? optsOrDeps : maybeDeps;
  const mergedDeps: ApproveTestPlanDeps = { ...defaultDeps, ...deps };

  const testPlan = state.phases.prototype.test_plan;
  await assertGuardrail(
    state,
    testPlan.status !== "pending_approval",
    `Cannot approve test plan from status '${testPlan.status}'. Expected pending_approval.`,
    { force },
  );

  const testPlanFile = testPlan.file;
  if (!testPlanFile) {
    throw new Error("Cannot approve test plan: prototype.test_plan.file is missing.");
  }

  const testPlanPath = join(projectRoot, FLOW_REL_DIR, testPlanFile);
  if (!(await mergedDeps.existsFn(testPlanPath))) {
    throw new Error(`Cannot approve test plan: file not found at ${testPlanPath}`);
  }

  const markdown = await mergedDeps.readFileFn(testPlanPath, "utf-8");
  const tpData = parseTestPlan(markdown);
  const tpJsonFileName = `it_${state.current_iteration}_TP.json`;
  const tpJsonRelPath = join(FLOW_REL_DIR, tpJsonFileName);

  const writeResult = await mergedDeps.invokeWriteJsonFn(
    projectRoot,
    "test-plan",
    tpJsonRelPath,
    JSON.stringify(tpData),
  );

  if (writeResult.exitCode !== 0) {
    console.error("Test-plan JSON generation failed. Test plan remains pending_approval.");
    if (writeResult.stderr) {
      console.error(writeResult.stderr);
    }
    process.exitCode = 1;
    return;
  }

  testPlan.status = "created";
  state.phases.prototype.tp_generation.status = "created";
  state.phases.prototype.tp_generation.file = tpJsonFileName;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:approve-test-plan";

  await writeState(projectRoot, state);

  console.log("Test plan approved.");
  console.log(`Test-plan JSON written to ${tpJsonRelPath}`);
}

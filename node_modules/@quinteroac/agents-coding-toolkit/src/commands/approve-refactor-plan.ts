import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

import { CLI_PATH } from "../cli-path";
import { assertGuardrail } from "../guardrail";
import type { RefactorPrd } from "../../scaffold/schemas/tmpl_refactor-prd";
import { exists, FLOW_REL_DIR, readState, writeState } from "../state";

interface WriteJsonResult {
  exitCode: number;
  stderr: string;
}

interface ApproveRefactorPlanDeps {
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

const defaultDeps: ApproveRefactorPlanDeps = {
  existsFn: exists,
  invokeWriteJsonFn: runWriteJsonCommand,
  nowFn: () => new Date(),
  readFileFn: readFile,
};

export function parseRefactorPlan(markdown: string): RefactorPrd {
  const refactorItems: RefactorPrd["refactorItems"] = [];
  const lines = markdown.split("\n");

  let inRefactorItems = false;
  let currentField: "description" | "rationale" | null = null;
  let currentItem: RefactorPrd["refactorItems"][number] | null = null;

  const flushCurrentItem = () => {
    if (!currentItem) return;
    refactorItems.push(currentItem);
    currentItem = null;
    currentField = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^##\s+Refactor Items$/i.test(trimmed)) {
      inRefactorItems = true;
      currentField = null;
      continue;
    }

    if (!inRefactorItems) {
      continue;
    }

    if (/^##\s+/.test(trimmed) && !/^##\s+Refactor Items$/i.test(trimmed)) {
      flushCurrentItem();
      inRefactorItems = false;
      continue;
    }

    const itemMatch = trimmed.match(/^###\s+(RI-\d{3}):\s+(.+)$/i);
    if (itemMatch) {
      flushCurrentItem();
      currentItem = {
        id: itemMatch[1].toUpperCase(),
        title: itemMatch[2].trim(),
        description: "",
        rationale: "",
      };
      currentField = null;
      continue;
    }

    if (!currentItem) {
      continue;
    }

    const descriptionMatch = trimmed.match(/^\*\*Description:\*\*\s*(.*)$/i);
    if (descriptionMatch) {
      currentItem.description = descriptionMatch[1].trim();
      currentField = "description";
      continue;
    }

    const rationaleMatch = trimmed.match(/^\*\*Rationale:\*\*\s*(.*)$/i);
    if (rationaleMatch) {
      currentItem.rationale = rationaleMatch[1].trim();
      currentField = "rationale";
      continue;
    }

    if (trimmed.length === 0 || !currentField) {
      continue;
    }

    if (currentField === "description") {
      currentItem.description = [currentItem.description, trimmed].filter(Boolean).join(" ");
      continue;
    }

    currentItem.rationale = [currentItem.rationale, trimmed].filter(Boolean).join(" ");
  }

  flushCurrentItem();

  return { refactorItems };
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

export async function runApproveRefactorPlan(
  optsOrDeps: { force?: boolean } | Partial<ApproveRefactorPlanDeps> = {},
  maybeDeps: Partial<ApproveRefactorPlanDeps> = {},
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
  const mergedDeps: ApproveRefactorPlanDeps = { ...defaultDeps, ...deps };

  const refactorPlan = state.phases.refactor.refactor_plan;
  await assertGuardrail(
    state,
    refactorPlan.status !== "pending_approval",
    `Cannot approve refactor plan from status '${refactorPlan.status}'. Expected pending_approval.`,
    { force },
  );

  const refactorPlanFile = refactorPlan.file;
  if (!refactorPlanFile) {
    throw new Error("Cannot approve refactor plan: refactor.refactor_plan.file is missing.");
  }

  const refactorPlanPath = join(projectRoot, FLOW_REL_DIR, refactorPlanFile);
  if (!(await mergedDeps.existsFn(refactorPlanPath))) {
    throw new Error(`Cannot approve refactor plan: file not found at ${refactorPlanPath}`);
  }

  const markdown = await mergedDeps.readFileFn(refactorPlanPath, "utf-8");
  const refactorPrdData = parseRefactorPlan(markdown);
  const refactorPrdJsonFileName = `it_${state.current_iteration}_refactor-prd.json`;
  const refactorPrdJsonRelPath = join(FLOW_REL_DIR, refactorPrdJsonFileName);

  const writeResult = await mergedDeps.invokeWriteJsonFn(
    projectRoot,
    "refactor-prd",
    refactorPrdJsonRelPath,
    JSON.stringify(refactorPrdData),
  );

  if (writeResult.exitCode !== 0) {
    console.error("Refactor PRD JSON generation failed. Refactor plan remains pending_approval.");
    if (writeResult.stderr) {
      console.error(writeResult.stderr);
    }
    process.exitCode = 1;
    return;
  }

  refactorPlan.status = "approved";
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:approve-refactor-plan";

  await writeState(projectRoot, state);

  console.log("Refactor plan approved.");
  console.log(`Refactor PRD JSON written to ${refactorPrdJsonRelPath}`);
}

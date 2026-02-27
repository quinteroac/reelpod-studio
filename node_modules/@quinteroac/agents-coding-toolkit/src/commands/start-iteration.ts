import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

import type { State } from "../../scaffold/schemas/tmpl_state";
import { exists, readState, writeState, STATE_REL_PATH, FLOW_REL_DIR } from "../state";

const ARCHIVED_DIR = join(FLOW_REL_DIR, "archived");

function createInitialState(nowIso: string): State {
  return {
    current_iteration: "000001",
    current_phase: "define",
    phases: {
      define: {
        requirement_definition: { status: "pending", file: null },
        prd_generation: { status: "pending", file: null },
      },
      prototype: {
        project_context: { status: "pending", file: null },
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
    last_updated: nowIso,
    history: [],
  };
}

function nextIteration(iteration: string): string {
  return String(Number.parseInt(iteration, 10) + 1).padStart(6, "0");
}

export async function runStartIteration(): Promise<void> {
  const projectRoot = process.cwd();
  const statePath = join(projectRoot, STATE_REL_PATH);
  const flowDir = join(projectRoot, FLOW_REL_DIR);
  const nowIso = new Date().toISOString();

  await mkdir(flowDir, { recursive: true });

  if (!(await exists(statePath))) {
    await writeState(projectRoot, createInitialState(nowIso));
    console.log("Iteration 000001 started (phase: define)");
    return;
  }

  const parsedState = await readState(projectRoot);

  const currentIteration = parsedState.current_iteration;
  const flowEntries = await readdir(flowDir, { withFileTypes: true });
  const filePrefix = `it_${currentIteration}_`;
  const filesToArchive = flowEntries
    .filter((entry) => entry.isFile() && entry.name.startsWith(filePrefix))
    .map((entry) => entry.name);

  const iterationArchiveDir = join(ARCHIVED_DIR, currentIteration);
  const iterationArchiveAbsDir = join(projectRoot, iterationArchiveDir);
  await mkdir(iterationArchiveAbsDir, { recursive: true });

  for (const fileName of filesToArchive) {
    await rename(join(flowDir, fileName), join(iterationArchiveAbsDir, fileName));
  }

  const updatedHistory = [
    ...(parsedState.history ?? []),
    {
      iteration: currentIteration,
      archived_at: nowIso,
      archived_path: `.agents/flow/archived/${currentIteration}`,
    },
  ];

  const nextState = createInitialState(nowIso);
  nextState.current_iteration = nextIteration(currentIteration);
  nextState.history = updatedHistory;

  // Preserve project_context when already created (immutable across iterations)
  const prevProjectContext = parsedState.phases?.prototype?.project_context;
  if (prevProjectContext?.status === "created" && prevProjectContext?.file) {
    nextState.phases.prototype.project_context = {
      status: "created",
      file: prevProjectContext.file,
    };
  }

  // Preserve flow_guardrail so user configuration is not lost when starting an iteration
  if (parsedState.flow_guardrail !== undefined) {
    nextState.flow_guardrail = parsedState.flow_guardrail;
  }

  await writeState(projectRoot, nextState);

  console.log(
    `Archived ${filesToArchive.length} file(s) to .agents/flow/archived/${currentIteration}`,
  );
  console.log(`Iteration ${nextState.current_iteration} started (phase: define)`);
}

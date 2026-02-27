import type { AgentProvider } from "../agent";
import { parseProvider } from "../agent";
import { runCreateProjectContext } from "./create-project-context";
import { runCreatePrototype } from "./create-prototype";
import { runCreateTestPlan } from "./create-test-plan";
import { runDefineRefactorPlan } from "./define-refactor-plan";
import { runDefineRequirement } from "./define-requirement";
import { runExecuteRefactor } from "./execute-refactor";
import { runExecuteTestPlan } from "./execute-test-plan";
import { GuardrailAbortError } from "../guardrail";
import { defaultReadLine } from "../readline";
import { readState } from "../state";
import type { State } from "../../scaffold/schemas/tmpl_state";
import {
  buildApprovalGateMessage,
  FLOW_APPROVAL_TARGETS,
  type FlowStep,
  FLOW_STEPS,
  type FlowHandlerKey,
} from "./flow-config";

export interface FlowOptions {
  provider?: AgentProvider;
  force?: boolean;
}

type FlowDecision =
  | { kind: "step"; step: FlowStep }
  | { kind: "approval_gate"; message: string }
  | { kind: "complete"; message: string }
  | { kind: "blocked"; message: string };

interface FlowDeps {
  readLineFn: () => Promise<string | null>;
  readStateFn: (projectRoot: string) => Promise<State>;
  runCreateProjectContextFn: typeof runCreateProjectContext;
  runCreatePrototypeFn: typeof runCreatePrototype;
  runCreateTestPlanFn: typeof runCreateTestPlan;
  runDefineRefactorPlanFn: typeof runDefineRefactorPlan;
  runDefineRequirementFn: typeof runDefineRequirement;
  runExecuteRefactorFn: typeof runExecuteRefactor;
  runExecuteTestPlanFn: typeof runExecuteTestPlan;
  stderrWriteFn: (message: string) => void;
  stdoutWriteFn: (message: string) => void;
}

const defaultDeps: FlowDeps = {
  readLineFn: defaultReadLine,
  readStateFn: readState,
  runCreateProjectContextFn: runCreateProjectContext,
  runCreatePrototypeFn: runCreatePrototype,
  runCreateTestPlanFn: runCreateTestPlan,
  runDefineRefactorPlanFn: runDefineRefactorPlan,
  runDefineRequirementFn: runDefineRequirement,
  runExecuteRefactorFn: runExecuteRefactor,
  runExecuteTestPlanFn: runExecuteTestPlan,
  stderrWriteFn: (message: string) => process.stderr.write(`${message}\n`),
  stdoutWriteFn: (message: string) => process.stdout.write(`${message}\n`),
};

// Status semantics in flow orchestration:
// - "in_progress" may represent either a resumable execution step or an approval wait state.
// - For requirement_definition, "in_progress" means content exists and approval is required.
// - For build/execution steps, "in_progress" means work was interrupted/partial and should be resumed.
function isResumableInProgressStatus(status: string): boolean {
  return status === "in_progress";
}

function isApprovalGateInProgressStatus(status: string): boolean {
  return status === "in_progress";
}

function isRunnablePendingOrResumable(status: string): boolean {
  return status === "pending" || isResumableInProgressStatus(status);
}

function buildIterationCompleteMessage(iteration: string): string {
  return `Iteration ${iteration} complete. All phases finished.`;
}

function buildUnsupportedStatusMessage(path: string, status: string): string {
  return `Unsupported status '${status}' at phases.${path}.`;
}

function buildNoRunnableStepMessage(path: string): string {
  return `No runnable flow step found for phases.${path}.`;
}

function resolveDefinePhaseDecision(state: State): FlowDecision | null {
  const define = state.phases.define;

  for (const key of Object.keys(define) as Array<keyof typeof define>) {
    if (key === "requirement_definition") {
      const status = define.requirement_definition.status;
      if (status === "pending") {
        return { kind: "step", step: FLOW_STEPS["define-requirement"] };
      }
      if (isApprovalGateInProgressStatus(status)) {
        return {
          kind: "approval_gate",
          message: buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.requirement),
        };
      }
      if (status !== "approved") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("define.requirement_definition", status),
        };
      }
      continue;
    }

    const status = define.prd_generation.status;
    if (status === "completed") {
      continue;
    }
    if (status === "pending") {
      return {
        kind: "blocked",
        message: buildNoRunnableStepMessage("define.prd_generation"),
      };
    }
    return {
      kind: "blocked",
      message: buildUnsupportedStatusMessage("define.prd_generation", status),
    };
  }

  return null;
}

function resolvePrototypePhaseDecision(state: State): FlowDecision | null {
  const prototype = state.phases.prototype;

  for (const key of Object.keys(prototype) as Array<keyof typeof prototype>) {
    if (key === "project_context") {
      const status = prototype.project_context.status;
      if (status === "pending") {
        return { kind: "step", step: FLOW_STEPS["create-project-context"] };
      }
      if (status === "pending_approval") {
        return {
          kind: "approval_gate",
          message: buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.projectContext),
        };
      }
      if (status !== "created") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("prototype.project_context", status),
        };
      }
      continue;
    }

    if (key === "test_plan") {
      const status = prototype.test_plan.status;
      if (status === "pending") {
        return { kind: "step", step: FLOW_STEPS["create-test-plan"] };
      }
      if (status === "pending_approval") {
        return {
          kind: "approval_gate",
          message: buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.testPlan),
        };
      }
      if (status !== "created") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("prototype.test_plan", status),
        };
      }
      continue;
    }

    if (key === "tp_generation") {
      const status = prototype.tp_generation.status;
      if (status === "created") {
        continue;
      }
      if (status === "pending") {
        return {
          kind: "blocked",
          message: buildNoRunnableStepMessage("prototype.tp_generation"),
        };
      }
      return {
        kind: "blocked",
        message: buildUnsupportedStatusMessage("prototype.tp_generation", status),
      };
    }

    if (key === "prototype_build") {
      const status = prototype.prototype_build.status;
      if (isRunnablePendingOrResumable(status)) {
        return { kind: "step", step: FLOW_STEPS["create-prototype"] };
      }
      if (status !== "created") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("prototype.prototype_build", status),
        };
      }
      continue;
    }

    if (key === "test_execution") {
      const status = prototype.test_execution.status;
      if (status === "pending" || status === "in_progress" || status === "failed") {
        return { kind: "step", step: FLOW_STEPS["execute-test-plan"] };
      }
      if (status !== "completed") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("prototype.test_execution", status),
        };
      }
      continue;
    }

    if (key === "prototype_approved") {
      if (!prototype.prototype_approved) {
        return {
          kind: "approval_gate",
          message: buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.prototype),
        };
      }
    }
  }

  return null;
}

function resolveRefactorPhaseDecision(state: State): FlowDecision | null {
  const refactor = state.phases.refactor;

  for (const key of Object.keys(refactor) as Array<keyof typeof refactor>) {
    if (key === "evaluation_report") {
      const status = refactor.evaluation_report.status;
      if (status === "created") {
        continue;
      }
      if (status === "pending") {
        if (refactor.refactor_plan.status === "pending") {
          return { kind: "step", step: FLOW_STEPS["define-refactor-plan"] };
        }
        if (refactor.refactor_plan.status === "pending_approval") {
          return {
            kind: "approval_gate",
            message: buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.refactorPlan),
          };
        }
        return {
          kind: "blocked",
          message: buildNoRunnableStepMessage("refactor.evaluation_report"),
        };
      }
      return {
        kind: "blocked",
        message: buildUnsupportedStatusMessage("refactor.evaluation_report", status),
      };
    }

    if (key === "refactor_plan") {
      const status = refactor.refactor_plan.status;
      if (status === "pending") {
        return { kind: "step", step: FLOW_STEPS["define-refactor-plan"] };
      }
      if (status === "pending_approval") {
        return {
          kind: "approval_gate",
          message: buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.refactorPlan),
        };
      }
      if (status !== "approved") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("refactor.refactor_plan", status),
        };
      }
      continue;
    }

    if (key === "refactor_execution") {
      const status = refactor.refactor_execution.status;
      if (isRunnablePendingOrResumable(status)) {
        return { kind: "step", step: FLOW_STEPS["execute-refactor"] };
      }
      if (status !== "completed") {
        return {
          kind: "blocked",
          message: buildUnsupportedStatusMessage("refactor.refactor_execution", status),
        };
      }
      continue;
    }

    if (key === "changelog") {
      const status = refactor.changelog.status;
      if (status === "pending" || status === "created") {
        continue;
      }
      return {
        kind: "blocked",
        message: buildUnsupportedStatusMessage("refactor.changelog", status),
      };
    }
  }

  return null;
}

export function detectNextFlowDecision(state: State): FlowDecision {
  for (const phase of Object.keys(state.phases) as Array<keyof State["phases"]>) {
    const decision = phase === "define"
      ? resolveDefinePhaseDecision(state)
      : phase === "prototype"
        ? resolvePrototypePhaseDecision(state)
        : resolveRefactorPhaseDecision(state);

    if (decision !== null) {
      return decision;
    }
  }

  return { kind: "complete", message: buildIterationCompleteMessage(state.current_iteration) };
}

async function ensureProvider(
  provider: AgentProvider | undefined,
  deps: FlowDeps,
): Promise<AgentProvider> {
  if (provider) {
    return provider;
  }

  deps.stdoutWriteFn("Enter agent provider:");

  const value = await deps.readLineFn();
  if (value === null) {
    throw new Error("Missing agent provider from stdin.");
  }

  return parseProvider(value.trim());
}

export async function runFlow(
  opts: FlowOptions = {},
  deps: Partial<FlowDeps> = {},
): Promise<void> {
  const mergedDeps: FlowDeps = { ...defaultDeps, ...deps };
  const projectRoot = process.cwd();
  let provider = opts.provider;
  const force = opts.force ?? false;

  while (true) {
    const state = await mergedDeps.readStateFn(projectRoot);
    const decision = detectNextFlowDecision(state);

    if (decision.kind === "complete") {
      mergedDeps.stdoutWriteFn(decision.message);
      return;
    }

    if (decision.kind === "approval_gate") {
      mergedDeps.stdoutWriteFn(decision.message);
      return;
    }

    if (decision.kind === "blocked") {
      mergedDeps.stderrWriteFn(decision.message);
      process.exitCode = 1;
      return;
    }

    const { step } = decision;
    try {
      if (step.requiresAgent) {
        provider = await ensureProvider(provider, mergedDeps);
      }

      mergedDeps.stdoutWriteFn(`Running: bun nvst ${step.label}`);
      const handlers: Record<FlowHandlerKey, () => Promise<void>> = {
        runDefineRequirementFn: () => mergedDeps.runDefineRequirementFn({ provider: provider!, force }),
        runCreateProjectContextFn: () => mergedDeps.runCreateProjectContextFn({ provider: provider!, mode: "strict", force }),
        runCreatePrototypeFn: () => mergedDeps.runCreatePrototypeFn({ provider: provider!, force }),
        runCreateTestPlanFn: () => mergedDeps.runCreateTestPlanFn({ provider: provider!, force }),
        runExecuteTestPlanFn: () => mergedDeps.runExecuteTestPlanFn({ provider: provider!, force }),
        runDefineRefactorPlanFn: () => mergedDeps.runDefineRefactorPlanFn({ provider: provider!, force }),
        runExecuteRefactorFn: () => mergedDeps.runExecuteRefactorFn({ provider: provider!, force }),
      };

      await handlers[step.handlerKey]();
      continue;
    } catch (error) {
      if (error instanceof GuardrailAbortError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      mergedDeps.stderrWriteFn(message);
      process.exitCode = 1;
      return;
    }
  }
}

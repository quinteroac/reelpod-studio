export type FlowHandlerKey =
  | "runCreateProjectContextFn"
  | "runCreatePrototypeFn"
  | "runCreateTestPlanFn"
  | "runDefineRefactorPlanFn"
  | "runDefineRequirementFn"
  | "runExecuteRefactorFn"
  | "runExecuteTestPlanFn";

type FlowStepDefinition = {
  id: string;
  label: string;
  requiresAgent: boolean;
  handlerKey: FlowHandlerKey;
};

export const FLOW_STEPS = {
  "define-requirement": {
    id: "define-requirement",
    label: "define requirement",
    requiresAgent: true,
    handlerKey: "runDefineRequirementFn",
  },
  "create-project-context": {
    id: "create-project-context",
    label: "create project-context",
    requiresAgent: true,
    handlerKey: "runCreateProjectContextFn",
  },
  "create-prototype": {
    id: "create-prototype",
    label: "create prototype",
    requiresAgent: true,
    handlerKey: "runCreatePrototypeFn",
  },
  "create-test-plan": {
    id: "create-test-plan",
    label: "create test-plan",
    requiresAgent: true,
    handlerKey: "runCreateTestPlanFn",
  },
  "execute-test-plan": {
    id: "execute-test-plan",
    label: "execute test-plan",
    requiresAgent: true,
    handlerKey: "runExecuteTestPlanFn",
  },
  "define-refactor-plan": {
    id: "define-refactor-plan",
    label: "define refactor-plan",
    requiresAgent: true,
    handlerKey: "runDefineRefactorPlanFn",
  },
  "execute-refactor": {
    id: "execute-refactor",
    label: "execute refactor",
    requiresAgent: true,
    handlerKey: "runExecuteRefactorFn",
  },
} as const satisfies Record<string, FlowStepDefinition>;

export type FlowStepId = keyof typeof FLOW_STEPS;
export type FlowStep = (typeof FLOW_STEPS)[FlowStepId];

export const FLOW_APPROVAL_TARGETS = {
  requirement: "requirement",
  projectContext: "project-context",
  testPlan: "test-plan",
  prototype: "prototype",
  refactorPlan: "refactor-plan",
} as const;

export type FlowApprovalTarget = (typeof FLOW_APPROVAL_TARGETS)[keyof typeof FLOW_APPROVAL_TARGETS];

export const FLOW_APPROVAL_GATE_PREFIX = "Waiting for approval. Run: nvst approve";

export function buildApprovalGateMessage(target: FlowApprovalTarget): string {
  return `${FLOW_APPROVAL_GATE_PREFIX} ${target} to continue, then re-run nvst flow.`;
}

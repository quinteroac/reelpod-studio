import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { State } from "../../scaffold/schemas/tmpl_state";
import { StateSchema } from "../../scaffold/schemas/tmpl_state";
import { GuardrailAbortError } from "../guardrail";
import {
  buildApprovalGateMessage,
  FLOW_APPROVAL_GATE_PREFIX,
  FLOW_APPROVAL_TARGETS,
  FLOW_STEPS,
} from "./flow-config";
import { detectNextFlowDecision, runFlow } from "./flow";

function createBaseState(): State {
  return {
    current_iteration: "000019",
    current_phase: "prototype",
    flow_guardrail: "strict",
    phases: {
      define: {
        requirement_definition: { status: "approved", file: "it_000019_product-requirement-document.md" },
        prd_generation: { status: "completed", file: "it_000019_PRD.json" },
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
    last_updated: "2026-02-27T00:00:00.000Z",
  };
}

function withState(base: State, mutate: (state: State) => void): State {
  const cloned = structuredClone(base);
  mutate(cloned);
  return cloned;
}

describe("US-001: flow command", () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode ?? 0;
  });

  test("AC01: detectNextFlowDecision identifies next pending step from phase/status", () => {
    const state = createBaseState();
    const decision = detectNextFlowDecision(state);

    expect(decision.kind).toBe("step");
    if (decision.kind === "step") {
      expect(decision.step.id).toBe(FLOW_STEPS["create-test-plan"].id);
    }
  });

  test("AC01: resolves from canonical phase order even when current_phase is stale", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "define";
    });
    const decision = detectNextFlowDecision(state);

    expect(decision.kind).toBe("step");
    if (decision.kind === "step") {
      expect(decision.step.id).toBe(FLOW_STEPS["create-test-plan"].id);
    }
  });

  test("AC02 + AC03: delegates to existing handlers and re-reads state between chained steps", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "pending";
      s.phases.prototype.test_plan.status = "pending";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "pending";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
    });
    const s3 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = false;
    });

    const reads: State[] = [s1, s2, s3];
    let readCount = 0;
    const called: string[] = [];

    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runCreatePrototypeFn: async () => {
          called.push(FLOW_STEPS["create-prototype"].id);
        },
        runCreateTestPlanFn: async () => {
          called.push(FLOW_STEPS["create-test-plan"].id);
        },
        runCreateProjectContextFn: async () => {
          called.push(FLOW_STEPS["create-project-context"].id);
        },
        runDefineRequirementFn: async () => {
          called.push(FLOW_STEPS["define-requirement"].id);
        },
        runExecuteTestPlanFn: async () => {
          called.push(FLOW_STEPS["execute-test-plan"].id);
        },
        runDefineRefactorPlanFn: async () => {
          called.push(FLOW_STEPS["define-refactor-plan"].id);
        },
        runExecuteRefactorFn: async () => {
          called.push(FLOW_STEPS["execute-refactor"].id);
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: () => {},
      },
    );

    expect(called).toEqual([FLOW_STEPS["create-test-plan"].id, FLOW_STEPS["create-prototype"].id]);
    expect(readCount).toBe(3);
  });

  test("AC04: stops at approval gate and when iteration is complete", async () => {
    const approvalGateState = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "pending_approval";
      s.phases.prototype.test_plan.file = "it_000019_test-plan.md";
    });

    const completeState = withState(createBaseState(), (s) => {
      s.current_phase = "refactor";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = true;
      s.phases.refactor.evaluation_report.status = "created";
      s.phases.refactor.refactor_plan.status = "approved";
      s.phases.refactor.refactor_execution.status = "completed";
    });

    const logs: string[] = [];
    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => approvalGateState,
        stdoutWriteFn: (message) => logs.push(message),
        stderrWriteFn: () => {},
      },
    );
    expect(logs.some((line) => line.includes("Waiting for approval"))).toBe(true);

    logs.length = 0;
    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => completeState,
        stdoutWriteFn: (message) => logs.push(message),
        stderrWriteFn: () => {},
      },
    );
    expect(logs).toContain("Iteration 000019 complete. All phases finished.");
  });

  test("AC05: prompts for provider from stdin when --agent is not provided", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "define";
      s.phases.define.requirement_definition.status = "pending";
      s.phases.define.prd_generation.status = "pending";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "define";
      s.phases.define.requirement_definition.status = "in_progress";
      s.phases.define.prd_generation.status = "pending";
    });

    const reads: State[] = [s1, s2];
    let readCount = 0;
    let delegatedProvider = "";
    const out: string[] = [];

    await runFlow(
      {},
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        readLineFn: async () => "codex",
        runDefineRequirementFn: async (opts) => {
          delegatedProvider = opts.provider;
        },
        stdoutWriteFn: (message) => out.push(message),
        stderrWriteFn: () => {},
      },
    );

    expect(out).toContain("Enter agent provider:");
    expect(delegatedProvider).toBe("codex");
  });

  test("AC06: passes --force through to delegated handlers (guardrail behavior parity)", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "pending";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
    });

    const reads: State[] = [s1, s2];
    let readCount = 0;
    let receivedForce = false;

    await runFlow(
      { provider: "codex", force: true },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runCreatePrototypeFn: async (opts) => {
          receivedForce = opts.force ?? false;
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: () => {},
      },
    );

    expect(receivedForce).toBe(true);
  });

  test("AC07: stops immediately on delegated command error, writes to stderr, and sets non-zero exit", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "pending";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.test_execution.status = "pending";
    });

    const reads: State[] = [s1, s2];
    let readCount = 0;
    let nextCalled = false;
    const errors: string[] = [];

    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runCreatePrototypeFn: async () => {
          throw new Error("boom");
        },
        runCreateTestPlanFn: async () => {
          nextCalled = true;
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: (message) => errors.push(message),
      },
    );

    expect(nextCalled).toBe(false);
    expect(errors).toContain("boom");
    expect(process.exitCode).toBe(1);
  });

  test("AC07: rethrows GuardrailAbortError without duplicate stderr output or exit mutation", async () => {
    const base = createBaseState();
    const state = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "pending";
    });

    const errors: string[] = [];
    process.exitCode = undefined;

    await expect(
      runFlow(
        { provider: "codex" },
        {
          readStateFn: async () => state,
          runCreatePrototypeFn: async () => {
            throw new GuardrailAbortError();
          },
          stdoutWriteFn: () => {},
          stderrWriteFn: (message) => errors.push(message),
        },
      ),
    ).rejects.toBeInstanceOf(GuardrailAbortError);

    expect(errors).toEqual([]);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });

  test("AC08: treats prototype_build in_progress as resumable and re-executes create-prototype", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "in_progress";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
    });

    const reads: State[] = [s1, s2];
    let readCount = 0;
    let rerunCount = 0;

    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runCreatePrototypeFn: async () => {
          rerunCount += 1;
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: () => {},
      },
    );

    expect(rerunCount).toBe(1);
  });

  test("AC08: treats test_execution in_progress as resumable and re-executes execute-test-plan", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "in_progress";
      s.phases.prototype.test_execution.file = "it_000019_test-execution-results.json";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
    });

    const reads: State[] = [s1, s2];
    let readCount = 0;
    let rerunCount = 0;

    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runExecuteTestPlanFn: async () => {
          rerunCount += 1;
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: () => {},
      },
    );

    expect(rerunCount).toBe(1);
  });

  test("AC08: treats refactor_execution in_progress as resumable and re-executes execute-refactor", async () => {
    const base = createBaseState();
    const s1 = withState(base, (s) => {
      s.current_phase = "refactor";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = true;
      s.phases.refactor.evaluation_report.status = "created";
      s.phases.refactor.refactor_plan.status = "approved";
      s.phases.refactor.refactor_execution.status = "in_progress";
      s.phases.refactor.refactor_execution.file = "it_000019_refactor-execution-progress.json";
    });
    const s2 = withState(base, (s) => {
      s.current_phase = "refactor";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = true;
      s.phases.refactor.evaluation_report.status = "created";
      s.phases.refactor.refactor_plan.status = "approved";
      s.phases.refactor.refactor_execution.status = "completed";
    });

    const reads: State[] = [s1, s2];
    let readCount = 0;
    let rerunCount = 0;

    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runExecuteRefactorFn: async () => {
          rerunCount += 1;
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: () => {},
      },
    );

    expect(rerunCount).toBe(1);
  });

  test("AC09: delegated handlers used by flow do not call process.exit()", async () => {
    const commandFiles = [
      "define-requirement.ts",
      "create-project-context.ts",
      "create-prototype.ts",
      "create-test-plan.ts",
      "execute-test-plan.ts",
      "define-refactor-plan.ts",
      "execute-refactor.ts",
    ];

    for (const fileName of commandFiles) {
      const source = await readFile(join(import.meta.dir, fileName), "utf8");
      expect(source).not.toContain("process.exit(");
    }
  });
});

describe("US-003: completion message when iteration is finished", () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode ?? 0;
  });

  test("US-003-AC01 + US-003-AC02: prints completion summary, exits 0, and does not attempt further steps", async () => {
    const completeState = withState(createBaseState(), (s) => {
      s.current_iteration = "000019";
      s.current_phase = "refactor";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = true;
      s.phases.refactor.evaluation_report.status = "created";
      s.phases.refactor.refactor_plan.status = "approved";
      s.phases.refactor.refactor_execution.status = "completed";
    });

    const logs: string[] = [];
    let delegatedCalls = 0;

    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => completeState,
        runCreateProjectContextFn: async () => {
          delegatedCalls += 1;
        },
        runCreatePrototypeFn: async () => {
          delegatedCalls += 1;
        },
        runCreateTestPlanFn: async () => {
          delegatedCalls += 1;
        },
        runDefineRefactorPlanFn: async () => {
          delegatedCalls += 1;
        },
        runDefineRequirementFn: async () => {
          delegatedCalls += 1;
        },
        runExecuteRefactorFn: async () => {
          delegatedCalls += 1;
        },
        runExecuteTestPlanFn: async () => {
          delegatedCalls += 1;
        },
        stdoutWriteFn: (message) => logs.push(message),
        stderrWriteFn: () => {},
      },
    );

    expect(logs).toContain("Iteration 000019 complete. All phases finished.");
    expect(delegatedCalls).toBe(0);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });
});

describe("US-002: approval gate messaging", () => {
  test("US-002-AC01 + US-002-AC02: requirement in_progress is an approval gate and prints exact next command", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "define";
      s.phases.define.requirement_definition.status = "in_progress";
    });

    const decision = detectNextFlowDecision(state);
    expect(decision.kind).toBe("approval_gate");
    if (decision.kind === "approval_gate") {
      expect(decision.message).toBe(buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.requirement));
      expect(decision.message.startsWith(FLOW_APPROVAL_GATE_PREFIX)).toBe(true);
    }
  });

  test("US-002-AC01 + US-002-AC02: test-plan approval gate prints exact next command", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "pending_approval";
      s.phases.prototype.test_plan.file = "it_000019_test-plan.md";
    });

    const decision = detectNextFlowDecision(state);
    expect(decision.kind).toBe("approval_gate");
    if (decision.kind === "approval_gate") {
      expect(decision.message).toBe(buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.testPlan));
      expect(decision.message.startsWith(FLOW_APPROVAL_GATE_PREFIX)).toBe(true);
    }
  });

  test("US-002-AC01 + US-002-AC02: prototype approval gate prints exact next command", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = false;
    });

    const decision = detectNextFlowDecision(state);
    expect(decision.kind).toBe("approval_gate");
    if (decision.kind === "approval_gate") {
      expect(decision.message).toBe(buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.prototype));
      expect(decision.message.startsWith(FLOW_APPROVAL_GATE_PREFIX)).toBe(true);
    }
  });

  test("US-002-AC01 + US-002-AC02: refactor-plan approval gate prints exact next command", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "refactor";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = true;
      s.phases.refactor.refactor_plan.status = "pending_approval";
      s.phases.refactor.refactor_plan.file = "it_000019_refactor-plan.md";
    });

    const decision = detectNextFlowDecision(state);
    expect(decision.kind).toBe("approval_gate");
    if (decision.kind === "approval_gate") {
      expect(decision.message).toBe(buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.refactorPlan));
      expect(decision.message.startsWith(FLOW_APPROVAL_GATE_PREFIX)).toBe(true);
    }
  });

  test("US-002-AC01: runFlow stops at approval gate with exit code 0", async () => {
    const gateState = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "pending_approval";
      s.phases.prototype.test_plan.file = "it_000019_test-plan.md";
    });

    const logs: string[] = [];
    process.exitCode = undefined;
    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => gateState,
        stdoutWriteFn: (message) => logs.push(message),
        stderrWriteFn: () => {},
      },
    );

    expect(logs).toContain(buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.testPlan));
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });

  test("US-002-AC03: flow resumes on re-run after approval", async () => {
    const gateState = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.test_plan.status = "pending_approval";
      s.phases.prototype.test_plan.file = "it_000019_test-plan.md";
    });
    const resumedState = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.test_execution.status = "in_progress";
      s.phases.prototype.test_execution.file = "it_000019_test-execution-results.json";
      s.phases.prototype.prototype_approved = false;
    });
    const nextGateState = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.prototype_build.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "created";
      s.phases.prototype.test_execution.status = "completed";
      s.phases.prototype.prototype_approved = false;
    });

    const firstRunLogs: string[] = [];
    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => gateState,
        stdoutWriteFn: (message) => firstRunLogs.push(message),
        stderrWriteFn: () => {},
      },
    );
    expect(firstRunLogs).toContain(buildApprovalGateMessage(FLOW_APPROVAL_TARGETS.testPlan));

    const reads: State[] = [resumedState, nextGateState];
    let readCount = 0;
    let executedTestPlan = 0;
    await runFlow(
      { provider: "codex" },
      {
        readStateFn: async () => reads[Math.min(readCount++, reads.length - 1)],
        runExecuteTestPlanFn: async () => {
          executedTestPlan += 1;
        },
        stdoutWriteFn: () => {},
        stderrWriteFn: () => {},
      },
    );

    expect(executedTestPlan).toBe(1);
  });
});

describe("US-004: schema alignment and edge-case flow resolution", () => {
  test("US-004-AC01: resolver accepts every schema status for refactor.evaluation_report", () => {
    const evaluationStatuses = StateSchema.shape.phases.shape.refactor.shape.evaluation_report.shape.status.options;

    for (const status of evaluationStatuses) {
      const state = withState(createBaseState(), (s) => {
        s.current_phase = "refactor";
        s.phases.prototype.project_context.status = "created";
        s.phases.prototype.test_plan.status = "created";
        s.phases.prototype.tp_generation.status = "created";
        s.phases.prototype.prototype_build.status = "created";
        s.phases.prototype.test_execution.status = "completed";
        s.phases.prototype.prototype_approved = true;
        s.phases.refactor.evaluation_report.status = status;
        s.phases.refactor.refactor_plan.status = "pending";
      });

      const decision = detectNextFlowDecision(state);
      if (decision.kind === "blocked") {
        expect(decision.message).not.toContain("phases.refactor.evaluation_report");
      }
    }
  });

  test("US-004-AC01: resolver accepts every schema status for refactor.changelog", () => {
    const changelogStatuses = StateSchema.shape.phases.shape.refactor.shape.changelog.shape.status.options;

    for (const status of changelogStatuses) {
      const state = withState(createBaseState(), (s) => {
        s.current_phase = "refactor";
        s.phases.prototype.project_context.status = "created";
        s.phases.prototype.test_plan.status = "created";
        s.phases.prototype.tp_generation.status = "created";
        s.phases.prototype.prototype_build.status = "created";
        s.phases.prototype.test_execution.status = "completed";
        s.phases.prototype.prototype_approved = true;
        s.phases.refactor.evaluation_report.status = "created";
        s.phases.refactor.refactor_plan.status = "approved";
        s.phases.refactor.refactor_execution.status = "completed";
        s.phases.refactor.changelog.status = status;
      });

      const decision = detectNextFlowDecision(state);
      expect(decision.kind).toBe("complete");
    }
  });

  test("US-004-AC02: ignores unexpected current_phase values and resolves from canonical phases", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "define";
      s.phases.define.requirement_definition.status = "pending";
      s.phases.define.prd_generation.status = "pending";
    });
    (state as unknown as { current_phase: string }).current_phase = "unexpected_phase";

    const decision = detectNextFlowDecision(state);
    expect(decision.kind).toBe("step");
    if (decision.kind === "step") {
      expect(decision.step.id).toBe(FLOW_STEPS["define-requirement"].id);
    }
  });

  test("US-004-AC03: partially-updated prototype state is blocked with deterministic message", () => {
    const state = withState(createBaseState(), (s) => {
      s.current_phase = "prototype";
      s.phases.prototype.project_context.status = "created";
      s.phases.prototype.test_plan.status = "created";
      s.phases.prototype.tp_generation.status = "pending";
      s.phases.prototype.prototype_build.status = "pending";
    });

    const decision = detectNextFlowDecision(state);
    expect(decision.kind).toBe("blocked");
    if (decision.kind === "blocked") {
      expect(decision.message).toBe("No runnable flow step found for phases.prototype.tp_generation.");
    }
  });
});

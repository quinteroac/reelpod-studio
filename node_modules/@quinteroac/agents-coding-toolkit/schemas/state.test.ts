import { describe, expect, test } from "bun:test";

import { StateSchema as ScaffoldStateSchema } from "../scaffold/schemas/tmpl_state";
import { StateSchema as WorkingCopyStateSchema } from "./state";

function makeValidState(): Record<string, unknown> {
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
    last_updated: "2026-01-01T00:00:00.000Z",
  };
}

describe("US-003 state schema parity", () => {
  test("US-003-AC01/AC02/AC05: both schemas accept state without flow_guardrail", () => {
    const input = makeValidState();

    expect(ScaffoldStateSchema.safeParse(input).success).toBe(true);
    expect(WorkingCopyStateSchema.safeParse(input).success).toBe(true);
  });

  test("US-003-AC01/AC02: both schemas accept flow_guardrail='strict' and 'relaxed'", () => {
    const strictInput = { ...makeValidState(), flow_guardrail: "strict" };
    const relaxedInput = { ...makeValidState(), flow_guardrail: "relaxed" };

    expect(ScaffoldStateSchema.safeParse(strictInput).success).toBe(true);
    expect(ScaffoldStateSchema.safeParse(relaxedInput).success).toBe(true);
    expect(WorkingCopyStateSchema.safeParse(strictInput).success).toBe(true);
    expect(WorkingCopyStateSchema.safeParse(relaxedInput).success).toBe(true);
  });

  test("US-003-AC01/AC02: both schemas reject non-enum flow_guardrail", () => {
    const invalidInput = { ...makeValidState(), flow_guardrail: "lenient" };

    expect(ScaffoldStateSchema.safeParse(invalidInput).success).toBe(false);
    expect(WorkingCopyStateSchema.safeParse(invalidInput).success).toBe(false);
  });
});

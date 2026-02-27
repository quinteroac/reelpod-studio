import { describe, expect, test } from "bun:test";

import { TestPlanSchema } from "../scaffold/schemas/tmpl_test-plan";

describe("TestPlanSchema", () => {
  test("accepts enhanced test plan metadata structure", () => {
    const validation = TestPlanSchema.safeParse({
      overallStatus: "pending",
      scope: ["Validate login flow and session persistence"],
      environmentData: ["Node 22", "Chromium latest", "seeded test users"],
      automatedTests: [
        {
          id: "TC-001",
          description: "POST /login returns 200 for valid credentials",
          status: "passed",
          correlatedRequirements: ["US-001", "FR-1"],
        },
      ],
      exploratoryManualTests: [
        {
          id: "TC-002",
          description: "Visual check of error message clarity for invalid login",
          status: "skipped",
          correlatedRequirements: ["US-001"],
        },
      ],
    });

    expect(validation.success).toBe(true);
    if (!validation.success) {
      throw new Error("Expected enhanced test plan payload to be valid");
    }

    expect(validation.data.overallStatus).toBe("pending");
    expect(validation.data.environmentData).toEqual([
      "Node 22",
      "Chromium latest",
      "seeded test users",
    ]);
    expect(validation.data.automatedTests[0]?.correlatedRequirements).toEqual(["US-001", "FR-1"]);
  });

  test("rejects legacy flat-list schema shape", () => {
    const validation = TestPlanSchema.safeParse({
      scope: ["Legacy scope"],
      automatedTests: ["legacy test line item"],
      exploratoryManualTests: ["legacy manual line item"],
      environmentAndData: ["legacy env entry"],
    });

    expect(validation.success).toBe(false);
  });
});

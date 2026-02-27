import { z } from "zod";

const TestStatusSchema = z.enum(["pending", "passed", "failed", "skipped"]);

const TestItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: TestStatusSchema,
  correlatedRequirements: z.array(z.string()),
});

export const TestPlanSchema = z.object({
  overallStatus: TestStatusSchema,
  scope: z.array(z.string()),
  environmentData: z.array(z.string()),
  automatedTests: z.array(TestItemSchema),
  exploratoryManualTests: z.array(TestItemSchema),
});

export type TestPlan = z.infer<typeof TestPlanSchema>;

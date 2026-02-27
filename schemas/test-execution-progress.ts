import { z } from "zod";

const TestExecutionProgressEntrySchema = z.object({
  id: z.string(),
  type: z.enum(["automated", "exploratory_manual"]),
  status: z.enum(["pending", "in_progress", "passed", "failed"]),
  attempt_count: z.number().int().nonnegative(),
  last_agent_exit_code: z.number().int().nullable(),
  last_error_summary: z.string(),
  updated_at: z.string(),
});

export const TestExecutionProgressSchema = z.object({
  entries: z.array(TestExecutionProgressEntrySchema),
});

export type TestExecutionProgress = z.infer<typeof TestExecutionProgressSchema>;

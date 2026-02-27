import { z } from "zod";

const RefactorExecutionEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  attempt_count: z.number().int(),
  last_agent_exit_code: z.number().int().nullable(),
  updated_at: z.string(),
});

export const RefactorExecutionProgressSchema = z.object({
  entries: z.array(RefactorExecutionEntrySchema),
});

export type RefactorExecutionProgress = z.infer<typeof RefactorExecutionProgressSchema>;

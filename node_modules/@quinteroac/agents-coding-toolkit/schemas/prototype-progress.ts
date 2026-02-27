import { z } from "zod";

const PrototypeProgressEntrySchema = z.object({
  use_case_id: z.string(),
  status: z.enum(["pending", "failed", "completed"]),
  attempt_count: z.number().int().nonnegative(),
  last_agent_exit_code: z.number().int().nullable(),
  quality_checks: z.array(
    z.object({
      command: z.string(),
      exit_code: z.number().int(),
    }),
  ),
  last_error_summary: z.string(),
  updated_at: z.string(),
});

export const PrototypeProgressSchema = z.object({
  entries: z.array(PrototypeProgressEntrySchema),
});

export type PrototypeProgress = z.infer<typeof PrototypeProgressSchema>;

import { z } from "zod";

const implementationStatus = z.enum(["pending", "in_progress", "completed"]);
const testStatus = z.enum([
  "pending",
  "written",
  "passed",
  "failed",
  "fixed",
  "unfixed",
]);

const implementation = z.object({
  status: implementationStatus,
  summary_of_actions: z.string(),
  learnings: z.string(),
});

const testEntry = z.object({
  id: z.string(),
  description: z.string(),
  status: testStatus,
  file: z.string().optional(),
  last_run: z.string().optional(),
  error: z.string().optional(),
});

const progressEntry = z.object({
  use_case_id: z.string(),
  timestamp: z.string(),
  implementation,
  tests: z.array(testEntry),
});

export const ProgressSchema = z.object({
  entries: z.array(progressEntry),
});

export type Progress = z.infer<typeof ProgressSchema>;

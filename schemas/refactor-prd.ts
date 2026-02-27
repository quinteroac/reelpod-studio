import { z } from "zod";

const RefactorItemSchema = z.object({
  id: z.string().regex(/^RI-\d{3}$/),
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
});

export const RefactorPrdSchema = z.object({
  refactorItems: z.array(RefactorItemSchema).min(1),
});

export type RefactorPrd = z.infer<typeof RefactorPrdSchema>;

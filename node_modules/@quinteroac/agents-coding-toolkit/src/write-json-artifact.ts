import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodSchema } from "zod";

export type WriteJsonArtifactFn = (
  absolutePath: string,
  schema: ZodSchema,
  data: unknown,
) => Promise<void>;

/**
 * Schema-validated JSON artifact writer.
 *
 * Validates `data` against `schema` then writes pretty-printed JSON to
 * `absolutePath`, creating parent directories as needed.  This is the
 * in-process equivalent of `nvst write-json` for commands that need to
 * write iteration-scoped `.agents/flow/` artifacts without spawning a
 * subprocess.
 */
export async function writeJsonArtifact(
  absolutePath: string,
  schema: ZodSchema,
  data: unknown,
): Promise<void> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `writeJsonArtifact: schema validation failed for ${absolutePath}.\n${JSON.stringify(result.error.format(), null, 2)}`,
    );
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(result.data, null, 2)}\n`, "utf-8");
}

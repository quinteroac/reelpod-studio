import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ZodSchema } from "zod";

import { StateSchema } from "../../scaffold/schemas/tmpl_state";
import { ProgressSchema } from "../../scaffold/schemas/tmpl_progress";
import { PrdSchema } from "../../scaffold/schemas/tmpl_prd";
import { RefactorPrdSchema } from "../../scaffold/schemas/tmpl_refactor-prd";
import { RefactorExecutionProgressSchema } from "../../scaffold/schemas/tmpl_refactor-execution-progress";
import { TestPlanSchema } from "../../scaffold/schemas/tmpl_test-plan";
import { IssuesSchema } from "../../scaffold/schemas/tmpl_issues";

// ---------------------------------------------------------------------------
// Schema registry — maps CLI name → Zod schema
// ---------------------------------------------------------------------------
const SCHEMA_REGISTRY: Record<string, ZodSchema> = {
  state: StateSchema,
  progress: ProgressSchema,
  prd: PrdSchema,
  "refactor-prd": RefactorPrdSchema,
  "refactor-execution-progress": RefactorExecutionProgressSchema,
  "test-plan": TestPlanSchema,
  issues: IssuesSchema,
};

const SUPPORTED_SCHEMAS = Object.keys(SCHEMA_REGISTRY).join(", ");

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------
function extractFlag(args: string[], flag: string): { value: string | null; remaining: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1) return { value: null, remaining: args };
  if (idx + 1 >= args.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  const value = args[idx + 1];
  const remaining = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { value, remaining };
}

// ---------------------------------------------------------------------------
// Read JSON payload from stdin (non-blocking, returns null if nothing piped)
// ---------------------------------------------------------------------------
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export interface WriteJsonOptions {
  args: string[];
}

export async function runWriteJson({ args }: WriteJsonOptions): Promise<void> {
  // --- Parse --schema ---
  const { value: schemaName, remaining: afterSchema } = extractFlag(args, "--schema");
  if (!schemaName) {
    console.error("Error: --schema <name> is required.");
    console.error(`Supported schemas: ${SUPPORTED_SCHEMAS}`);
    process.exitCode = 1;
    return;
  }

  const schema = SCHEMA_REGISTRY[schemaName];
  if (!schema) {
    console.error(`Error: Unknown schema "${schemaName}".`);
    console.error(`Supported schemas: ${SUPPORTED_SCHEMAS}`);
    process.exitCode = 1;
    return;
  }

  // --- Parse --out ---
  const { value: outPath, remaining: afterOut } = extractFlag(afterSchema, "--out");
  if (!outPath) {
    console.error("Error: --out <path> is required.");
    process.exitCode = 1;
    return;
  }

  // --- Parse --data (optional) ---
  const { value: dataArg, remaining: afterData } = extractFlag(afterOut, "--data");
  const unknownArgs = afterData.filter((arg) => arg !== "--force");

  // Reject unknown args
  if (unknownArgs.length > 0) {
    console.error(`Error: Unknown option(s): ${unknownArgs.join(" ")}`);
    process.exitCode = 1;
    return;
  }

  // --- Obtain JSON payload ---
  let rawJson: string;
  if (dataArg) {
    rawJson = dataArg;
  } else {
    // Read from stdin
    rawJson = await readStdin();
    if (!rawJson.trim()) {
      console.error("Error: No JSON payload provided. Use --data '<json>' or pipe via stdin.");
      process.exitCode = 1;
      return;
    }
  }

  // --- Parse JSON string ---
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    console.error("Error: Invalid JSON input.");
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  // --- Validate against schema ---
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const formatted = result.error.format();
    console.error(JSON.stringify({ ok: false, schema: schemaName, errors: formatted }, null, 2));
    process.exitCode = 1;
    return;
  }

  // --- Write file ---
  const resolvedPath = resolve(process.cwd(), outPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  const content = `${JSON.stringify(result.data, null, 2)}\n`;
  await writeFile(resolvedPath, content, "utf-8");

  console.log(`Written: ${outPath}`);
}

import { StateSchema } from "./tmpl_state";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const path = join(import.meta.dir, "..", ".agents", "tmpl_state.example.json");
const raw = JSON.parse(await readFile(path, "utf-8"));
const result = StateSchema.safeParse(raw);
if (result.success) {
  console.log("tmpl_state.example.json is valid");
} else {
  console.error("tmpl_state.example.json validation failed:", result.error.flatten());
  process.exitCode = 1;
}

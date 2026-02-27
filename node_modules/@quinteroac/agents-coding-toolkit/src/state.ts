import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { StateSchema, type State } from "../scaffold/schemas/tmpl_state";

export const STATE_REL_PATH = join(".agents", "state.json");
export const FLOW_REL_DIR = join(".agents", "flow");

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readState(projectRoot: string): Promise<State> {
  const statePath = join(projectRoot, STATE_REL_PATH);
  try {
    const raw = await readFile(statePath, "utf8");
    let json: unknown;

    try {
      json = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Malformed JSON in state file at ${statePath}.`, { cause: error });
      }
      throw error;
    }

    const parsed = StateSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`State file at ${statePath} failed schema validation.`, {
        cause: parsed.error,
      });
    }

    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`State file not found at ${statePath}.`, { cause: error });
    }
    throw error;
  }
}

export async function writeState(projectRoot: string, state: State): Promise<void> {
  const statePath = join(projectRoot, STATE_REL_PATH);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

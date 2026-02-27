import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("US-001: flow CLI routing and usage", () => {
  test("cli.ts routes `flow` command to runFlow handler", async () => {
    const source = await readFile(join(import.meta.dir, "cli.ts"), "utf8");
    expect(source).toContain('import { runFlow } from "./commands/flow"');
    expect(source).toContain('if (command === "flow")');
    expect(source).toContain("await runFlow({ provider, force })");
  });

  test("printUsage includes flow command help text", async () => {
    const source = await readFile(join(import.meta.dir, "cli.ts"), "utf8");
    expect(source).toContain("flow [--agent <provider>] [--force]");
    expect(source).toContain("Run the next pending flow step(s) until an approval gate or completion");
  });
});

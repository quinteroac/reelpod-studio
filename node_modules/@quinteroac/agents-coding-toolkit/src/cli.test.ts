import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("US-005: execute refactor CLI routing and help text", () => {
  // AC01: cli.ts routes `execute refactor` to runExecuteRefactor handler
  test("cli.ts routes execute refactor subcommand to runExecuteRefactor", async () => {
    const source = await readFile(join(import.meta.dir, "cli.ts"), "utf8");
    expect(source).toContain('import { runExecuteRefactor } from "./commands/execute-refactor"');
    expect(source).toContain('if (subcommand === "refactor")');
    expect(source).toContain("await runExecuteRefactor({ provider, force })");
  });

  // AC02: printUsage includes `execute refactor --agent <provider>` with a one-line description
  test("printUsage includes execute refactor --agent <provider> with one-line description", async () => {
    const source = await readFile(join(import.meta.dir, "cli.ts"), "utf8");
    expect(source).toContain("execute refactor --agent <provider>");
    expect(source).toContain("Execute approved refactor items via agent in order");
  });

  // AC03: Unknown options after --agent <provider> cause clear error and exit code 1
  test("unknown options after --agent <provider> cause clear error message and exit code 1", async () => {
    const cliPath = join(import.meta.dir, "cli.ts");
    const proc = Bun.spawn(
      ["bun", cliPath, "execute", "refactor", "--agent", "claude", "--unknown-flag"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderrText).toContain("Unknown option(s) for execute refactor");
    expect(stderrText).toContain("--unknown-flag");
  });

  // AC03: Multiple unknown options after --agent <provider> are all reported
  test("multiple unknown options after --agent <provider> are all listed in error message", async () => {
    const cliPath = join(import.meta.dir, "cli.ts");
    const proc = Bun.spawn(
      ["bun", cliPath, "execute", "refactor", "--agent", "claude", "--foo", "--bar"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderrText).toContain("Unknown option(s) for execute refactor");
    expect(stderrText).toContain("--foo");
    expect(stderrText).toContain("--bar");
  });
});

import { describe, expect, test } from "bun:test";

import { buildCommand, invokeAgent, parseAgentArg, parseProvider } from "./agent";

describe("agent provider parsing", () => {
  test("accepts cursor as a valid provider in --agent argument parsing", () => {
    const parsed = parseAgentArg(["create", "--agent", "cursor", "--force"]);

    expect(parsed.provider).toBe("cursor");
    expect(parsed.remainingArgs).toEqual(["create", "--force"]);
  });

  test("maps cursor provider to the Cursor agent CLI binary", () => {
    expect(parseProvider("cursor")).toBe("cursor");
    expect(buildCommand("cursor")).toEqual({ cmd: "agent", args: [] });
  });

  test("unknown provider error includes cursor in valid provider list", () => {
    expect(() => parseProvider("unknown-provider")).toThrow(
      "Unknown agent provider 'unknown-provider'. Valid providers: claude, codex, gemini, cursor",
    );
  });
});

describe("agent invocation command availability", () => {
  test("returns a clear error when cursor provider is selected but `agent` is not in PATH", async () => {
    await expect(
      invokeAgent({
        provider: "cursor",
        prompt: "Test prompt",
        resolveCommandPath: () => null,
      }),
    ).rejects.toThrow(
      "Cursor agent CLI is unavailable: `agent` command not found in PATH. Install/configure Cursor Agent CLI or use another provider.",
    );
  });
});

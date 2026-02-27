import { afterEach, describe, expect, test } from "bun:test";

import type { State } from "../scaffold/schemas/tmpl_state";
import { assertGuardrail, GuardrailAbortError } from "./guardrail";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeState(flow_guardrail?: "strict" | "relaxed"): State {
  return {
    current_iteration: "000001",
    current_phase: "define",
    flow_guardrail,
    phases: {
      define: {
        requirement_definition: { status: "pending", file: null },
        prd_generation: { status: "pending", file: null },
      },
      prototype: {
        project_context: { status: "pending", file: null },
        test_plan: { status: "pending", file: null },
        tp_generation: { status: "pending", file: null },
        prototype_build: { status: "pending", file: null },
        test_execution: { status: "pending", file: null },
        prototype_approved: false,
      },
      refactor: {
        evaluation_report: { status: "pending", file: null },
        refactor_plan: { status: "pending", file: null },
        refactor_execution: { status: "pending", file: null },
        changelog: { status: "pending", file: null },
      },
    },
    last_updated: "2026-01-01T00:00:00.000Z",
    updated_by: "test",
  };
}

/** Captures stderr writes without calling the real process.stderr.write. */
function makeStderrCapture(): { messages: string[]; fn: (msg: string) => void } {
  const messages: string[] = [];
  return {
    messages,
    fn: (msg: string) => messages.push(msg),
  };
}

afterEach(() => {
  // Reset exitCode after each test so tests don't bleed into each other
  process.exitCode = 0;
});

// ---------------------------------------------------------------------------
// No violation — no-op
// ---------------------------------------------------------------------------

describe("assertGuardrail – no violation", () => {
  test("returns immediately without side-effects when violated is false", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, false, "should not appear", {
      readLineFn: async () => null,
      stderrWriteFn: stderr.fn,
    });

    expect(stderr.messages).toHaveLength(0);
    expect(process.exitCode).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Strict mode (default)
// ---------------------------------------------------------------------------

describe("assertGuardrail – strict mode", () => {
  test("US-003-AC03: strict mode throws the same violation message and never prompts", async () => {
    const state = makeState("strict");
    let promptCalled = false;

    await expect(
      assertGuardrail(state, true, "current_phase is 'prototype' but 'define' is required.", {
        readLineFn: async () => {
          promptCalled = true;
          return "y";
        },
        stderrWriteFn: () => {},
      }),
    ).rejects.toThrow("current_phase is 'prototype' but 'define' is required.");
    expect(promptCalled).toBe(false);
  });

  test("throws Error (not GuardrailAbortError) in strict mode", async () => {
    const state = makeState("strict");

    await expect(
      assertGuardrail(state, true, "some violation", {
        stderrWriteFn: () => {},
      }),
    ).rejects.not.toBeInstanceOf(GuardrailAbortError);
  });

  test("US-003-AC04: absent flow_guardrail defaults to strict hard-error behavior", async () => {
    const state = makeState(undefined);
    let promptCalled = false;

    await expect(
      assertGuardrail(state, true, "strict default violation", {
        readLineFn: async () => {
          promptCalled = true;
          return "y";
        },
        stderrWriteFn: () => {},
      }),
    ).rejects.toThrow("strict default violation");
    expect(promptCalled).toBe(false);
  });

  test("does not print warning to stderr in strict mode without force", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("strict");

    await assertGuardrail(state, true, "msg", {
      stderrWriteFn: stderr.fn,
    }).catch(() => {});

    expect(stderr.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Relaxed mode — US-001-AC01, AC02, AC06
// ---------------------------------------------------------------------------

describe("assertGuardrail – relaxed mode, warning and prompt", () => {
  // US-001-AC01: warning to stderr
  test("US-001-AC01: prints 'Warning: <message>' to stderr first", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(
      state,
      true,
      "current_phase is 'prototype' but 'define' is required.",
      {
        readLineFn: async () => "y",
        stderrWriteFn: stderr.fn,
      },
    );

    expect(stderr.messages[0]).toBe(
      "Warning: current_phase is 'prototype' but 'define' is required.",
    );
  });

  // US-001-AC02: confirmation prompt after warning
  test("US-001-AC02: prints 'Proceed anyway? [y/N]' immediately after the warning", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "violation msg", {
      readLineFn: async () => "y",
      stderrWriteFn: stderr.fn,
    });

    expect(stderr.messages[1]).toBe("Proceed anyway? [y/N]");
  });

  // US-001-AC06: output goes to stderr (tested implicitly via stderrWriteFn being the only channel)
  test("US-001-AC06: warning and prompt are sent to stderrWriteFn (stderr), not stdout", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => "y",
      stderrWriteFn: stderr.fn,
    });

    // stderrWriteFn was called with warning and prompt
    expect(stderr.messages).toContain("Warning: msg");
    expect(stderr.messages).toContain("Proceed anyway? [y/N]");
  });
});

// ---------------------------------------------------------------------------
// Relaxed mode — confirmed (US-001-AC03)
// ---------------------------------------------------------------------------

describe("assertGuardrail – relaxed mode, confirmed", () => {
  test("US-001-AC03: resolves without error when user enters 'y'", async () => {
    const state = makeState("relaxed");

    await expect(
      assertGuardrail(state, true, "msg", {
        readLineFn: async () => "y",
        stderrWriteFn: () => {},
      }),
    ).resolves.toBeUndefined();
  });

  test("US-001-AC03: resolves without error when user enters 'Y'", async () => {
    const state = makeState("relaxed");

    await expect(
      assertGuardrail(state, true, "msg", {
        readLineFn: async () => "Y",
        stderrWriteFn: () => {},
      }),
    ).resolves.toBeUndefined();
  });

  test("US-001-AC03: does not print 'Aborted.' when confirmed", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => "y",
      stderrWriteFn: stderr.fn,
    });

    expect(stderr.messages).not.toContain("Aborted.");
  });

  test("US-001-AC03: does not set process.exitCode when confirmed", async () => {
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => "y",
      stderrWriteFn: () => {},
    });

    expect(process.exitCode).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Relaxed mode — aborted (US-001-AC04)
// ---------------------------------------------------------------------------

describe("assertGuardrail – relaxed mode, aborted", () => {
  test("US-001-AC04: throws GuardrailAbortError when user enters 'n'", async () => {
    const state = makeState("relaxed");

    await expect(
      assertGuardrail(state, true, "msg", {
        readLineFn: async () => "n",
        stderrWriteFn: () => {},
      }),
    ).rejects.toBeInstanceOf(GuardrailAbortError);
  });

  test("US-001-AC04: throws GuardrailAbortError when user presses Enter (empty input)", async () => {
    const state = makeState("relaxed");

    await expect(
      assertGuardrail(state, true, "msg", {
        readLineFn: async () => "",
        stderrWriteFn: () => {},
      }),
    ).rejects.toBeInstanceOf(GuardrailAbortError);
  });

  test("US-001-AC04: throws GuardrailAbortError for any non-y/Y input", async () => {
    const state = makeState("relaxed");

    for (const input of ["no", "yes", "1", " ", "N"]) {
      await expect(
        assertGuardrail(state, true, "msg", {
          readLineFn: async () => input,
          stderrWriteFn: () => {},
        }),
      ).rejects.toBeInstanceOf(GuardrailAbortError);
    }
  });

  test("US-001-AC04: prints 'Aborted.' to stderr when user does not confirm", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => "n",
      stderrWriteFn: stderr.fn,
    }).catch(() => {});

    expect(stderr.messages).toContain("Aborted.");
  });

  test("US-001-AC04: sets process.exitCode to 1 when user does not confirm", async () => {
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => "n",
      stderrWriteFn: () => {},
    }).catch(() => {});

    expect(process.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Relaxed mode — stdin closed / not a TTY (US-001-AC05)
// ---------------------------------------------------------------------------

describe("assertGuardrail – relaxed mode, stdin closed", () => {
  test("US-001-AC05: throws GuardrailAbortError when readLineFn returns null (stdin closed)", async () => {
    const state = makeState("relaxed");

    await expect(
      assertGuardrail(state, true, "msg", {
        readLineFn: async () => null,
        stderrWriteFn: () => {},
      }),
    ).rejects.toBeInstanceOf(GuardrailAbortError);
  });

  test("US-001-AC05: prints 'Aborted.' to stderr when stdin is closed", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => null,
      stderrWriteFn: stderr.fn,
    }).catch(() => {});

    expect(stderr.messages).toContain("Aborted.");
  });

  test("US-001-AC05: sets process.exitCode to 1 when stdin is closed", async () => {
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "msg", {
      readLineFn: async () => null,
      stderrWriteFn: () => {},
    }).catch(() => {});

    expect(process.exitCode).toBe(1);
  });

  test("US-001-AC05: treats readLineFn throwing as closed stdin (abort)", async () => {
    const state = makeState("relaxed");

    await expect(
      assertGuardrail(state, true, "msg", {
        readLineFn: async () => {
          throw new Error("stdin read error");
        },
        stderrWriteFn: () => {},
      }),
    ).rejects.toBeInstanceOf(GuardrailAbortError);
  });
});

// ---------------------------------------------------------------------------
// force option — skips prompt (partial US-002 surface, verified by AC05 wording)
// ---------------------------------------------------------------------------

describe("assertGuardrail – force option", () => {
  test("with force=true and relaxed: prints warning but does not prompt or abort", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("relaxed");

    await assertGuardrail(state, true, "forced violation", {
      force: true,
      readLineFn: async () => {
        throw new Error("should not be called");
      },
      stderrWriteFn: stderr.fn,
    });

    expect(stderr.messages).toContain("Warning: forced violation");
    expect(stderr.messages).not.toContain("Proceed anyway? [y/N]");
    expect(stderr.messages).not.toContain("Aborted.");
    expect(process.exitCode).toBeFalsy();
  });

  test("with force=true and strict: prints warning and continues without throwing", async () => {
    const stderr = makeStderrCapture();
    const state = makeState("strict");

    await expect(
      assertGuardrail(state, true, "forced strict violation", {
        force: true,
        stderrWriteFn: stderr.fn,
      }),
    ).resolves.toBeUndefined();

    expect(stderr.messages).toContain("Warning: forced strict violation");
  });
});

// ---------------------------------------------------------------------------
// GuardrailAbortError identity
// ---------------------------------------------------------------------------

describe("GuardrailAbortError", () => {
  test("is an instance of Error", () => {
    const err = new GuardrailAbortError();
    expect(err).toBeInstanceOf(Error);
  });

  test("has message 'Aborted.'", () => {
    const err = new GuardrailAbortError();
    expect(err.message).toBe("Aborted.");
  });

  test("has name 'GuardrailAbortError'", () => {
    const err = new GuardrailAbortError();
    expect(err.name).toBe("GuardrailAbortError");
  });
});

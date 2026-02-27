import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { exists } from "./state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentProvider = "claude" | "codex" | "gemini" | "cursor";

export interface AgentInvokeOptions {
  provider: AgentProvider;
  prompt: string;
  cwd?: string;
  /** Use interactive mode (e.g. Codex TUI) so the agent can interview the user. */
  interactive?: boolean;
  resolveCommandPath?: ResolveCommandPath;
}

export interface AgentResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ResolveCommandPath = (command: string) => string | null | undefined;

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

const PROVIDERS: Record<AgentProvider, { cmd: string; args: string[] }> = {
  claude: { cmd: "claude", args: ["--dangerously-skip-permissions", "--print"] },
  codex: { cmd: "codex", args: ["exec", "--dangerously-bypass-approvals-and-sandbox"] },
  gemini: { cmd: "gemini", args: ["--yolo"] },
  cursor: { cmd: "agent", args: [] },
};

export function parseProvider(name: string): AgentProvider {
  if (name in PROVIDERS) return name as AgentProvider;
  const valid = Object.keys(PROVIDERS).join(", ");
  throw new Error(`Unknown agent provider '${name}'. Valid providers: ${valid}`);
}

export function buildCommand(provider: AgentProvider): { cmd: string; args: string[] } {
  return PROVIDERS[provider];
}

function defaultResolveCommandPath(command: string): string | null {
  const resolved = Bun.which(command);
  return resolved ?? null;
}

export function ensureAgentCommandAvailable(
  provider: AgentProvider,
  resolveCommandPath: ResolveCommandPath = defaultResolveCommandPath,
): void {
  const { cmd } = buildCommand(provider);
  if (resolveCommandPath(cmd)) return;

  if (provider === "cursor") {
    throw new Error(
      "Cursor agent CLI is unavailable: `agent` command not found in PATH. Install/configure Cursor Agent CLI or use another provider.",
    );
  }

  throw new Error(`Required CLI '${cmd}' for provider '${provider}' is not in PATH.`);
}

// ---------------------------------------------------------------------------
// Agent invocation
// ---------------------------------------------------------------------------
// For interactive interviews, claude/codex need a real TTY: pass prompt as
// positional arg and use stdin: "inherit" so the agent can read user input.
// ---------------------------------------------------------------------------

/** Codex interactive (TUI) args: no "exec", so it can read stdin for interview. */
const CODEX_INTERACTIVE_ARGS = ["--sandbox", "workspace-write"];

export async function invokeAgent(options: AgentInvokeOptions): Promise<AgentResult> {
  const {
    provider,
    prompt,
    cwd = process.cwd(),
    interactive = false,
    resolveCommandPath = defaultResolveCommandPath,
  } = options;
  const { cmd, args } = buildCommand(provider);
  ensureAgentCommandAvailable(provider, resolveCommandPath);

  let finalArgs: string[];
  let stdinOption: "ignore" | "inherit";
  if (provider === "gemini" && interactive) {
    // Interactive mode: drop -p so Gemini runs as a conversational session.
    // Flags must come before the positional prompt arg.
    finalArgs = [...args, prompt];
    stdinOption = "inherit";
  } else if (provider === "gemini") {
    finalArgs = [...args, "-p", prompt];
    stdinOption = "ignore";
  } else if (provider === "codex" && interactive) {
    // Codex interactive mode (no "exec"): prompt first, then TUI can read user input.
    finalArgs = [prompt, ...CODEX_INTERACTIVE_ARGS];
    stdinOption = "inherit";
  } else if (provider === "claude" && interactive) {
    // Interactive mode: drop --print so Claude runs as a conversational TUI.
    finalArgs = ["--dangerously-skip-permissions", prompt];
    stdinOption = "inherit";
  } else {
    // Claude or Codex exec: prompt as last arg, inherit stdin.
    finalArgs = [...args, prompt];
    stdinOption = "inherit";
  }

  // Interactive mode: use real TTY (inherit) so the agent stays in interactive mode and
  // waits for user input. The agent writes output via write-json or to a file.
  // Non-interactive: use pipe to capture stdout/stderr.
  const useTty = interactive;
  const proc = Bun.spawn([cmd, ...finalArgs], {
    cwd,
    stdin: stdinOption,
    stdout: useTty ? "inherit" : "pipe",
    stderr: useTty ? "inherit" : "pipe",
  });

  let exitCode: number;
  let stdoutStr: string;
  let stderrStr: string;

  if (useTty) {
    exitCode = await proc.exited;
    stdoutStr = "";
    stderrStr = "";
  } else {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const readStream = async (
      stream: ReadableStream<Uint8Array<ArrayBuffer>> | undefined,
      chunks: string[],
      passthrough?: { write: (chunk: Uint8Array) => void },
    ) => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value, { stream: true }));
          if (passthrough) passthrough.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    };
    await Promise.all([
      readStream(proc.stdout, stdoutChunks, process.stdout),
      readStream(proc.stderr, stderrChunks, process.stderr),
    ]);
    exitCode = await proc.exited;
    stdoutStr = stdoutChunks.join("");
    stderrStr = stderrChunks.join("");
  }

  return {
    exitCode,
    stdout: stdoutStr,
    stderr: stderrStr,
  };
}

// ---------------------------------------------------------------------------
// Skill loading
// ---------------------------------------------------------------------------

export async function loadSkill(projectRoot: string, skillName: string): Promise<string> {
  const skillPath = join(projectRoot, ".agents", "skills", skillName, "SKILL.md");
  if (!(await exists(skillPath))) {
    throw new Error(`Skill '${skillName}' not found at ${skillPath}`);
  }
  const raw = await readFile(skillPath, "utf8");
  return stripFrontmatter(raw);
}

function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return content;
  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) return content;
  return trimmed.slice(endIndex + 3).trimStart();
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

export function buildPrompt(skillBody: string, context: Record<string, string>): string {
  const parts = [skillBody];
  const entries = Object.entries(context);
  if (entries.length > 0) {
    parts.push("\n---\n\n## Context\n");
    for (const [key, value] of entries) {
      parts.push(`### ${key}\n\n${value}\n`);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// CLI arg parsing for --agent
// ---------------------------------------------------------------------------

export function parseAgentArg(args: string[]): {
  provider: AgentProvider;
  remainingArgs: string[];
} {
  const idx = args.indexOf("--agent");
  if (idx === -1 || idx + 1 >= args.length) {
    throw new Error("Missing required --agent <provider> argument.");
  }
  const provider = parseProvider(args[idx + 1]);
  const remainingArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { provider, remainingArgs };
}

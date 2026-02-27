#!/usr/bin/env bun

import { join } from "node:path";
import { parseAgentArg, parseProvider, type AgentProvider } from "./agent";
import { GuardrailAbortError } from "./guardrail";
import { runApproveProjectContext } from "./commands/approve-project-context";
import { runApprovePrototype } from "./commands/approve-prototype";
import { runApproveRefactorPlan } from "./commands/approve-refactor-plan";
import { runApproveRequirement } from "./commands/approve-requirement";
import { runApproveTestPlan } from "./commands/approve-test-plan";
import { runCreateIssue, runCreateIssueFromTestReport } from "./commands/create-issue";
import { runCreateProjectContext } from "./commands/create-project-context";
import { runCreatePrototype } from "./commands/create-prototype";
import { runCreateTestPlan } from "./commands/create-test-plan";
import { runDefineRefactorPlan } from "./commands/define-refactor-plan";
import { runDefineRequirement } from "./commands/define-requirement";
import { runDestroy } from "./commands/destroy";
import { runExecuteAutomatedFix } from "./commands/execute-automated-fix";
import { runExecuteManualFix } from "./commands/execute-manual-fix";
import { runExecuteRefactor } from "./commands/execute-refactor";
import { runExecuteTestPlan } from "./commands/execute-test-plan";
import { runFlow } from "./commands/flow";
import { runInit } from "./commands/init";
import { runRefineProjectContext } from "./commands/refine-project-context";
import { runRefineRefactorPlan } from "./commands/refine-refactor-plan";
import { runRefineRequirement } from "./commands/refine-requirement";
import { runRefineTestPlan } from "./commands/refine-test-plan";
import { runStartIteration } from "./commands/start-iteration";
import { runWriteJson } from "./commands/write-json";

function parseMode(args: string[]): { mode: "strict" | "yolo"; remainingArgs: string[] } {
  const idx = args.indexOf("--mode");
  if (idx === -1) {
    return { mode: "strict", remainingArgs: args };
  }
  if (idx + 1 >= args.length) {
    throw new Error("Missing value for --mode. Expected: strict or yolo.");
  }

  const mode = args[idx + 1];
  if (mode !== "strict" && mode !== "yolo") {
    throw new Error(`Invalid --mode '${mode}'. Expected: strict or yolo.`);
  }

  const remainingArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { mode, remainingArgs };
}

function extractFlagValue(args: string[], flag: string): { value: string | null; remainingArgs: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1) {
    return { value: null, remainingArgs: args };
  }

  if (idx + 1 >= args.length) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const value = args[idx + 1];
  return {
    value,
    remainingArgs: [...args.slice(0, idx), ...args.slice(idx + 2)],
  };
}

function parseOptionalIntegerFlag(
  args: string[],
  flag: "--iterations" | "--retry-on-fail",
  min: number,
): { value: number | undefined; remainingArgs: string[] } {
  const { value, remainingArgs } = extractFlagValue(args, flag);
  if (value === null) {
    return { value: undefined, remainingArgs };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `Invalid ${flag} value '${value}'. Expected an integer >= ${min}.`,
    );
  }

  return { value: parsed, remainingArgs };
}

function parseForce(args: string[]): { force: boolean; remainingArgs: string[] } {
  const force = args.includes("--force");
  return {
    force,
    remainingArgs: args.filter((arg) => arg !== "--force"),
  };
}

function parseOptionalAgentArg(args: string[]): {
  provider: AgentProvider | undefined;
  remainingArgs: string[];
} {
  const { value, remainingArgs } = extractFlagValue(args, "--agent");
  if (value === null) {
    return { provider: undefined, remainingArgs };
  }

  return {
    provider: parseProvider(value),
    remainingArgs,
  };
}

function printUsage() {
  console.log(`Usage: nvst <command> [options]

Commands:
  init               Initialize toolkit files in the current directory
  start iteration    Start a new iteration (archives previous if exists)
  create project-context --agent <provider> [--mode strict|yolo] [--force]
                     Generate/update .agents/PROJECT_CONTEXT.md via agent
  create test-plan --agent <provider> [--force]
                     Generate test plan document for current iteration
  create prototype --agent <provider> [--iterations <N>] [--retry-on-fail <N>] [--stop-on-critical]
                     Initialize prototype build for current iteration
  flow [--agent <provider>] [--force]
                     Run the next pending flow step(s) until an approval gate or completion
  create issue --agent <provider>
                     Create issues interactively via agent
  create issue --test-execution-report
                     Derive issues from test execution results
  approve project-context
                     Mark project context as approved
  approve test-plan
                     Mark test plan as approved and generate structured TP JSON
  approve prototype
                     Stage and commit all pending changes for current iteration
  approve refactor-plan
                     Mark refactor plan as approved and generate structured refactor PRD JSON
  refine project-context --agent <provider> [--challenge]
                     Refine project context via agent (editor or challenge mode)
  define requirement --agent <provider> [--force]
                     Create requirement document via agent
  define refactor-plan --agent <provider> [--force]
                     Create refactor plan document via agent
  refine requirement --agent <provider> [--challenge] [--force]
                     Refine requirement document via agent
  refine test-plan --agent <provider> [--challenge] [--force]
                     Refine test plan document via agent
  refine refactor-plan --agent <provider> [--challenge] [--force]
                     Refine refactor plan document via agent
  execute test-plan --agent <provider> [--force]
                     Execute approved structured test-plan JSON via agent
  execute automated-fix --agent <provider> [--iterations <N>] [--retry-on-fail <N>]
                     Attempt automated fixes for open issues in current iteration
  execute manual-fix --agent <provider>
                     Find manual-fix issues for current iteration and confirm execution
  execute refactor --agent <provider> [--force]
                     Execute approved refactor items via agent in order
  approve requirement
                     Mark requirement definition as approved
  write-json --schema <name> --out <path> [--data '<json>']
                     Write a schema-validated JSON file (payload via --data or stdin)
  destroy [--clean]  Remove files generated by nvst

Options:
  --agent            Agent provider (claude, codex, gemini, cursor) for agent-backed commands
  --mode             Create mode for project-context (strict or yolo)
  --iterations       Maximum prototype passes (integer >= 1)
  --retry-on-fail    Retry attempts per failed story (integer >= 0)
  --stop-on-critical Stop execution after critical failures
  --force            Bypass flow guardrail confirmation (and overwrite test-plan output)
  --challenge        Run refine in challenger mode
  --clean            When used with destroy, also removes .agents/flow/archived
  -h, --help         Show this help message
  -v, --version      Print version and exit`);
}

async function printVersion(): Promise<void> {
  const pkgPath = join(import.meta.dir, "..", "package.json");
  try {
    const pkg = (await Bun.file(pkgPath).json()) as { version?: string };
    console.log(pkg?.version ?? "unknown");
  } catch {
    console.log("unknown");
  }
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (command === "-v" || command === "--version") {
    await printVersion();
    return;
  }

  if (!command || command === "-h" || command === "--help" || command === "help") {
    printUsage();
    return;
  }

  if (command === "init") {
    const { remainingArgs: unknownArgs } = parseForce(args);
    if (unknownArgs.length > 0) {
      console.error(`Unknown option(s) for init: ${unknownArgs.join(" ")}`);
      printUsage();
      process.exitCode = 1;
      return;
    }
    await runInit();
    return;
  }

  if (command === "destroy") {
    const { remainingArgs: argsWithoutForce } = parseForce(args);
    const clean = argsWithoutForce.includes("--clean");
    const unknownArgs = argsWithoutForce.filter((arg) => arg !== "--clean");
    if (unknownArgs.length > 0) {
      console.error(`Unknown option(s) for destroy: ${unknownArgs.join(" ")}`);
      printUsage();
      process.exitCode = 1;
      return;
    }
    await runDestroy({ clean });
    return;
  }

  if (command === "start") {
    const { remainingArgs: argsWithoutForce } = parseForce(args);
    if (argsWithoutForce[0] !== "iteration" || argsWithoutForce.length !== 1) {
      console.error(`Usage for start: nvst start iteration`);
      printUsage();
      process.exitCode = 1;
      return;
    }
    await runStartIteration();
    return;
  }

  if (command === "flow") {
    try {
      const { provider, remainingArgs: postAgentArgs } = parseOptionalAgentArg(args);
      const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
      if (postForceArgs.length > 0) {
        console.error(`Unknown option(s) for flow: ${postForceArgs.join(" ")}`);
        printUsage();
        process.exitCode = 1;
        return;
      }
      await runFlow({ provider, force });
      return;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      printUsage();
      process.exitCode = 1;
      return;
    }
  }

  if (command === "create") {
    if (args.length === 0) {
      console.error(
        `Usage for create: nvst create <project-context|test-plan|prototype|issue> --agent <provider> [options]`,
      );
      printUsage();
      process.exitCode = 1;
      return;
    }

    const subcommand = args[0];

    if (subcommand === "project-context") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { mode, remainingArgs: postModeArgs } = parseMode(postAgentArgs);
        const { force, remainingArgs: postForceArgs } = parseForce(postModeArgs);

        if (postForceArgs.length > 0) {
          console.error(`Unknown option(s) for create project-context: ${postForceArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runCreateProjectContext({ provider, mode, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "prototype") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));

        const {
          value: iterations,
          remainingArgs: postIterationsArgs,
        } = parseOptionalIntegerFlag(postAgentArgs, "--iterations", 1);
        const {
          value: retryOnFail,
          remainingArgs: postRetryArgs,
        } = parseOptionalIntegerFlag(postIterationsArgs, "--retry-on-fail", 0);

        const { force, remainingArgs: postForceArgs } = parseForce(postRetryArgs);
        const stopOnCritical = postForceArgs.includes("--stop-on-critical");
        const unknownArgs = postForceArgs.filter((arg) => arg !== "--stop-on-critical");
        if (unknownArgs.length > 0) {
          console.error(`Unknown option(s) for create prototype: ${unknownArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runCreatePrototype({ provider, iterations, retryOnFail, stopOnCritical, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "test-plan") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const force = postAgentArgs.includes("--force");
        const unknownArgs = postAgentArgs.filter((arg) => arg !== "--force");

        if (unknownArgs.length > 0) {
          console.error(`Unknown option(s) for create test-plan: ${unknownArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runCreateTestPlan({ provider, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "issue") {
      const subArgs = args.slice(1);
      const { remainingArgs: subArgsWithoutForce } = parseForce(subArgs);

      // Check for --help before parsing
      if (subArgsWithoutForce.includes("--help") || subArgsWithoutForce.includes("-h")) {
        console.log(`Usage for create issue:
  nvst create issue --agent <provider>           Create issues interactively via agent
  nvst create issue --test-execution-report      Derive issues from test execution results

Providers: claude, codex, gemini, cursor`);
        printUsage();
        return;
      }

      try {
        // Check for --test-execution-report flag
        if (subArgsWithoutForce.includes("--test-execution-report")) {
          const remaining = subArgsWithoutForce.filter((a) => a !== "--test-execution-report");
          if (remaining.length > 0) {
            console.error(`Unknown option(s) for create issue --test-execution-report: ${remaining.join(" ")}`);
            printUsage();
            process.exitCode = 1;
            return;
          }
          await runCreateIssueFromTestReport();
          return;
        }

        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(subArgsWithoutForce);

        if (postAgentArgs.length > 0) {
          console.error(`Unknown option(s) for create issue: ${postAgentArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runCreateIssue({ provider });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    console.error(`Unknown create subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "define") {
    if (args.length === 0) {
      console.error(`Usage for define: nvst define <requirement|refactor-plan> --agent <provider>`);
      printUsage();
      process.exitCode = 1;
      return;
    }

    const subcommand = args[0];

    if (subcommand === "requirement") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        if (postForceArgs.length > 0) {
          console.error(`Unknown option(s) for define requirement: ${postForceArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runDefineRequirement({ provider, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "refactor-plan") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        if (postForceArgs.length > 0) {
          console.error(`Unknown option(s) for define refactor-plan: ${postForceArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runDefineRefactorPlan({ provider, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    console.error(`Unknown define subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "refine") {
    if (args.length === 0) {
      console.error(
        `Usage for refine: nvst refine <requirement|project-context|test-plan|refactor-plan> --agent <provider> [--challenge]`,
      );
      printUsage();
      process.exitCode = 1;
      return;
    }

    const subcommand = args[0];

    if (subcommand === "requirement") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        const challenge = postForceArgs.includes("--challenge");
        const unknownArgs = postForceArgs.filter((arg) => arg !== "--challenge");

        if (unknownArgs.length > 0) {
          console.error(`Unknown option(s) for refine requirement: ${unknownArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runRefineRequirement({ provider, challenge, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "project-context") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        const challenge = postForceArgs.includes("--challenge");
        const unknownArgs = postForceArgs.filter((arg) => arg !== "--challenge");

        if (unknownArgs.length > 0) {
          console.error(
            `Unknown option(s) for refine project-context: ${unknownArgs.join(" ")}`,
          );
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runRefineProjectContext({ provider, challenge, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "test-plan") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        const challenge = postForceArgs.includes("--challenge");
        const unknownArgs = postForceArgs.filter((arg) => arg !== "--challenge");

        if (unknownArgs.length > 0) {
          console.error(`Unknown option(s) for refine test-plan: ${unknownArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runRefineTestPlan({ provider, challenge, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "refactor-plan") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        const challenge = postForceArgs.includes("--challenge");
        const unknownArgs = postForceArgs.filter((arg) => arg !== "--challenge");

        if (unknownArgs.length > 0) {
          console.error(`Unknown option(s) for refine refactor-plan: ${unknownArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runRefineRefactorPlan({ provider, challenge, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    console.error(`Unknown refine subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "approve") {
    if (args.length === 0) {
      console.error(`Usage for approve: nvst approve <requirement|project-context|test-plan|prototype|refactor-plan>`);
      printUsage();
      process.exitCode = 1;
      return;
    }

    const subcommand = args[0];
    const { force, remainingArgs: unknownArgs } = parseForce(args.slice(1));
    if (unknownArgs.length > 0) {
      console.error(`Unknown option(s) for approve ${subcommand}: ${unknownArgs.join(" ")}`);
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (subcommand === "requirement") {
      await runApproveRequirement({ force });
      return;
    }

    if (subcommand === "project-context") {
      await runApproveProjectContext({ force });
      return;
    }

    if (subcommand === "test-plan") {
      await runApproveTestPlan({ force });
      return;
    }

    if (subcommand === "prototype") {
      await runApprovePrototype({ force });
      return;
    }

    if (subcommand === "refactor-plan") {
      await runApproveRefactorPlan({ force });
      return;
    }

    console.error(`Unknown approve subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "execute") {
    if (args.length === 0) {
      console.error(`Usage for execute: nvst execute <test-plan|automated-fix|manual-fix> --agent <provider>`);
      printUsage();
      process.exitCode = 1;
      return;
    }

    const subcommand = args[0];

    if (subcommand === "test-plan") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        if (postForceArgs.length > 0) {
          console.error(`Unknown option(s) for execute test-plan: ${postForceArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runExecuteTestPlan({ provider, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "automated-fix") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const {
          value: iterations,
          remainingArgs: postIterationsArgs,
        } = parseOptionalIntegerFlag(postAgentArgs, "--iterations", 1);
        const {
          value: retryOnFail,
          remainingArgs: unknownArgs,
        } = parseOptionalIntegerFlag(postIterationsArgs, "--retry-on-fail", 0);

        if (unknownArgs.length > 0) {
          console.error(`Unknown option(s) for execute automated-fix: ${unknownArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runExecuteAutomatedFix({ provider, iterations, retryOnFail });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "manual-fix") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        if (postForceArgs.length > 0) {
          console.error(`Unknown option(s) for execute manual-fix: ${postForceArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runExecuteManualFix({ provider });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    if (subcommand === "refactor") {
      try {
        const { provider, remainingArgs: postAgentArgs } = parseAgentArg(args.slice(1));
        const { force, remainingArgs: postForceArgs } = parseForce(postAgentArgs);
        if (postForceArgs.length > 0) {
          console.error(`Unknown option(s) for execute refactor: ${postForceArgs.join(" ")}`);
          printUsage();
          process.exitCode = 1;
          return;
        }

        await runExecuteRefactor({ provider, force });
        return;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        printUsage();
        process.exitCode = 1;
        return;
      }
    }

    console.error(`Unknown execute subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "write-json") {
    await runWriteJson({ args });
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof GuardrailAbortError) {
    // exitCode already set and "Aborted." already written by assertGuardrail
    return;
  }
  console.error("nvst failed:", error);
  process.exitCode = 1;
});

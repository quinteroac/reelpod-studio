"use strict";

/**
 * Zikon skill entry point — installable via:
 *   npx skills add https://github.com/quinteroac/zikon/zikon-skills
 *
 * Exports the skill definition so that Vercel Labs `@vercel/skill` tooling
 * can discover, install, and register the skill in an AI agent environment.
 *
 * After installation `/zikon` becomes a valid agent invocation that delegates
 * to `node cli/zikon.js` and returns the structured JSON emitted by the CLI,
 * including multi-size `svg_files` when requested.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SKILL_MD = path.resolve(__dirname, "SKILL.md");

/**
 * Programmatically invoke the Zikon pipeline.
 *
 * @param {object} params
 * @param {string}  params.prompt      - Text description of the logo/icon (required).
 * @param {string} [params.model]      - Diffusion model ID (default: "z-image-turbo").
 * @param {string} [params.style]      - Style hint appended to the prompt.
 * @param {string} [params.output_dir] - Directory for generated files.
 * @param {string} [params.size]       - Comma-separated SVG sizes (e.g. "512,24,18").
 * @returns {{
 *   prompt: string,
 *   model: string,
 *   seed: number|null,
 *   png_path: string,
 *   svg_path: string|null,
 *   svg_inline: string|null,
 *   svg_files: Array<{ size: number, svg_path: string, svg_inline: string }>
 * }}
 */
function run(params = {}) {
  const { prompt, model, style, output_dir, size } = params;

  if (!prompt) throw new Error("run(params): 'prompt' is required");

  const args = [prompt];
  if (model)      args.push("--model", model);
  if (style)      args.push("--style", style);
  if (output_dir) args.push("--output-dir", output_dir);
  if (size)       args.push("--size", size);

  // Resolve invocation: prefer the installed `zikon` shim created by `zikon install`,
  // fall back to the local repo CLI (one level up from zikon-skills/).
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const zikonInstalled = spawnSync(whichCmd, ["zikon"], { encoding: "utf8" });
  let result;

  if (zikonInstalled.status === 0 && zikonInstalled.stdout.trim()) {
    result = spawnSync("zikon", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } else {
    const localCli = path.resolve(__dirname, "..", "cli", "zikon.js");
    result = spawnSync("node", [localCli, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
  }

  if (result.status !== 0) {
    throw new Error(
      `zikon exited ${result.status}: ${result.stderr || result.error?.message}`
    );
  }

  return JSON.parse(result.stdout.trim());
}

const skill = {
  name: "zikon",
  description:
    "Generate an SVG logo from a text prompt using Zikon's pipeline " +
    "(prompt → PNG → SVG). Returns a JSON object with paths and inline SVG markup.",
  invocation: "/zikon",
  definition: fs.readFileSync(SKILL_MD, "utf8"),
  parameters: [
    {
      name: "prompt",
      type: "string",
      description: "Text description of the logo or icon to generate.",
      required: true,
    },
    {
      name: "model",
      type: "string",
      description:
        'Diffusion model to use. Accepts "z-image-turbo", "sdxl", a HuggingFace repo ID, or a local directory path.',
      required: false,
      default: "z-image-turbo",
    },
    {
      name: "style",
      type: "string",
      description:
        'Optional style hint (e.g. "flat", "outline", "gradient") appended to the prompt during generation.',
      required: false,
    },
    {
      name: "output_dir",
      type: "string",
      description:
        "Directory where the generated PNG and SVG files will be saved. Created automatically if it does not exist.",
      required: false,
    },
    {
      name: "size",
      type: "string",
      description:
        'Optional comma-separated SVG sizes (e.g. "512,24,18"). For multiple sizes, `svg_files` contains one entry per size.',
      required: false,
    },
  ],
  run,
};

module.exports = skill;

---
name: approve-prototype
description: "Drive interactive approval of the prototype by updating project context and roadmap artifacts after a completed iteration."
user-invocable: false
---

# Approve Prototype

You are an **interactive documentation-maintenance agent** that runs when a prototype iteration is ready to be approved.

Your goal is to keep the **project documentation in sync** with the latest iteration by reading the iteration artifacts and then proposing and applying updates to the core context files.

All generated content **must be in English**.

## Files and artifacts you must use

Iteration artifacts live under `.agents/flow/`.

For the current iteration (`{iteration}`) you **must** read at least:

- `.agents/flow/it_{iteration}_PRD.json` — the approved PRD for this iteration (JSON source of truth).
- `.agents/flow/it_{iteration}_refactor-report.md` — the refactor completion report produced in the refactor phase (if present).
- `.agents/flow/it_{iteration}_progress.json` — the prototype progress file (optional but useful for understanding what actually shipped).

You must also read the long‑lived documentation files at the project root:

- `.agents/PROJECT_CONTEXT.md`
- `ROADMAP.md` (if it exists)
- `AGENTS.md` (optional, if it exists)
- `README.md` (optional, if it exists)

## Required behaviour

### 1. Plan and present changes **before editing anything**

Before you modify any file, you **must**:

1. Build a concise plan describing:
   - Which of the following files you intend to modify: `.agents/PROJECT_CONTEXT.md`, `ROADMAP.md`, `AGENTS.md`, `README.md`.
   - For each file: a short summary of the current state (based on what you read).
   - For each file: a short summary of the proposed changes (what you will add, remove, or rewrite).
2. Present this plan to the user **as a clearly separated section**, for example under a heading like `## Planned updates`.
3. Wait for the user to review and confirm/adjust the plan using the interactive session.

Do **not** edit any file until you have shown this per‑file summary and given the user a chance to react.

### 2. Update `PROJECT_CONTEXT.md` and `ROADMAP.md`

After the plan has been presented and adjusted based on user feedback:

1. **Update `.agents/PROJECT_CONTEXT.md`** so that it accurately reflects:
   - The current architecture, conventions, and technical decisions implied by the latest iteration.
   - Any newly introduced capabilities, constraints, or quality‑check expectations coming from the iteration artifacts.
2. **Update `ROADMAP.md`** (creating it if needed) to:
   - Mark items that were completed in this iteration.
   - Add or revise upcoming work items derived from gaps, follow‑ups, or technical debt discovered in the PRD, audit, or refactor report.

Your updates must keep the documents coherent, well structured, and easy to read.

### 3. Optionally update `AGENTS.md` and `README.md` when stale

When reviewing `AGENTS.md` and `README.md`:

- If their descriptions of the workflow, commands, or capabilities are **clearly out of date** with respect to the current iteration, propose updates as part of your plan.
- Only modify these files when there is a concrete mismatch or missing information; avoid gratuitous rewrites.
- When you do update them, describe:
  - What behaviour or capability changed.
  - How the new behaviour should be communicated to future developers.

### 4. Apply edits and summarise the outcome

Once the user has agreed to your plan:

1. Apply the planned edits to the relevant files.
2. Ensure the result is consistent and that links, section names, and iteration references are correct.
3. At the end of the session, present a **short summary** of:
   - Which files were changed.
   - The most important updates made in each file.
   - Any follow‑up items that should be addressed in future iterations.

## Context

You will receive at least:

- `iteration`: the current iteration identifier (e.g. `000027`).

Use this to locate the iteration artifacts under `.agents/flow/`:

- `.agents/flow/it_{iteration}_PRD.json`
- `.agents/flow/it_{iteration}_refactor-report.md` (if present)
- `.agents/flow/it_{iteration}_progress.json`

Always follow the workflow phases and conventions described in the existing `.agents/PROJECT_CONTEXT.md`.

---
name: audit-prototype
description: "Validate the current iteration's PRD against the implemented code via the audit prototype skill."
user-invocable: false
---

# Audit Prototype

Validate the product requirement document (PRD) for the current iteration against the implemented code.

## Context

- Iteration artifacts live under `.agents/flow/`.
- Relevant files:
  - `.agents/flow/it_{iteration}_PRD.json` — PRD (user stories, acceptance criteria, functional requirements)
  - `.agents/flow/it_{iteration}_progress.json` — implementation progress

## UI / Frontend Audit

If any audited user story or functional requirement involves UI or frontend work, apply these Impeccable skills during the audit:

1. `audit` — evaluate accessibility, interface performance, theming consistency, and responsive behavior.
2. `critique` — perform UX design evaluation (flows, clarity, hierarchy, and usability).
3. `optimize` — identify interface performance optimizations for rendering, interactions, and runtime behavior.

Integrate resulting UI findings into the compliance report by either:
- adding them under **Minor observations**, or
- capturing them as explicit FR/US assessment notes within **Verification by FR** and/or **Verification by US**.

## Diagnostic Scan

For each use case / user story and its acceptance criteria (and any referenced functional requirements), validate that the codebase satisfies the PRD. Report any gaps or non-compliance.

## Output: Compliance report (mandatory structure)

Produce a **compliance report** with the following fixed structure so the user receives a consistent summary and per-FR / per-US verification. Write the report as JSON to:

`.agents/flow/it_{iteration}_compliance-report.json`

The report must include exactly these sections:

1. **Executive summary** — string.
2. **Verification by FR** — array of `{ "frId": "<id>", "assessment": "<value>" }` for each functional requirement. Assessment must be one of: `"comply"`, `"partially_comply"`, `"does_not_comply"` (or in Spanish: cumple / parcialmente cumple / no cumple — use English keys in JSON).
3. **Verification by US** — array of `{ "usId": "<id>", "assessment": "<value>" }` for each user story. Assessment must be one of: `"comply"`, `"partially_comply"`, `"does_not_comply"`.
4. **Minor observations** — array of strings (zero or more).
5. **Conclusions and recommendations** — string.

Each FR and US from the PRD must be explicitly assessed with one of: comply / partially comply / does not comply (English), or cumple / parcialmente cumple / no cumple if the surrounding document is in Spanish. In the JSON file use the English enum values: `"comply"`, `"partially_comply"`, `"does_not_comply"`.

## After the report: choose how to act on recommendations

After presenting the compliance report to the user, ask them to choose one of:

- **(a) Follow recommendations** — apply the recommendations as-is (e.g. proceed to refactor).
- **(b) Change recommendations** — adjust the recommendations before proceeding.
- **(c) Leave as is** — do not apply; optionally record items as technical debt.

If the user chooses **(b)**, ask what they want to change, then update the recommendations accordingly (e.g. revise the conclusions and recommendations text or the refactor plan) before continuing.

## Outcome-driven artifacts

Use the chosen outcome to drive which artifacts you produce:

1. **Always** — After the user's choice is known, produce the audit artifact so the result is persisted and reproducible. Write the file to **`.agents/flow/it_{iteration}_audit.md`** with the mandatory structure below.
2. **When the user chooses to follow or apply refactor** (option a or b with refactor intent) — Produce `.agents/flow/it_{iteration}_audit.json` (e.g. via `nvst write-json` if a schema exists, or a structured JSON consistent with the audit content).
3. **When the user marks items as technical debt** (option c or explicit "leave as debt") — Update `.agents/TECHNICAL_DEBT.md` (or the project's designated technical-debt file) with those items. Run the NVST command so the file is updated by the toolkit: `nvst write-technical-debt --data '<json>'` (or pipe JSON via stdin). The payload must be `{ "iteration": "<current_iteration>", "items": [ { "title": "<short title>", "description": "<optional description>" }, ... ] }`. Use `--out <path>` only if the project uses a different technical-debt file path. Updates are additive; existing debt entries are preserved.

### Mandatory structure for it_{iteration}_audit.md

The file must be written to `.agents/flow/it_{iteration}_audit.md` and must contain exactly these sections (in this order), reflecting the final recommendations (including any user-requested changes):

1. **Executive summary**
2. **Verification by FR**
3. **Verification by US**
4. **Minor observations**
5. **Conclusions and recommendations**
6. **Refactor plan**

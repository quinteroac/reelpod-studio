# Agents entry point

- **What this project is:** (Describe the product or project. This file is the single entry point for the agent.)
- **How to work here:** Use this file as the single entry point. Follow the process phases in order; read and update `.agents/state.json` for the current iteration and phase. Invoke the skills under `.agents/skills/` as indicated by each command. All iteration artifacts live in `.agents/flow/` with the naming `it_` + 6-digit iteration (e.g. `it_000001_product-requirement-document.md`). From the second iteration onward, adhere to `.agents/PROJECT_CONTEXT.md`.
- **Process:** Define → Prototype → Refactor (see package or usage documentation).
- **Project context:** `.agents/PROJECT_CONTEXT.md` (conventions and architecture; agent adheres from second iteration onward).
- **Rule:** All generated resources in this repo must be in English.

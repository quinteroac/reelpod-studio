---
name: create-project-context
description: "Creates or updates .agents/PROJECT_CONTEXT.md with project conventions, tech stack, code standards, testing strategy, and product architecture. Triggered by: bun nvst create project-context."
user-invocable: true
---

# Create / Update Project Context

Create or update `.agents/PROJECT_CONTEXT.md` so the agent has a single, stable reference for conventions and architecture across all iterations.

---

## The Job

1. Check whether `.agents/PROJECT_CONTEXT.md` already exists.
   - **First iteration (file absent or empty):** run the Questions flow below.
   - **Subsequent iterations (file present):** ask the user what to add or change; skip questions for sections already covered. In `--mode yolo` skip all questions and infer from the codebase and the current iteration's PRD.
2. Produce or update the document following the Output Structure.
3. Enforce the **250-line cap** (see Cap Rule).
4. Write the result to `.agents/PROJECT_CONTEXT.md`.

---

## Inputs

| Source | Used for |
|--------|----------|
| `it_{iteration}_product-requirement-document.md` | Understanding product goals and implied stack/conventions |
| `it_{iteration}_PRD.json` | Use cases and scope of the current iteration |
| `.agents/PROJECT_CONTEXT.md` (if present) | Existing content to preserve or update |
| User answers (interactive mode) | Filling in sections that cannot be inferred |

---

## Questions Flow (first iteration or missing sections)

Ask only about sections that cannot be confidently inferred from the PRD and codebase. Present lettered options where applicable so the user can reply with short codes (e.g. "1A, 2B").

```
1. Primary language(s) and runtime?
   A. TypeScript / Node.js
   B. Python
   C. Go
   D. Rust
   E. TypeScript (frontend) + Python (backend)
   F. TypeScript (frontend) + Go (backend)
   G. TypeScript (frontend) + Rust (backend)
   H. Other: [specify]

2. Main framework(s)?
   A. Next.js
   B. React + Vite
   C. FastAPI / Flask
   D. Gin / Echo / Fiber (Go)
   E. Actix-web / Axum (Rust)
   F. Other: [specify]

3. Package manager?
   A. bun
   B. npm
   C. pnpm
   D. yarn

4. Test approach?
   A. TDD — tests first, then code
   B. Code first, tests after
   C. Tests only for critical paths

5. Test runner?
   A. Vitest
   B. Jest
   C. Pytest
   D. Go built-in (`go test`)
   E. Rust built-in (`cargo test`)
   F. Other: [specify]

6. Git flow?
   A. Feature branches per iteration (feature/it_XXXXXX)
   B. Trunk-based (commits directly to main)
   C. Other: [specify]

7. Style / formatting conventions?
   A. Prettier + ESLint defaults
   B. Project-specific config (already committed)
   C. `gofmt` / `goimports` (Go — enforced by default)
   D. `rustfmt` (Rust — enforced by default)
   E. No enforced formatting

8. Any hard constraints (monorepo, deployment target, env restrictions)?
   [Open answer — skip if none]
```

---

## Output Structure

Write `.agents/PROJECT_CONTEXT.md` using only the sections relevant to the project. Include all sections that have content; omit those that are genuinely not applicable.

```markdown
# Project Context

<!-- Created or updated by `bun nvst create project-context`. Cap: 250 lines. -->

## Conventions
- Naming: [files, variables, components]
- Formatting: [tool + config]
- Git flow: [branching strategy, commit convention]
- Workflow: [any process agreement]

## Tech Stack
- Language(s): …
- Runtime: …
- Frameworks: …
- Key libraries: …
- Package manager: …
- Build / tooling: …

## Code Standards
- Style patterns: …
- Error handling: …
- Module organisation: …
- Forbidden patterns (if any): …

## Testing Strategy
- Approach: [TDD | code-first | critical-paths only]
- Runner: …
- Coverage targets (if any): …
- Test location convention: …

## Product Architecture
- High-level diagram or description: …
- Main components / layers: …
- Data flow summary: …

## Modular Structure
- [package or module]: [responsibility]
- …

## Implemented Capabilities
<!-- Updated at the end of each iteration by bun nvst create project-context -->
- (none yet — populated after first Refactor)
```

---

## Cap Rule (250 lines)

Before writing the file, count projected line count.

- If ≤ 250 lines → write as-is.
- If > 250 lines → apply the summary mechanism **before** appending new content:
  1. Condense the **Implemented Capabilities** section: group earlier iterations into a "Summary of previous iterations" block; keep full detail only for the last 1–2 iterations.
  2. Shorten any section that has grown beyond 10 lines by merging or removing redundant entries.
  3. If still over 250, move low-priority detail (e.g. full feature lists from old iterations) to `.agents/PROJECT_CONTEXT_archive.md` and replace with a one-line reference.
- Re-count after summarisation; write only when ≤ 250 lines.

---

## Checklist

Before saving the file:

- [ ] All sections answered or explicitly marked N/A
- [ ] Conventions are specific (not "follow best practices")
- [ ] Tech stack lists exact versions where relevant
- [ ] Testing strategy matches what the PRD implies
- [ ] File does not exceed 250 lines
- [ ] `state.json` → `project_context.status` set to `"pending_approval"` and `project_context.file` set to `".agents/PROJECT_CONTEXT.md"` after writing

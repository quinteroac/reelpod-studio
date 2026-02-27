---
name: create-pr-document
description: "Gathers the requirement from the user and produces it_{iteration}_product-requirement-document.md. Triggered by: bun nvst define requirement."
user-invocable: true
---

# Create Product Requirement Document

Produce `it_{current_iteration}_product-requirement-document.md` in `.agents/flow/` by interviewing the user about the feature or change they want to build.

**Important:** Do NOT start implementing. Just gather the requirement and write the document.

---

## The Job

1. **Understand the project first.** Read `AGENTS.md`, `.agents/PROJECT_CONTEXT.md`, and explore the codebase structure (main entry points, conventions, existing features) before starting the interview. This context will make your questions more relevant and the PRD better aligned with the project.
2. Read `state.json` to get `current_iteration` (6-digit string, e.g. `"000001"`).
3. Ask 3–5 clarifying questions (see Questions Flow).
4. Generate the document following the Output Structure.
5. Write to `.agents/flow/it_{current_iteration}_product-requirement-document.md`.
6. Update `state.json`: `requirement_definition.status` = `"in_progress"`, `requirement_definition.file` = filename.

---

## Questions Flow

**CRITICAL: Ask ONE question at a time. Wait for the user's answer before asking the next question. Do NOT present all questions at once.**

Ask only questions where the initial prompt is ambiguous. Present lettered options so the user can reply with short codes (e.g. "1A").

Questions to ask (one by one, in order):

1. What problem does this solve or goal does it achieve?
   - A. [inferred option]
   - B. [inferred option]
   - C. Other: [please specify]

*(Wait for answer, then ask question 2)*

2. Who is the primary user or actor?
   - A. End user / customer
   - B. Internal operator / admin
   - C. Another system or automated process
   - D. Other: [specify]

*(Wait for answer, then ask question 3)*

3. MVP scope — what is the minimum set of use cases needed to validate the idea?
   List only the user stories you consider strictly necessary.
   *(e.g. "UC-1: user can log in, UC-2: user can view dashboard")*

*(Wait for answer, then ask question 4)*

4. Are there hard constraints (deadline, platform, dependencies)?
   *(Skip if the user says none)*

*(Wait for answer, then ask question 5)*

5. What does "done" look like? How will we know it works?
   *(Describe acceptance criteria or how you'd verify success)*

*(Wait for answer, then generate the document)*

---

## Output Structure

```markdown
# Requirement: [Feature or Change Name]

## Context
Brief description of the problem or opportunity this addresses.

## Goals
- [Specific, measurable objective]
- …

## User Stories
Each story must be small enough to implement in one focused session.

### US-001: [Title]
**As a** [actor], **I want** [capability] **so that** [benefit].

**Acceptance Criteria:**
- [ ] [Specific, verifiable criterion — not vague]
- [ ] [Another criterion]
- [ ] Typecheck / lint passes
- [ ] **[UI stories only]** Visually verified in browser

### US-002: …

## Functional Requirements
- FR-1: …
- FR-2: …

## Non-Goals (Out of Scope)
- …

## Open Questions
- …
```

---

## Writing Guidelines

- **MVP first:** include only the user stories from the answer to question 3. If the user did not list explicit stories, propose the smallest set possible and confirm before writing. Do not pad scope.
- Be explicit and unambiguous — the reader may be a junior developer or an AI agent.
- Acceptance criteria must be verifiable: "button shows confirmation dialog before deleting" ✓ — "works correctly" ✗.
- Every story with a UI change must include browser verification as an acceptance criterion.
- Number requirements (`FR-N`) for easy cross-reference with `it_{iteration}_PRD.json`.

---

## Checklist

Before saving:

- [ ] Clarifying questions asked and answered
- [ ] Each user story has verifiable acceptance criteria
- [ ] Functional requirements are numbered and unambiguous
- [ ] Non-goals define clear scope boundaries
- [ ] File written to `.agents/flow/it_{current_iteration}_product-requirement-document.md`
- [ ] `state.json` → `requirement_definition.status` = `"in_progress"`, `requirement_definition.file` set
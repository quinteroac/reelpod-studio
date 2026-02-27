---
name: refine-project-context
description: "Refines .agents/PROJECT_CONTEXT.md via editor mode or challenge mode. Challenge mode validates the document against the actual codebase and detects compliance issues. Triggered by: bun nvst refine project-context."
user-invocable: true
---

# Refine Project Context

Update `.agents/PROJECT_CONTEXT.md` in place based on user feedback or codebase validation. The file must already exist; this skill does not create it from scratch.

**Do NOT start implementing. Only update the document (and optionally `.agents/TECHNICAL_DEBT.md` in challenge mode).**

> **Two modes available — determined by the `mode` context variable:**
> - **Editor mode** (default) — apply specific changes requested by the user.
> - **Challenger mode** (`mode = "challenger"`) — validate PROJECT_CONTEXT.md against the actual codebase, detect discrepancies, and present findings individually for user triage.

---

## Inputs

| Source | Used for |
|--------|----------|
| `.agents/PROJECT_CONTEXT.md` | The current document to refine |
| Actual codebase files | Challenge mode: comparing documented conventions vs reality |
| User answers (interactive mode) | Directing changes (editor) or triaging findings (challenger) |

---

## Editor Mode

Ask only what is needed to understand the requested change.

```
1. What would you like to change or add to the project context?
   A. Update conventions (naming, formatting, git flow)
   B. Update tech stack details
   C. Update code standards
   D. Update testing strategy
   E. Update product architecture
   F. Update modular structure
   G. Update implemented capabilities
   H. Other: [describe]

2. Anything else to update in this pass?
   [Open answer — skip if none]
```

Apply changes to the document following the same Output Structure as `create-project-context`.

**After editing:**
- Write the updated file back to `.agents/PROJECT_CONTEXT.md`.
- Enforce the **250-line cap** (see Cap Rule in `create-project-context` skill).

---

## Challenger Mode

Act as a codebase auditor. Systematically compare the content of `PROJECT_CONTEXT.md` against the actual codebase to detect discrepancies. Do not apply any change without explicit user approval.

### Step 1: Analyse

Read the codebase (file structure, imports, patterns, config files, test files) and compare against each section of PROJECT_CONTEXT.md:

1. **Conventions** — Are the naming, formatting, and git flow conventions actually followed?
2. **Tech Stack** — Do the documented languages, runtimes, frameworks, and libraries match `package.json`, `tsconfig.json`, lock files, and actual imports?
3. **Code Standards** — Are the style patterns, error handling, and module organisation conventions reflected in the code?
4. **Testing Strategy** — Does the test approach, runner, and location convention match reality?
5. **Product Architecture** — Does the documented architecture match the actual file/module structure?
6. **Modular Structure** — Are the documented modules/packages accurate and complete?
7. **Implemented Capabilities** — Are all documented capabilities actually implemented, and are there implemented capabilities not documented?

### Step 2: Present Findings

> CRITICAL: Present findings **one at a time**. After delivering one finding, stop and wait for the user to respond before moving on. Do not queue or batch findings.

For each discrepancy, classify it as one of two types and present:

```
Finding [N/total]: <section name>

Type: PROJECT CONTEXT NOT COMPLIANT | CODE NOT COMPLIANT
Description: <what the discrepancy is>
Evidence: <specific file(s) or code snippet(s) that demonstrate the discrepancy>

Suggested action:
- If PROJECT CONTEXT NOT COMPLIANT: <proposed fix to PROJECT_CONTEXT.md>
- If CODE NOT COMPLIANT: <summary to record as technical debt>

Accept / Reject / Discuss?
```

- After the user responds, acknowledge their decision and immediately present the **next** finding.
- If the user types **Discuss**, engage in a short back-and-forth until they give a final Accept or Reject, then move on.

### Step 3: Apply Changes

After all findings have been reviewed:

**For accepted "PROJECT CONTEXT NOT COMPLIANT" findings:**
- Apply the suggested fixes to `.agents/PROJECT_CONTEXT.md`.
- Enforce the 250-line cap after all edits.

**For accepted "CODE NOT COMPLIANT" findings:**
- Append each finding to `.agents/TECHNICAL_DEBT.md` in the format below.
- Create `.agents/TECHNICAL_DEBT.md` if it does not already exist.
- Appending to TECHNICAL_DEBT.md alone does NOT modify the project context status.

**TECHNICAL_DEBT.md entry format:**

```markdown
### TD-<NNN>: <short title>

- **Source:** Challenge mode — iteration <current_iteration>
- **Date:** <ISO 8601>
- **Section:** <PROJECT_CONTEXT.md section>
- **Description:** <what the code does that doesn't match the documented convention>
- **Evidence:** <file path(s) and brief description>
- **Suggested resolution:** <what should change in the code>
```

### Step 4: Summarise

After all findings are processed, output a summary:

```
Challenge Summary:
- Total findings: N
- Accepted (project context updated): X
- Accepted (technical debt recorded): Y
- Rejected: Z

Files modified:
- .agents/PROJECT_CONTEXT.md: [yes/no]
- .agents/TECHNICAL_DEBT.md: [yes/no — created/updated/unchanged]
```

---

## Refinement Rules

- **250-line cap** on PROJECT_CONTEXT.md must be enforced after every edit (see Cap Rule in `create-project-context` skill).
- **Preserve structure:** maintain the same section headings as defined in `create-project-context` skill Output Structure.
- **No phantom sections:** do not add sections that have no content.
- **TECHNICAL_DEBT.md numbering:** if the file already exists, continue numbering from the last `TD-NNN` entry; if new, start at `TD-001`.

---

## Checklist

Before saving:

- [ ] All user-accepted changes applied to `.agents/PROJECT_CONTEXT.md`
- [ ] PROJECT_CONTEXT.md does not exceed 250 lines
- [ ] All accepted "code not compliant" findings recorded in `.agents/TECHNICAL_DEBT.md`
- [ ] TECHNICAL_DEBT.md created if it did not exist and there are code compliance findings
- [ ] Summary of changes presented to the user
- [ ] `state.json` will be updated by the CLI command (not by this skill)

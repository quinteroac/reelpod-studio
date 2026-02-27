---
name: create-issue
description: "Interactively defines one or more issues with the user. Triggered by: bun nvst create issue --agent <provider>."
user-invocable: true
---

# Create Issue

Define one or more issues interactively with the user and write them to the output file using `write-json`.

**Important:** Do NOT fix the issues. Just gather information and produce the output file.

---

## The Job

1. Ask the user what issue(s) they want to create. Gather a `title` and `description` for each issue.
2. Ask clarifying questions one at a time until you have enough detail.
3. Run the `write-json` command to write the issues file (see Output section).

---

## Questions Flow

**CRITICAL: Ask ONE question at a time. Wait for the user's answer before asking the next question.**

1. Describe the issue — what is the problem or task?
2. Is there additional context (error messages, affected files, reproduction steps)?
3. Are there more issues to add? If yes, repeat questions 1–2.

---

## Output

When you have collected all issues, write the file by running:

```bash
bun run src/cli.ts write-json --schema issues --out .agents/flow/it_{iteration}_ISSUES.json --data '<json>'
```

Replace `{iteration}` with the value from Context (e.g. `000009`). The JSON must be a valid array where each element has:

- `id`: `ISSUE-{iteration}-001`, `ISSUE-{iteration}-002`, etc. (sequential, zero-padded)
- `title`: concise summary (one sentence)
- `description`: detailed explanation including context, reproduction steps, or expected behaviour
- `status`: always `"open"`

Example:

```json
[
  {"id": "ISSUE-000009-001", "title": "Short issue title", "description": "Detailed description.", "status": "open"},
  {"id": "ISSUE-000009-002", "title": "Another issue", "description": "More details.", "status": "open"}
]
```

**You must run the write-json command.** Do not output JSON to stdout alone. The calling system expects the file to exist.

---

## Checklist

Before running write-json:

- [ ] Each issue has a clear, specific `title`
- [ ] Each issue has a detailed `description`
- [ ] Each issue has correct `id` (ISSUE-{iteration}-NNN) and `status` ("open")
- [ ] Write the file via `bun run src/cli.ts write-json ...`

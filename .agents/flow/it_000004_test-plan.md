# Test Plan - Iteration 000004

## Scope

- Validate that `backend/llm-skills/strudel-pattern-generator/SKILL.md` is created with correct structure, YAML frontmatter, and required content sections.
- Validate that the YAML frontmatter is syntactically valid and contains all mandatory fields (`name`, `description`, `disable-model-invocation: true`).
- Validate that the SKILL.md body documents Strudel mini-notation syntax, parameter mappings for all `Mood` and `Style` values, the LLM output contract, and at least 3 complete example patterns (one per style).
- Validate that `backend/llm-skills/strudel-pattern-generator/examples/valid-patterns.md` is created with at least 3 pattern strings conforming to the `stack([...]).slow(N).gain(N).cpm(N)` structure.
- Manually verify that each example pattern in `valid-patterns.md` plays in the Strudel browser REPL without console errors.

## Environment and data

- Runtime: Node.js / Bun — tests run via Vitest in the repository root.
- File system: repository must be checked out; tests access files via `fs.readFileSync` relative to the project root.
- YAML parsing: use `js-yaml` (or equivalent available in the project) for frontmatter validation.
- Source of truth for `Mood` and `Style` enum values: `src/lib/pattern-generator.ts` — the expected values are `chill`, `melancholic`, `upbeat` (Mood) and `jazz`, `hip-hop`, `ambient` (Style).
- Browser environment (for manual tests): Chromium/Firefox with Strudel REPL accessible; developer console open to observe errors.

---

## User Story: US-001 - Create the Strudel pattern generator skill file

| Test Case ID | Description | Type | Mode | Correlated Requirements | Expected Result |
|---|---|---|---|---|---|
| TC-001-001 | Verify that `backend/llm-skills/strudel-pattern-generator/SKILL.md` exists on the file system | integration | automated | US-001, FR-1 | File is present at the expected path; `fs.existsSync` returns `true` |
| TC-001-002 | Verify that `SKILL.md` begins with a YAML frontmatter block delimited by `---` markers and that the YAML is parseable without errors | unit | automated | US-001, FR-2 | YAML parser processes the frontmatter block without throwing; result is a non-null object |
| TC-001-003 | Verify that the parsed YAML frontmatter contains `name: strudel-pattern-generator` | unit | automated | US-001, FR-2 | `frontmatter.name === 'strudel-pattern-generator'` |
| TC-001-004 | Verify that the parsed YAML frontmatter contains a non-empty `description` field | unit | automated | US-001, FR-2 | `typeof frontmatter.description === 'string'` and `frontmatter.description.trim().length > 0` |
| TC-001-005 | Verify that the parsed YAML frontmatter contains `disable-model-invocation: true` | unit | automated | US-001, FR-2 | `frontmatter['disable-model-invocation'] === true` |
| TC-001-006 | Verify that the SKILL.md body documents core Strudel mini-notation symbols: sound names (`bd`, `sd`, `hh`, `cp`), rest (`~`), repeat (`*N`), and grouping (`[]`) | unit | automated | US-001, FR-3 | Markdown body string contains all expected tokens/symbols |
| TC-001-007 | Verify that the SKILL.md body documents the chaining methods `.stack()`, `.slow()`, `.gain()`, and `.cpm()` | unit | automated | US-001, FR-3 | Markdown body string contains each method name |
| TC-001-008 | Verify that the SKILL.md body contains a parameter mapping section that references all three `Mood` values: `chill`, `melancholic`, `upbeat` | unit | automated | US-001, FR-4 | Each mood string appears in the markdown body |
| TC-001-009 | Verify that the SKILL.md body contains a parameter mapping section that references all three `Style` values: `jazz`, `hip-hop`, `ambient` | unit | automated | US-001, FR-4 | Each style string appears in the markdown body |
| TC-001-010 | Verify that the SKILL.md body includes an output contract section specifying that the LLM must return a single-line Strudel pattern string with no prose and no markdown code fences | unit | automated | US-001, FR-5 | Body contains keywords/phrases describing the single-line output constraint (e.g., "single-line", "no prose", "no code block", or equivalent) |
| TC-001-011 | Verify that the SKILL.md body contains at least 3 complete example patterns — one for each style (`jazz`, `hip-hop`, `ambient`) | unit | automated | US-001, FR-6 | Body includes at least 3 distinct `stack([` expressions, each referencing a different style |

---

## User Story: US-002 - Validate skill output against the Strudel REPL

| Test Case ID | Description | Type | Mode | Correlated Requirements | Expected Result |
|---|---|---|---|---|---|
| TC-002-001 | Verify that `backend/llm-skills/strudel-pattern-generator/examples/valid-patterns.md` exists on the file system | integration | automated | US-002, FR-7 | File is present at the expected path; `fs.existsSync` returns `true` |
| TC-002-002 | Verify that `valid-patterns.md` contains at least 3 pattern strings | unit | automated | US-002, FR-7 | Parsing the file yields at least 3 non-empty pattern entries |
| TC-002-003 | Verify that each pattern in `valid-patterns.md` matches the expected structure: `stack([...]).slow(N).gain(N).cpm(N)` using a regex | unit | automated | US-002, FR-6, FR-7 | All extracted pattern strings match `/^stack\(\[[\s\S]+?\]\)\.slow\(\d+(\.\d+)?\)\.gain\(\d+(\.\d+)?\)\.cpm\(\d+\)$/` or equivalent |
| TC-002-004 | Manually paste the `jazz`-style example pattern from `valid-patterns.md` into the Strudel browser REPL and start playback | e2e | manual | US-002 | Audio plays without errors; browser console shows no uncaught exceptions or REPL error messages. **Manual justification:** browser Web Audio API playback and REPL execution state cannot be asserted through DOM/state checks in a headless test environment. |
| TC-002-005 | Manually paste the `hip-hop`-style example pattern from `valid-patterns.md` into the Strudel browser REPL and start playback | e2e | manual | US-002 | Audio plays without errors; browser console shows no uncaught exceptions or REPL error messages. **Manual justification:** same as TC-002-004. |
| TC-002-006 | Manually paste the `ambient`-style example pattern from `valid-patterns.md` into the Strudel browser REPL and start playback | e2e | manual | US-002 | Audio plays without errors; browser console shows no uncaught exceptions or REPL error messages. **Manual justification:** same as TC-002-004. |

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXAMPLES_PATH = resolve(__dirname, 'valid-patterns.md');

// Matches: stack([...]).slow(N).gain(N).cpm(N)
const PATTERN_FORMAT =
  /stack\(\[[\s\S]*?\]\)\.slow\(\d+(?:\.\d+)?\)\.gain\(\d+(?:\.\d+)?\)\.cpm\(\d+\)/;

function extractCodeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\r\n]+([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const trimmed = match[1].trim();
    if (trimmed.length > 0) {
      blocks.push(trimmed);
    }
  }
  return blocks;
}

describe('backend/llm-skills/strudel-pattern-generator/examples/valid-patterns.md', () => {
  let content: string;
  let codeBlocks: string[];

  beforeAll(() => {
    content = readFileSync(EXAMPLES_PATH, 'utf-8');
    codeBlocks = extractCodeBlocks(content);
  });

  // AC01: file exists and contains at least 3 patterns, one per style
  it('file exists and is non-empty', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('contains at least 3 code-block patterns', () => {
    expect(codeBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it('documents a jazz style example', () => {
    expect(content.toLowerCase()).toContain('jazz');
  });

  it('documents a hip-hop style example', () => {
    expect(content.toLowerCase()).toContain('hip-hop');
  });

  it('documents an ambient style example', () => {
    expect(content.toLowerCase()).toContain('ambient');
  });

  // AC02: each pattern matches stack([...]).slow(N).gain(N).cpm(N)
  it('every code-block pattern is a valid stack([...]).slow(N).gain(N).cpm(N) expression', () => {
    expect(codeBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of codeBlocks) {
      expect(block).toMatch(PATTERN_FORMAT);
    }
  });

  it('each pattern uses .slow() before .gain() before .cpm()', () => {
    for (const block of codeBlocks) {
      const slowIdx = block.indexOf('.slow(');
      const gainIdx = block.indexOf('.gain(');
      const cpmIdx = block.indexOf('.cpm(');
      expect(slowIdx).toBeGreaterThan(-1);
      expect(gainIdx).toBeGreaterThan(slowIdx);
      expect(cpmIdx).toBeGreaterThan(gainIdx);
    }
  });

  it('each pattern wraps sounds in stack([ ... ])', () => {
    for (const block of codeBlocks) {
      expect(block).toMatch(/^stack\(\[/);
    }
  });

  // AC03: each example is marked as visually verified
  it('documents that each example has been visually verified in the browser REPL', () => {
    const lower = content.toLowerCase();
    expect(lower).toMatch(/verified|verification/);
  });
});

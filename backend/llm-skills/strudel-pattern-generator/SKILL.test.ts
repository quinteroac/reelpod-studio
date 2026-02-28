import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_PATH = resolve(__dirname, 'SKILL.md');

type Frontmatter = Record<string, string | boolean>;

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('No valid YAML frontmatter found in SKILL.md');
  }
  const yamlText = match[1];
  const body = match[2];

  const frontmatter: Frontmatter = {};
  for (const line of yamlText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (rawValue === 'true') {
      frontmatter[key] = true;
    } else if (rawValue === 'false') {
      frontmatter[key] = false;
    } else {
      frontmatter[key] = rawValue;
    }
  }

  return { frontmatter, body };
}

describe('backend/llm-skills/strudel-pattern-generator/SKILL.md', () => {
  let content: string;
  let frontmatter: Frontmatter;
  let body: string;

  beforeAll(() => {
    content = readFileSync(SKILL_PATH, 'utf-8');
    const parsed = parseFrontmatter(content);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  });

  // AC01: file exists
  it('file exists and is non-empty', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  // AC02: YAML frontmatter between --- markers
  it('has YAML frontmatter delimited by --- markers', () => {
    expect(content).toMatch(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  });

  // AC03: required frontmatter fields
  it('frontmatter has name: strudel-pattern-generator', () => {
    expect(frontmatter['name']).toBe('strudel-pattern-generator');
  });

  it('frontmatter has a non-empty description field', () => {
    const desc = frontmatter['description'];
    expect(typeof desc).toBe('string');
    expect((desc as string).trim().length).toBeGreaterThan(0);
  });

  // AC04: disable-model-invocation
  it('frontmatter has disable-model-invocation: true', () => {
    expect(frontmatter['disable-model-invocation']).toBe(true);
  });

  // AC05: mini-notation sound names
  it('body documents sound names bd, sd, hh, cp', () => {
    expect(body).toContain('bd');
    expect(body).toContain('sd');
    expect(body).toContain('hh');
    expect(body).toContain('cp');
  });

  it('body documents rhythm notation ~ (rest), *N (repeat), [] (subdivide)', () => {
    expect(body).toContain('~');
    expect(body).toMatch(/\*\d+/); // e.g. hh*4 or hh*2
    expect(body).toContain('[');   // bracket notation like [bd sd]
  });

  it('body documents chaining methods .stack(), .slow(), .gain(), .cpm()', () => {
    expect(body).toContain('.stack(');
    expect(body).toContain('.slow(');
    expect(body).toContain('.gain(');
    expect(body).toContain('.cpm(');
  });

  // AC06: parameter mappings
  it('body defines parameter mappings for mood, tempo, and style', () => {
    const lower = body.toLowerCase();
    expect(lower).toContain('mood');
    expect(lower).toContain('tempo');
    expect(lower).toContain('style');
  });

  // AC07: example patterns for each style
  it('body includes an example pattern for jazz', () => {
    expect(body.toLowerCase()).toContain('jazz');
  });

  it('body includes an example pattern for hip-hop', () => {
    expect(body.toLowerCase()).toContain('hip-hop');
  });

  it('body includes an example pattern for ambient', () => {
    expect(body.toLowerCase()).toContain('ambient');
  });

  it('example patterns use .cpm() for tempo', () => {
    const patternBlock = body.match(/### Jazz[\s\S]*?```([\s\S]*?)```/);
    expect(patternBlock).not.toBeNull();
    expect(body).toMatch(/\.cpm\(\d+\)/);
  });

  // AC08: output format specification
  it('body specifies single-line output with no explanation, no code block', () => {
    const lower = body.toLowerCase();
    expect(lower).toMatch(/single.line|one line/);
    expect(lower).toMatch(/no explanation|no.*code fence|do not explain|no triple backtick/);
  });

  // AC09: YAML frontmatter is parseable (no parse error thrown in beforeAll)
  it('YAML frontmatter is parseable with expected fields', () => {
    expect(Object.keys(frontmatter).length).toBeGreaterThanOrEqual(3);
    expect(frontmatter).toHaveProperty('name');
    expect(frontmatter).toHaveProperty('description');
    expect(frontmatter).toHaveProperty('disable-model-invocation');
  });

  // US-001 AC01: note() function for pitch sequences
  it('body documents the note() function for pitch sequences', () => {
    expect(body).toContain('note(');
  });

  it('body includes a pitch sequence example like note("c3 eb3 g3 bb3")', () => {
    expect(body).toMatch(/note\(["'][\w\s#b]+["']\)/);
  });

  // US-001 AC02: at least two melodic/harmonic sound names
  it('body documents at least two melodic sound names (piano, rhodes)', () => {
    expect(body).toContain('piano');
    expect(body).toContain('rhodes');
  });

  // US-001 AC03: how to combine a note pattern with a sound
  it('body documents .sound() to combine a note pattern with a sound', () => {
    expect(body).toContain('.sound(');
    expect(body).toMatch(/note\(.*\)\.sound\(/);
  });

  // US-001 AC04: how to stack melodic voices with the existing drum stack
  it('body documents stacking melodic voices with drum patterns', () => {
    expect(body).toMatch(/stack\(\[.*note\(.*\)\.sound\(/s);
  });

  // US-001 AC05: mood and style to recommended melodic characteristics
  it('body maps mood values to melodic characteristics (scale)', () => {
    const lower = body.toLowerCase();
    expect(lower).toContain('scale');
    expect(lower).toContain('pentatonic');
  });

  it('body maps style values to melodic characteristics', () => {
    const lower = body.toLowerCase();
    expect(lower).toContain('dorian');
    expect(lower).toContain('lydian');
  });
});

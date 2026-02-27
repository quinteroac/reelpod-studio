/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import envExample from '../../.env.example?raw';
import gitignoreFile from '../../.gitignore?raw';

describe('environment configuration', () => {
  it('documents OPENAI_API_KEY in .env.example', () => {
    expect(envExample).toContain('OPENAI_API_KEY=');
  });

  it('ignores .env in .gitignore', () => {
    const entries = gitignoreFile
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('#'));

    expect(entries).toContain('.env');
  });
});

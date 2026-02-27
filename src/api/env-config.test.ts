/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import envExample from '../../.env.example?raw';
import gitignoreFile from '../../.gitignore?raw';
import packageJson from '../../package.json';
import viteConfigSource from '../../vite.config.ts?raw';

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

  it('package.json documents backend platform dependency (vite)', () => {
    // The backend is implemented as a TypeScript Vite middleware (not Python).
    // The dependency manifest is package.json; vite is required to run the
    // /api/generate middleware alongside the frontend dev server.
    expect(packageJson.devDependencies).toHaveProperty('vite');
  });

  it('vite.config.ts uses loadEnv to read OPENAI_API_KEY for the middleware', () => {
    // Vite does not inject .env variables into process.env for server-side
    // middleware code. The config must explicitly use loadEnv to read the key
    // and pass it to createGenerateHandler so it is available at request time.
    expect(viteConfigSource).toContain('loadEnv');
    expect(viteConfigSource).toContain('OPENAI_API_KEY');
    expect(viteConfigSource).toContain('getOpenAiApiKey');
  });
});

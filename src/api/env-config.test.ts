/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import envExample from '../../.env.example?raw';
import gitignoreFile from '../../.gitignore?raw';
import backendRequirements from '../../backend/requirements.txt?raw';
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

  it('backend/requirements.txt declares python backend dependencies', () => {
    const lines = backendRequirements
      .split('\n')
      .map((line: string) => line.trim().toLowerCase())
      .filter((line: string) => line.length > 0 && !line.startsWith('#'));

    expect(lines.some((line: string) => line.startsWith('fastapi'))).toBe(true);
    expect(lines.some((line: string) => line.startsWith('uvicorn'))).toBe(true);
    expect(lines.some((line: string) => line.startsWith('ace-step'))).toBe(true);
    expect(lines.some((line: string) => line.startsWith('python-dotenv'))).toBe(true);
  });

  it('vite.config.ts proxies /api calls to the python backend', () => {
    expect(viteConfigSource).toContain('proxy');
    expect(viteConfigSource).toContain('/api');
    expect(viteConfigSource).toContain('127.0.0.1:8000');
    expect(viteConfigSource).not.toContain('createGenerateHandler');
  });
});

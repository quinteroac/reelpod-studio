import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import packageJson from '../package.json';
import mainSource from './main.tsx?raw';
import tailwindConfigSource from '../tailwind.config.ts?raw';

describe('Tailwind setup', () => {
  it('includes Tailwind in dependencies and configures required files', () => {
    expect(packageJson.devDependencies?.tailwindcss).toBeTruthy();
    expect(tailwindConfigSource).toContain('content:');
    expect(tailwindConfigSource).toContain('lofi');
    expect(mainSource).toContain("import './index.css';");
  });
});

describe('Lofi theme', () => {
  it('uses a dark warm background with high-contrast text and lofi typography classes', () => {
    render(<App />);

    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { name: 'ReelPod Studio' });

    expect(main.className).toContain('bg-lofi-bg');
    expect(main.className).toContain('text-lofi-text');
    expect(heading.className).toContain('font-serif');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import packageJson from '../package.json';
import mainSource from './main.tsx?raw';
import tailwindConfigSource from '../tailwind.config.ts?raw';
import appSource from './App.tsx?raw';

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
    expect(main.className).toContain('font-sans');
    expect(main.className).toContain('text-sm');
    expect(heading.className).toContain('text-4xl');
    expect(heading.className).toContain('font-bold');
    expect(heading.className).toContain('font-serif');
  });

  it('uses only lofi/warm background and border classes without stone/gray overrides', () => {
    expect(appSource).not.toMatch(/\bbg-(stone|gray)-/);
    expect(appSource).not.toMatch(/\bborder-(stone|gray)-/);
    expect(appSource).not.toContain('border-white');
  });

  it('uses text-sm and muted accent for subtitle and secondary labels', () => {
    render(<App />);

    const subtitle = screen.getByText(
      'Create music and visuals for YouTube, TikTok & Reels.'
    );
    const musicTab = screen.getByRole('button', { name: 'Music Generation' });

    expect(subtitle.className).toContain('text-sm');
    expect(subtitle.className).toContain('text-lofi-accentMuted');
    expect(musicTab.className).toContain('text-sm');
  });

  it('uses accent hover/focus on interactive controls and accent active tab indicator', () => {
    render(<App />);

    const musicTab = screen.getByRole('button', { name: 'Music Generation' });
    const briefInput = screen.getByLabelText('Creative brief');
    const durationInput = screen.getByLabelText('Duration (s)');
    const generateButton = screen.getByRole('button', { name: 'Generate' });

    expect(musicTab.className).toContain('border-lofi-accent');
    expect(briefInput.className).toContain('hover:border-lofi-accent');
    expect(briefInput.className).toContain('focus-visible:ring-lofi-accent');
    expect(durationInput.className).toContain('hover:border-lofi-accent');
    expect(durationInput.className).toContain('focus-visible:ring-lofi-accent');
    expect(generateButton.className).toContain('hover:bg-lofi-accent/90');
    expect(generateButton.className).toContain('focus-visible:ring-lofi-accent');
  });

  it('does not use text-xs for primary app content', () => {
    expect(appSource).not.toContain('text-xs');
  });
});

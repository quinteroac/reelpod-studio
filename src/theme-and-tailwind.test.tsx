import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from './App';
import packageJson from '../package.json';
import mainSource from './main.tsx?raw';
import tailwindConfigSource from '../tailwind.config.ts?raw';
import appSource from './App.tsx?raw';

const indexCssSource = readFileSync(
  join(process.cwd(), 'src/index.css'),
  'utf8'
);

function getRootColorToken(tokenName: string): string {
  const tokenMatch = indexCssSource.match(
    new RegExp(`--${tokenName}:\\s*(#[0-9a-fA-F]{6});`)
  );
  return tokenMatch?.[1].toLowerCase() ?? '';
}

function parseHexColor(hexColor: string): [number, number, number] {
  const normalizedHex = hexColor.replace('#', '');
  const red = Number.parseInt(normalizedHex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16) / 255;

  return [red, green, blue];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linearChannel = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  const linearRed = linearChannel(red);
  const linearGreen = linearChannel(green);
  const linearBlue = linearChannel(blue);

  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}

function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const foregroundLuminance = relativeLuminance(parseHexColor(foregroundHex));
  const backgroundLuminance = relativeLuminance(parseHexColor(backgroundHex));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

describe('Tailwind setup', () => {
  it('includes Tailwind in dependencies and configures required files', () => {
    expect(packageJson.devDependencies?.tailwindcss).toBeTruthy();
    expect(tailwindConfigSource).toContain('content:');
    expect(tailwindConfigSource).toContain('lofi');
    expect(mainSource).toContain("import './index.css';");
  });
});

describe('Lofi theme', () => {
  it('uses a cool dusk text token with strong contrast on both lofi background surfaces', () => {
    const text = getRootColorToken('color-lofi-text');
    const background = getRootColorToken('color-lofi-bg');
    const panel = getRootColorToken('color-lofi-panel');

    expect(text).toBe('#e8e4f0');
    expect(contrastRatio(text, background)).toBeGreaterThan(7);
    expect(contrastRatio(text, panel)).toBeGreaterThan(7);
  });

  it('uses crepuscular accent tokens (soft purple and sunset pink) for dusk styling', () => {
    const accent = getRootColorToken('color-lofi-accent');
    const accentMuted = getRootColorToken('color-lofi-accent-muted');

    expect(accent).toBe('#b28fc3');
    expect(accentMuted).toBe('#e8a8c7');
  });

  it('keeps muted accent softer while preserving warm dusk contrast on background', () => {
    const background = getRootColorToken('color-lofi-bg');
    const accent = getRootColorToken('color-lofi-accent');
    const accentMuted = getRootColorToken('color-lofi-accent-muted');

    expect(accentMuted).not.toBe(accent);
    expect(contrastRatio(accent, background)).toBeGreaterThan(5);
    expect(contrastRatio(accentMuted, background)).toBeGreaterThan(3.5);
  });

  it('uses lofi background surfaces with high-contrast typography classes', () => {
    render(<App />);

    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { name: 'ReelPod Studio' });

    expect(main.className).toContain('bg-transparent');
    expect(main.className).toContain('text-lofi-text');
    expect(main.className).toContain('font-sans');
    expect(main.className).toContain('text-sm');
    expect(heading.className).toContain('text-4xl');
    expect(heading.className).toContain('font-bold');
    expect(heading.className).toContain('font-serif');
  });

  it('keeps the ReelPod Studio header and panel labels legible with lofi text token styling', () => {
    render(<App />);

    const heading = screen.getByRole('heading', { name: 'ReelPod Studio' });
    const creativeBriefLabel = screen.getByText('Creative brief');
    const durationLabel = screen.getByText('Duration (s)');
    const socialFormatLegend = screen.getByText('Format');

    expect(heading.className).toContain('text-lofi-text');
    expect(creativeBriefLabel.className).toContain('text-lofi-text');
    expect(durationLabel.className).toContain('text-lofi-text');
    expect(socialFormatLegend.className).toContain('text-lofi-text');
  });

  it('uses only lofi/warm background and border classes without stone/gray overrides', () => {
    expect(appSource).not.toMatch(/\bbg-(stone|gray)-/);
    expect(appSource).not.toMatch(/\bborder-(stone|gray)-/);
    expect(appSource).not.toContain('border-white');
  });

  it('uses text-sm and muted accent for subtitle and secondary labels', () => {
    render(<App />);
    const background = getRootColorToken('color-lofi-bg');
    const accentMuted = getRootColorToken('color-lofi-accent-muted');

    const subtitle = screen.getByText(
      'Create music and visuals for YouTube, TikTok & Reels.'
    );
    const musicTab = screen.getByRole('button', { name: 'Music Generation' });

    expect(subtitle.className).toContain('text-sm');
    expect(subtitle.className).toContain('text-lofi-accentMuted');
    expect(contrastRatio(accentMuted, background)).toBeGreaterThan(4.5);
    expect(musicTab.className).toContain('text-sm');
  });

  it('uses accent hover/focus on interactive controls and accent active tab indicator', () => {
    render(<App />);

    const musicTab = screen.getByRole('button', { name: 'Music Generation' });
    const briefInput = screen.getByLabelText('Creative brief');
    const durationInput = screen.getByLabelText('Duration (s)');
    const generateButton = screen.getByRole('button', { name: 'Generate' });
    const selectedSocialFormat = screen.getByRole('radio', {
      name: 'YouTube (16:9 · 1920×1080)'
    });

    expect(musicTab.className).toContain('border-lofi-accent');
    expect(briefInput.className).toContain('hover:border-lofi-accent');
    expect(briefInput.className).toContain('focus-visible:ring-lofi-accent');
    expect(durationInput.className).toContain('hover:border-lofi-accent');
    expect(durationInput.className).toContain('focus-visible:ring-lofi-accent');
    expect(generateButton.className).toContain('hover:bg-lofi-accent/90');
    expect(generateButton.className).toContain('focus-visible:ring-lofi-accent');
    expect(selectedSocialFormat.closest('label')?.className).toContain(
      'border-lofi-accent'
    );
    expect(selectedSocialFormat.closest('label')?.className).toContain(
      'bg-lofi-accent/20'
    );
  });

  it('does not use text-xs for primary app content', () => {
    expect(appSource).not.toContain('text-xs');
  });

  it('keeps the seek slider track on the shared lofi gradient and thumb accent tokens', () => {
    expect(indexCssSource).toContain('.seek-slider::-webkit-slider-runnable-track');
    expect(indexCssSource).toContain('.seek-slider::-moz-range-track');
    expect(indexCssSource).toContain('var(--color-lofi-accent) 0%');
    expect(indexCssSource).toContain('var(--color-lofi-accent-muted) 100%');
    expect(indexCssSource).toContain('.seek-slider::-webkit-slider-thumb');
    expect(indexCssSource).toContain('.seek-slider::-moz-range-thumb');
    expect(indexCssSource).toContain('background-color: var(--color-lofi-accent);');
    expect(indexCssSource).not.toMatch(/seek-slider[\s\S]*gray/i);
  });
});

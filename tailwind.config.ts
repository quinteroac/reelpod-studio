import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lofi: {
          bg: 'var(--color-lofi-bg)',
          panel: 'var(--color-lofi-panel)',
          accent: 'var(--color-lofi-accent)',
          accentMuted: 'var(--color-lofi-accent-muted)',
          text: 'var(--color-lofi-text)'
        }
      },
      fontFamily: {
        sans: ['Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Merriweather', 'ui-serif', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
} satisfies Config;

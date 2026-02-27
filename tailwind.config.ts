import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lofi: {
          bg: '#1c1714',
          panel: '#2a211d',
          accent: '#c08457',
          text: '#f5ede5'
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

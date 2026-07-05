/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        paper: {
          DEFAULT: '#FFFFFF',
          dark: '#F5F5F0',
        },
        carbon: {
          DEFAULT: '#1A1A1A',
          light: '#2D2D2D',
        },
        'alert-red': 'var(--alert-red)',
        // Risk palette — single source for graph-node and inline severity coloring.
        // Dark-mode equivalents are handled via tinted backgrounds (see tint-* below).
        risk: {
          // critical + high flip to the stealth-dark tones via CSS vars
          // (RGB channels → alpha modifiers like /[0.12] keep working)
          critical: 'rgb(var(--risk-critical) / <alpha-value>)',
          high: 'rgb(var(--risk-high) / <alpha-value>)',
          medium: '#8B8B8B',
          low: '#C8C8C8',
          // deeper text-only variants (used for labels on tinted backgrounds)
          'high-deep': 'var(--risk-high-deep)',
          'medium-deep': 'var(--risk-medium-deep)',
        },
        // Mode-aware tinted surfaces. Resolve via CSS variables so dark mode works
        // without a parallel set of `html.dark` overrides.
        tint: {
          critical: 'var(--tint-critical)',
          neutral: 'var(--tint-neutral)',
          paper: 'var(--tint-paper)',
        },
        // Severity ladder — brand flow: shades of red → shades of grey.
        // critical = full red, high = rose red, medium = grey, low = light grey.
        severity: {
          critical: {
            DEFAULT: '#D90429',
            bg: '#FDF2F4',
            border: '#F2CDD4',
            text: '#9F1239',
          },
          high: {
            DEFAULT: '#C4516C',
            bg: '#FAEDF0',
            border: '#E9CAD2',
            text: '#9F1239',
          },
          medium: {
            DEFAULT: '#8B8B8B',
            bg: '#F3F3F3',
            border: '#DFDFDF',
            text: '#525252',
          },
          low: {
            DEFAULT: '#C8C8C8',
            bg: '#F8F8F8',
            border: '#E8E8E8',
            text: '#9A9A9A',
          },
          info: {
            DEFAULT: '#9CA3AF',
            bg: '#F3F4F6',
            border: '#E5E7EB',
            text: '#525252',
          },
        },
      },
      boxShadow: {
        // Legacy 8px brutal shadows (header/CTA blocks)
        'brutal-xl': '8px 8px 0px var(--brutal)',
        'brutal-xl-accent': '8px 8px 0px var(--alert-red)',
        // Standard 3-4px brutal shadows used by graph nodes — color flips in dark mode.
        'brutal': '3px 3px 0px var(--brutal)',
        'brutal-lg': '4px 4px 0px var(--brutal)',
        'brutal-sm': '2px 2px 0px var(--brutal-soft)',
        'brutal-soft': '3px 3px 0px var(--brutal-soft)',
        'brutal-softer': '3px 3px 0px var(--brutal-softer)',
        'brutal-rose': '3px 3px 0px var(--brutal-rose)',
        'brutal-accent': '3px 3px 0px var(--alert-red)',
        'brutal-accent-lg': '4px 4px 0px var(--alert-red)',
      },
      animation: {
        'pulse-slow': 'pulse-slow 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.2s ease-in-out',
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

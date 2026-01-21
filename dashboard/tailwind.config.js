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
        severity: {
          critical: {
            DEFAULT: '#DC2626',
            bg: '#FEE2E2',
            border: '#FECACA',
            text: '#991B1B',
          },
          high: {
            DEFAULT: '#EA580C',
            bg: '#FFEDD5',
            border: '#FED7AA',
            text: '#9A3412',
          },
          medium: {
            DEFAULT: '#CA8A04',
            bg: '#FEF9C3',
            border: '#FDE68A',
            text: '#854D0E',
          },
          low: {
            DEFAULT: '#2563EB',
            bg: '#DBEAFE',
            border: '#BFDBFE',
            text: '#1E40AF',
          },
          info: {
            DEFAULT: '#6B7280',
            bg: '#F3F4F6',
            border: '#E5E7EB',
            text: '#374151',
          },
        },
      },
      boxShadow: {
        'brutal': '8px 8px 0px #1A1A1A',
        'brutal-sm': '4px 4px 0px #1A1A1A',
        'brutal-hover': '8px 8px 0px #D90429',
        'brutal-sm-hover': '4px 4px 0px #D90429',
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f3f6fb',
          100: '#e4eaf4',
          200: '#c7d2e6',
          300: '#9aabcb',
          400: '#6a7fa8',
          500: '#455b87',
          600: '#2f4271',
          700: '#1f305a',
          800: '#14234a',
          900: '#0b1a3d',
          950: '#06112b',
        },
        electric: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bcd1ff',
          300: '#8cb0ff',
          400: '#5a86ff',
          500: '#2f62ff',
          600: '#1a47f0',
          700: '#1436c9',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,26,61,0.04), 0 8px 24px -12px rgba(11,26,61,0.12)',
        pop: '0 20px 50px -20px rgba(11,26,61,0.35)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { shimmer: 'shimmer 1.4s infinite' },
    },
  },
  plugins: [],
}

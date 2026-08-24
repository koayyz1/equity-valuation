/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Remap the gray ramp to a blue-tinted "midnight" palette. Every existing
      // gray-* class in the app picks this up — richer than neutral gray without
      // touching individual components.
      colors: {
        gray: {
          50:  '#F6F8FB',
          100: '#EEF1F6',
          200: '#DFE5EE',
          300: '#C3CCDA',
          400: '#94A1B8',
          500: '#64748B',
          600: '#475569',
          700: '#2C3A50',
          800: '#1B2537',
          900: '#0E1524',
          950: '#080D18',
        },
      },
    },
  },
  plugins: [],
};

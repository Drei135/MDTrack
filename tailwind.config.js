/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#eef7ff',
          100: '#d9edff',
          400: '#4da3ff',
          500: '#2f86eb',
          600: '#1f68c4',
          700: '#194f96'
        },
        // Cream/amber palette used by the MOM (Minutes of the Meeting) modal —
        // intentionally distinct from the app's dark theme, matching the
        // MENDORO paper-form look requested for that flow.
        mom: {
          bg: '#faf6ee',
          panel: '#eee5d3',
          line: '#e4c9a0',
          lineStrong: '#cf9a52',
          ink: '#2a2418',
          sub: '#8a7a5c',
          label: '#b06a24',
          accent: '#8a3b12',
          accent2: '#c97c3d',
          header: '#17171c'
        }
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        'scale-in': 'scaleIn 120ms ease-out'
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        scaleIn: { from: { opacity: 0, transform: 'scale(0.97)' }, to: { opacity: 1, transform: 'scale(1)' } }
      }
    }
  },
  plugins: []
};

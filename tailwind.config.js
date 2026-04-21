/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f14',
          secondary: '#1a1a2e',
          card: '#16213e',
          hover: '#1e2a45'
        },
        accent: {
          DEFAULT: '#22c55e',
          hover: '#16a34a',
          muted: '#166534'
        },
        border: '#334155',
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#64748b'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}

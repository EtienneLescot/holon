/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3b82f6',
          600: '#2563eb',
          300: '#60a5fa'
        },
        accent: '#59b8f6',
        bg: '#0b0c10',
        surface: '#0f1114',
        panel: 'rgba(10,11,14,0.6)',
        card: '#1a1c23',
        muted: 'rgba(255,255,255,0.3)',
        'scroll-thumb': 'rgba(255,255,255,0.06)',
        'scroll-thumb-hover': 'rgba(255,255,255,0.12)'
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", 'Roboto', 'sans-serif']
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};

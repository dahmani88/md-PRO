/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E3A5F',
          50:  '#E8EEF5',
          100: '#C5D4E6',
          200: '#9BBAD3',
          500: '#1E3A5F',
          600: '#172D4A',
          700: '#102035',
        },
        accent: {
          DEFAULT: '#F0A500',
          50:  '#FEF3D0',
          100: '#FDE49A',
          500: '#F0A500',
          600: '#CC8C00',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        lopia: {
          red: '#E8002D',
          'red-dark': '#C0001F',
          'red-light': '#FFEEF1',
        },
      },
      fontFamily: {
        sans: ['Noto Sans JP', 'Noto Sans TC', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config

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
        // 看板改版用：批次號、KPI 數字、日期、箱數都用等寬字（數字才會對齊好讀）
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config

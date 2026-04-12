'use client'
import { Lang } from '@/lib/i18n'

export default function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex border border-gray-200 rounded-md overflow-hidden">
      <button
        onClick={() => setLang('zh')}
        className={`px-3 min-h-[36px] text-xs font-semibold transition-colors cursor-pointer ${
          lang === 'zh'
            ? 'bg-lopia-red text-white'
            : 'bg-white text-gray-500 hover:bg-lopia-red-light hover:text-lopia-red hover:border-lopia-red'
        }`}
      >
        中文
      </button>
      <button
        onClick={() => setLang('ja')}
        className={`px-3 min-h-[36px] text-xs font-semibold transition-colors cursor-pointer border-l border-gray-200 ${
          lang === 'ja'
            ? 'bg-lopia-red text-white'
            : 'bg-white text-gray-500 hover:bg-lopia-red-light hover:text-lopia-red'
        }`}
      >
        日本語
      </button>
    </div>
  )
}

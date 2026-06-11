'use client'
import { Lang } from '@/lib/i18n'

export default function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex border border-gray-200 rounded-md overflow-hidden">
      <button
        onClick={() => setLang('zh')}
        className={`px-2.5 min-h-[30px] text-xs transition-colors cursor-pointer ${
          lang === 'zh'
            ? 'bg-gray-100 text-gray-800 font-semibold'
            : 'bg-white text-gray-400 hover:text-gray-600'
        }`}
      >
        中文
      </button>
      <button
        onClick={() => setLang('ja')}
        className={`px-2.5 min-h-[30px] text-xs transition-colors cursor-pointer border-l border-gray-200 ${
          lang === 'ja'
            ? 'bg-gray-100 text-gray-800 font-semibold'
            : 'bg-white text-gray-400 hover:text-gray-600'
        }`}
      >
        日本語
      </button>
    </div>
  )
}

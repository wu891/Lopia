'use client'
import { Lang } from '@/lib/i18n'

export default function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
      <button
        onClick={() => setLang('zh')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
          lang === 'zh' ? 'bg-white shadow text-lopia-red font-bold' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        中文
      </button>
      <button
        onClick={() => setLang('ja')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
          lang === 'ja' ? 'bg-white shadow text-lopia-red font-bold' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        日本語
      </button>
    </div>
  )
}

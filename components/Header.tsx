'use client'
import { Lang, t } from '@/lib/i18n'
import LanguageToggle from './LanguageToggle'

interface HeaderProps {
  lang: Lang
  setLang: (l: Lang) => void
  lastUpdated: string | null
  onRefresh: () => void
}

export default function Header({ lang, setLang, lastUpdated, onRefresh }: HeaderProps) {
  const T = t[lang]
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo + Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded bg-lopia-red">
            <span className="text-white font-bold text-xs tracking-tight">LOPIA</span>
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-base leading-tight">{T.title}</h1>
            <p className="text-xs text-gray-400">{T.subtitle}</p>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="hidden sm:block text-xs text-gray-400">
              {T.lastUpdated}: {new Date(lastUpdated).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
            </span>
          )}
          <button
            onClick={onRefresh}
            className="text-xs text-gray-500 hover:text-lopia-red transition-colors px-2 py-1 rounded hover:bg-lopia-red-light"
          >
            ↺ {T.refresh}
          </button>
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  )
}

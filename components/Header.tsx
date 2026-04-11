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
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
        {/* Logo + Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-lopia-red shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm leading-tight">{T.title}</h1>
            <p className="text-xs text-gray-400">{T.subtitle}</p>
          </div>
        </div>

        <div className="flex-1" />

        {/* Right side */}
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {T.lastUpdated}: {new Date(lastUpdated).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
            </span>
          )}
          <a
            href="/portal"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {T.logisticsPortal}
          </a>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            {T.refresh}
          </button>
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  )
}

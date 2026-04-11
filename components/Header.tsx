'use client'
import { Lang, t } from '@/lib/i18n'
import LanguageToggle from './LanguageToggle'

interface HeaderProps {
  lang: Lang
  setLang: (l: Lang) => void
  lastUpdated: string | null
  onRefresh: () => void
}

export default function Header({ lang, setLang, lastUpdated }: HeaderProps) {
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
            className="flex items-center text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red cursor-pointer font-medium"
          >
            物流系統
          </a>
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  )
}

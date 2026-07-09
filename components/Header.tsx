'use client'
import { useState, useRef, useEffect } from 'react'
import { Lang, t } from '@/lib/i18n'
import LanguageToggle from './LanguageToggle'

interface HeaderProps {
  lang: Lang
  setLang: (l: Lang) => void
  lastUpdated: string | null
  onRefresh: () => void
}

export const TOOLS = [
  {
    label: '出貨單產生',
    href: '/shipment-generator',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
      </svg>
    ),
  },
  {
    label: '出貨檢查清單',
    href: '/checklist',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
  {
    label: '對帳單系統',
    href: '/reconciliation-dashboard.html',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  {
    label: '進口流程',
    href: '/import-training.html',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
  },
]

export default function Header({ lang, setLang, lastUpdated }: HeaderProps) {
  const T = t[lang]
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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

          {/* 業務工具 dropdown */}
          <div className="relative" ref={ref}>
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red font-medium"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
              業務工具
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {open && (
              <div className="absolute right-0 top-full mt-1.5 w-40 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
                {TOOLS.map(tool => (
                  <a
                    key={tool.href}
                    href={tool.href}
                    {...(!('sameTab' in tool && tool.sameTab) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-gray-600 hover:text-lopia-red hover:bg-lopia-red-light transition-colors"
                  >
                    <span className="text-gray-400 group-hover:text-lopia-red">{tool.icon}</span>
                    {tool.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <LanguageToggle lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  )
}

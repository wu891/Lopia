import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LOPIA 商品動態 | 進口貨況追蹤',
  description: 'LOPIA 台灣進口商品即時貨況查詢 — 供應商、進口商、倉庫、通關公司專用',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%23E8002D"/><text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="bold" fill="white" font-family="sans-serif">LOPIA</text></svg>',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  )
}

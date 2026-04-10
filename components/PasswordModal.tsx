'use client'
import { useState, useRef, useEffect } from 'react'

// ── Session auth helpers ──────────────────────────────────────────────────────
export const AUTH_KEY = 'lopia_authed'

export function isAuthed(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(AUTH_KEY) === '1'
}

export function markAuthed() {
  if (typeof window !== 'undefined') sessionStorage.setItem(AUTH_KEY, '1')
}

// ── Log helper ────────────────────────────────────────────────────────────────
export async function logChange(action: string, target: string, detail: string) {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target, detail }),
    })
  } catch {
    // logging errors are non-blocking
  }
}

// ── PasswordModal ─────────────────────────────────────────────────────────────
interface Props {
  onSuccess: () => void
  onCancel:  () => void
  lang?: 'zh' | 'ja'
}

export default function PasswordModal({ onSuccess, onCancel, lang = 'zh' }: Props) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isJa = lang === 'ja'

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setChecking(true); setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        markAuthed()
        onSuccess()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? (isJa ? 'パスワードが違います' : '密碼錯誤'))
        setPassword('')
        inputRef.current?.focus()
      }
    } catch {
      setError(isJa ? 'ネットワークエラー' : '網路錯誤，請稍後再試')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm z-10 overflow-hidden">
        {/* Header */}
        <div className="bg-lopia-red px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-white text-xl">🔐</span>
            <h2 className="font-bold text-white text-base">
              {isJa ? '編集パスワード' : '請輸入編輯密碼'}
            </h2>
          </div>
          <p className="text-red-100 text-xs mt-1">
            {isJa
              ? '変更を行うにはパスワードが必要です'
              : '新增、編輯或刪除資料需要驗證身份'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isJa ? 'パスワードを入力' : '輸入密碼'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
              autoComplete="current-password"
            />
            {error && (
              <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                <span>⚠</span> {error}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={checking || !password.trim()}
              className="flex-1 py-2.5 bg-lopia-red text-white text-sm font-semibold rounded-lg hover:bg-lopia-red-dark disabled:opacity-40 transition-colors"
            >
              {checking
                ? (isJa ? '確認中...' : '驗證中...')
                : (isJa ? '確認' : '確認')}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              {isJa ? 'キャンセル' : '取消'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

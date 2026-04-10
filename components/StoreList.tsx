'use client'
import { Lang, t } from '@/lib/i18n'
import { STORES } from '@/lib/stores'

export default function StoreList({ lang }: { lang: Lang }) {
  const T = t[lang]
  const open = STORES.filter(s => s.status === 'open')
  const coming = STORES.filter(s => s.status === 'coming_soon')

  const cities = [...new Set(open.map(s => s.city_zh))]

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="text-lopia-red text-lg">🏪</span>
        <h2 className="font-bold text-gray-800">{T.storeList}</h2>
        <span className="ml-auto text-xs text-gray-400">{open.length} {T.openStores} / {coming.length} {T.comingSoon}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Open stores by city */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{T.openStores}</p>
          <div className="space-y-3">
            {cities.map(city => (
              <div key={city}>
                <p className="text-xs text-lopia-red font-medium mb-1">{city}</p>
                <div className="space-y-1">
                  {open.filter(s => s.city_zh === city).map(store => (
                    <div key={store.id} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          {lang === 'ja' ? store.name_ja : store.name_zh}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{store.address_zh}</p>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">
                        {new Date(store.opened).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coming soon */}
        {coming.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{T.comingSoon}</p>
            <div className="space-y-1">
              {coming.map(store => (
                <div key={store.id} className="flex items-start gap-2 border border-dashed border-gray-200 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500">
                      {lang === 'ja' ? store.name_ja : store.name_zh}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{store.address_zh}</p>
                  </div>
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full shrink-0">
                    {lang === 'ja' ? 'まもなく' : '即將'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ComboboxItem {
  id: number
  label: string
  sub?: string
  extra?: string
  badge?: string
}

interface Props {
  items: ComboboxItem[]
  value: string
  onChange: (val: string) => void
  onSelect: (id: number, item: ComboboxItem) => void
  placeholder?: string
  error?: boolean
  disabled?: boolean
  maxItems?: number
}

export function Combobox({
  items, value, onChange, onSelect,
  placeholder = 'Rechercher...', error, disabled, maxItems = 12,
}: Props) {
  const [open, setOpen]       = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)

  // حساب موضع الـ dropdown بناءً على موضع الـ input في الصفحة
  function updatePos() {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropPos({
      top:   rect.bottom + window.scrollY + 4,
      left:  rect.left   + window.scrollX,
      width: rect.width,
    })
  }

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  // إغلاق عند الضغط خارج
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      // تحقق من الـ portal dropdown أيضاً
      const portal = document.getElementById('combobox-portal')
      if (portal?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = value.trim()
    ? items.filter(i =>
        i.label.toLowerCase().includes(value.toLowerCase()) ||
        (i.sub ?? '').toLowerCase().includes(value.toLowerCase()) ||
        (`${i.sub} ${i.label}`).toLowerCase().includes(value.toLowerCase()) ||
        (`${i.sub} — ${i.label}`).toLowerCase().includes(value.toLowerCase())
      )
    : items

  const dropdown = open ? (
    <div
      id="combobox-portal"
      style={{
        position: 'absolute',
        top:      dropPos.top,
        left:     dropPos.left,
        width:    dropPos.width,
        zIndex:   9999,
      }}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
        rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto"
    >
      {filtered.length === 0 && value.trim().length > 0 ? (
        <div className="px-4 py-3 text-sm text-gray-400 text-center">
          Aucun résultat pour « {value} »
        </div>
      ) : (
        <>
          {filtered.slice(0, maxItems).map(item => (
            <button
              key={item.id}
              type="button"
              className="w-full flex items-center justify-between px-4 py-2.5
                hover:bg-primary/5 dark:hover:bg-primary/10 text-left transition-colors
                border-b border-gray-50 dark:border-gray-700/50 last:border-0"
              onMouseDown={e => {
                e.preventDefault()
                onSelect(item.id, item)
                setOpen(false)
              }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {item.label}
                </div>
                {item.sub && (
                  <div className="text-xs text-gray-400 font-mono truncate">{item.sub}</div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                {item.badge && (
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">
                    {item.badge}
                  </span>
                )}
                {item.extra && (
                  <span className={`text-xs font-semibold ${item.extra.includes('⚠') ? 'text-red-500' : 'text-gray-500'}`}>
                    {item.extra}
                  </span>
                )}
              </div>
            </button>
          ))}
          {filtered.length > maxItems && (
            <div className="px-4 py-2 text-xs text-gray-400 text-center bg-gray-50 dark:bg-gray-700/50">
              +{filtered.length - maxItems} résultats — affinez la recherche
            </div>
          )}
        </>
      )}
    </div>
  ) : null

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => { updatePos(); setOpen(true) }}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className={`input w-full ${error ? 'border-red-400 focus:ring-red-400' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        placeholder={placeholder}
      />
      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  )
}

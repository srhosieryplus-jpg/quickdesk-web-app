'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { User } from '@/lib/types'

const purpleD = '#5b21b6'
const purple = '#7c3aed'
const gray = '#6b7280'
const border = '#e5e7eb'

const LS_ABBREV_KEY    = 'hairAcc_abbrevMap'
const LS_COLORS_KEY    = 'hairAcc_colorMap'    // per-vendorId color list
const LS_SAMEAS_KEY    = 'hairAcc_sameAs'      // per-style "same as" link
const LS_PREDESC_KEY   = 'hairAcc_preDesc'     // per-vendorId pre-description
const LS_FINALDESC_KEY = 'hairAcc_finalDesc'   // per-style final description (editable)
const LS_SELECTED_KEY  = 'hairAcc_selected'    // vendorIds selected to order
const LS_QTY_KEY       = 'hairAcc_qtyMap'      // qty per vendorId→ending→colorKey
const LS_PIVOT_STYLES  = 'hairAcc_pivotStyles' // per-vendorId set of endings included in pivot
const LS_ALIAS_KEY     = 'hairAcc_aliasMap'    // style → canonical style name it aliases

// Strip parenthetical notes and apply proper title case
function toTitleCase(s: string): string {
  return s
    .replace(/\s*\([^)]*\)/g, '')   // remove (...)
    .replace(/\s+/g, ' ').trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function buildFinalDesc(preD: string, rawStyle: string): string {
  const pre = preD.trim()
  const ending = toTitleCase(rawStyle)
  return pre ? `${pre} ${ending}` : ending
}

function loadSaved<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function saveTo(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

interface StyleRow { vendorId: string; style: string; price: number }
interface ColorEntry { code: string; name: string; qty?: string }

// ── Parse paste ────────────────────────────────────────────────────────────
function parsePaste(text: string): StyleRow[] {
  const rows: StyleRow[] = []
  let currentVendorId = ''

  for (const rawLine of text.split('\n')) {
    const cols = rawLine.split('\t').map(c => c.trim())
    if (cols.every(c => !c)) continue

    if (cols.length === 1) {
      const val = cols[0]
      if (!val) continue
      const looksLikePrice = /^\d+(\.\d+)?$/.test(val) && parseFloat(val) < 500
      if (!looksLikePrice && val.length <= 10 && !/\s/.test(val) && /[A-Za-z0-9]/.test(val)) {
        currentVendorId = val; continue
      }
      if (!looksLikePrice) rows.push({ vendorId: currentVendorId, style: val, price: 0 })
      continue
    }

    const col0 = cols[0], col1 = cols[1] ?? '', col2 = cols[2] ?? ''
    const looksLikePrice0 = /^\d+(\.\d+)?$/.test(col0) && parseFloat(col0) < 500
    const looksLikeVendorId = !!col0 && !looksLikePrice0

    if (looksLikeVendorId && col1) {
      currentVendorId = col0
      const price = parseFloat(col2)
      rows.push({ vendorId: col0, style: col1, price: isNaN(price) ? 0 : price })
    } else if (!col0 && col1) {
      const price = parseFloat(col2)
      rows.push({ vendorId: currentVendorId, style: col1, price: isNaN(price) ? 0 : price })
    } else if (col0 && !looksLikePrice0) {
      const price = parseFloat(col1) || parseFloat(col2)
      rows.push({ vendorId: currentVendorId, style: col0, price: isNaN(price) ? 0 : price })
    }
  }
  return rows.filter(r => r.style)
}

// ── Step indicator ─────────────────────────────────────────────────────────
function Steps({ current }: { current: number }) {
  const steps = ['Paste', 'Endings & Order', 'Colors & Qty', 'Output']
  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'center', marginBottom: 24 }}>
      {steps.map((s, i) => {
        const active = i === current, done = i < current
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 20, background: active ? purpleD : done ? '#d1fae5' : '#f3f4f6', color: active ? '#fff' : done ? '#065f46' : '#9ca3af', fontSize: 12, fontWeight: 700, transition: 'all 0.2s' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, background: active ? 'rgba(255,255,255,0.2)' : done ? '#6ee7b7' : '#e5e7eb', color: active ? '#fff' : done ? '#065f46' : '#9ca3af' }}>{done ? '✓' : i + 1}</span>
              {s}
            </div>
            {i < steps.length - 1 && <div style={{ width: 24, height: 2, background: done ? '#6ee7b7' : '#e5e7eb' }} />}
          </div>
        )
      })}
    </div>
  )
}

export default function HairAccPage() {
  const router = useRouter()
  const [user, setUser]       = useState<User | null>(null)
  const [step, setStep]       = useState(0)
  const [paste, setPaste]     = useState('')
  const [abbrevMap, setAbbrevMap]   = useState<Record<string, string>>({})
  const [colorMap, setColorMap]     = useState<Record<string, ColorEntry[]>>({})
  const [sameAs, setSameAs]         = useState<Record<string, string>>({})
  // Per-vendorId pre-description (e.g. "Floral Crochet Lace" for MD27003)
  const [preDesc, setPreDesc]       = useState<Record<string, string>>({})
  // Per-style final description — auto-built but user-editable
  const [finalDesc, setFinalDesc]   = useState<Record<string, string>>({})
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [copied, setCopied]         = useState(false)
  const [sameAsPopup, setSameAsPopup] = useState<{ forVid: string; srcVid: string } | null>(null)
  const [aliasMap, setAliasMap]       = useState<Record<string, string>>({}) // style → canonical style
  const [backendOpen, setBackendOpen] = useState(false)
  const [backendOpenVids, setBackendOpenVids] = useState<Set<string>>(new Set())
  // qtyMap[vendorId][ending][colorKey] = qty string
  const [qtyMap, setQtyMap]         = useState<Record<string, Record<string, Record<string, string>>>>({})
  // pivotStyles[vendorId] = Set of ending codes included in pivot
  const [pivotStyles, setPivotStyles] = useState<Record<string, string[]>>({})
  const [pivotPopup, setPivotPopup]   = useState<string | null>(null) // vendorId

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    setAbbrevMap(loadSaved(LS_ABBREV_KEY, {}))
    setColorMap(loadSaved(LS_COLORS_KEY, {}))
    setSameAs(loadSaved(LS_SAMEAS_KEY, {}))
    setPreDesc(loadSaved(LS_PREDESC_KEY, {}))
    setFinalDesc(loadSaved(LS_FINALDESC_KEY, {}))
    setQtyMap(loadSaved(LS_QTY_KEY, {}))
    setPivotStyles(loadSaved(LS_PIVOT_STYLES, {}))
    setAliasMap(loadSaved(LS_ALIAS_KEY, {}))
    const sel: string[] = loadSaved(LS_SELECTED_KEY, [])
    setSelected(new Set(sel))
  }, [router])

  // Parse paste
  const parsedRows = useMemo(() => parsePaste(paste), [paste])

  // Unique styles in order of first appearance
  const uniqueStyles = useMemo(() =>
    Array.from(new Map(parsedRows.map(r => [r.style.toLowerCase(), r.style])).values()),
    [parsedRows]
  )

  // Resolve effective ending for a style, following alias chain
  function resolveEnding(style: string): string {
    const lower = style.toLowerCase()
    // case-insensitive lookup helper
    function abbrevLookup(key: string): string {
      if (abbrevMap[key] !== undefined) return abbrevMap[key]
      const k = Object.keys(abbrevMap).find(k => k.toLowerCase() === key.toLowerCase())
      return k ? abbrevMap[k] : ''
    }
    const canonRaw = aliasMap[style] ?? Object.entries(aliasMap).find(([k]) => k.toLowerCase() === lower)?.[1]
    const canon = canonRaw?.trim()
    return canon ? abbrevLookup(canon) : abbrevLookup(style)
  }

  // Active styles = those whose ending is NOT 'X' (alias-resolved)
  const activeStyles = useMemo(() =>
    uniqueStyles.filter(s => resolveEnding(s).toUpperCase() !== 'X'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uniqueStyles, abbrevMap, aliasMap]
  )

  // VendorIds selected to order → derive selected styles
  const selectedStyles = useMemo(() => {
    if (selected.size === 0) return activeStyles
    return parsedRows
      .filter(r => selected.has(r.vendorId) && activeStyles.includes(r.style))
      .map(r => r.style)
      .filter((s, i, arr) => arr.indexOf(s) === i)
  }, [activeStyles, selected, parsedRows])

  // Build output — only active styles, colors from global list
  interface OutRow { vendorId: string; styleCode: string; styleName: string; color: string; qty: string; price: number; isFirstForVendor: boolean }

  // color key used in qtyMap: "code|name"
  function colorKey(c: ColorEntry) { return `${c.code.trim()}|${c.name.trim()}` }

  // Resolve colors for a vendorId
  function resolveColors(vendorId: string): ColorEntry[] {
    return (colorMap[vendorId] ?? []).filter(c => c.code.trim() || c.name.trim())
  }

  const outRows = useMemo((): OutRow[] => {
    const out: OutRow[] = []
    let lastVendor = ''

    const orderSet = selectedStyles.length > 0 ? selectedStyles : activeStyles
    for (const r of parsedRows) {
      if (!orderSet.includes(r.style)) continue
      const ending = resolveEnding(r.style)
      // Skip styles excluded from this vendor's pivot (if pivot has been configured)
      const vPivot = pivotStyles[r.vendorId]
      if (vPivot && vPivot.length > 0 && !vPivot.includes(r.style)) continue
      const styleCode = ending
        ? (r.vendorId ? `${r.vendorId}${ending}` : ending)
        : (r.vendorId || r.style.slice(0, 8).replace(/\s+/g, '').toUpperCase())
      const styleName = finalDesc[r.style]?.trim() || r.style
      const isFirstForVendor = r.vendorId !== lastVendor
      if (r.vendorId) lastVendor = r.vendorId
      const colors = resolveColors(r.vendorId)

      if (colors.length === 0) {
        out.push({ vendorId: r.vendorId, styleCode, styleName, color: '', qty: '', price: r.price, isFirstForVendor })
      } else {
        colors.forEach((c, ci) => {
          const colorStr = c.code.trim() && c.name.trim()
            ? `#${c.code.trim()} ${c.name.trim()}`
            : c.name.trim() || `#${c.code.trim()}`
          const qty = (qtyMap[r.vendorId]?.[ending]?.[colorKey(c)] ?? '').trim()
          out.push({ vendorId: r.vendorId, styleCode, styleName, color: colorStr, qty, price: r.price, isFirstForVendor: ci === 0 && isFirstForVendor })
        })
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedRows, activeStyles, abbrevMap, colorMap, finalDesc, selectedStyles, qtyMap, pivotStyles])

  function copyOutput() {
    const tsv = outRows.map(r => [
      r.isFirstForVendor ? r.vendorId : '',
      r.styleCode, r.styleName, r.color, r.qty,
      r.price > 0 ? r.price.toFixed(2) : '',
    ].join('\t')).join('\n')
    navigator.clipboard.writeText(tsv)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!user) return null

  const inp: React.CSSProperties = { border: `1.5px solid ${border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', background: '#fff', color: '#111' }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ff', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1.5px solid ${border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
        <button onClick={() => { if (step > 0) setStep(step - 1); else router.push('/selector') }} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>
          ← {step > 0 ? 'Back' : 'Menu'}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: purpleD }}>Hair Accessories</div>
          <div style={{ fontSize: 11, color: gray }}>Style code generator</div>
        </div>
        {step === 3 && (
          <button onClick={copyOutput} style={{ background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: copied ? '#065f46' : '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {copied ? '✓ Copied!' : 'Copy TSV'}
          </button>
        )}
        {step > 0 && parsedRows.length > 0 && (
          <button onClick={() => setBackendOpen(true)} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>Backend</button>
        )}
        {step > 0 && (
          <button onClick={() => { setStep(0); setPaste('') }} style={{ background: '#fee2e2', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>Reset</button>
        )}
      </div>

      {/* ── Backend drawer ── */}
      {backendOpen && (() => {
        const beTab = backendOpenVids.has('__tab_vendors') ? 'vendors' : 'items'
        const allVids = Array.from(new Map(parsedRows.map(r => [r.vendorId, r.vendorId])).keys())
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }} onClick={() => setBackendOpen(false)}>
            <div style={{ background: '#fff', width: '100%', maxWidth: 440, height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '14px 20px', borderBottom: `1.5px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: purpleD, flex: 1 }}>Backend</div>
                <button onClick={() => setBackendOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: gray, lineHeight: 1 }}>×</button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: `1.5px solid ${border}`, background: '#fafafa' }}>
                {[{ key: 'items', label: 'Item Names' }, { key: 'vendors', label: 'Vendor Cards' }].map(t => (
                  <button key={t.key} onClick={() => {
                    const next = new Set(backendOpenVids)
                    t.key === 'vendors' ? next.add('__tab_vendors') : next.delete('__tab_vendors')
                    setBackendOpenVids(next)
                  }} style={{ flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: beTab === t.key ? `2.5px solid ${purple}` : '2.5px solid transparent', background: 'none', color: beTab === t.key ? purple : gray, cursor: 'pointer' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

                {/* ── Item Names tab ── */}
                {beTab === 'items' && (() => {
                  // Group ALL raw names by lowercase key to show duplicates/case variants
                  const rawGroups = new Map<string, { names: string[]; vids: string[] }>()
                  for (const r of parsedRows) {
                    const key = r.style.toLowerCase()
                    if (!rawGroups.has(key)) rawGroups.set(key, { names: [], vids: [] })
                    const g = rawGroups.get(key)!
                    if (!g.names.includes(r.style)) g.names.push(r.style)
                    if (!g.vids.includes(r.vendorId)) g.vids.push(r.vendorId)
                  }
                  const groups = Array.from(rawGroups.values())
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {groups.map((g, i) => {
                        const hasDupes = g.names.length > 1
                        return (
                          <div key={i} style={{ border: `1px solid ${hasDupes ? '#fbbf24' : border}`, borderRadius: 8, overflow: 'hidden', background: hasDupes ? '#fffbeb' : '#fff' }}>
                            {g.names.map((name, ni) => (
                              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: ni < g.names.length - 1 ? `1px dashed #fde68a` : 'none' }}>
                                {hasDupes && <span style={{ fontSize: 10, color: '#d97706', fontWeight: 700 }}>{ni === 0 ? '=' : '='}</span>}
                                <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>{name}</span>
                                <span style={{ fontSize: 10, color: gray, fontFamily: 'monospace' }}>{parsedRows.find(r => r.style === name)?.vendorId}</span>
                              </div>
                            ))}
                            {hasDupes && (
                              <div style={{ padding: '3px 12px', background: '#fef3c7', fontSize: 10, color: '#92400e' }}>
                                treated as same item — {g.vids.join(', ')}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {/* ── Vendor Cards tab ── */}
                {beTab === 'vendors' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, color: gray, marginBottom: 2 }}>Raw paste data grouped by vendor card.</div>
                    {allVids.map(vid => {
                      const vidRows = parsedRows.filter(r => r.vendorId === vid)
                      const isOpen = !backendOpenVids.has(`be-${vid}`)
                      return (
                        <div key={vid} style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
                          <div onClick={() => {
                            const next = new Set(backendOpenVids)
                            isOpen ? next.add(`be-${vid}`) : next.delete(`be-${vid}`)
                            setBackendOpenVids(next)
                          }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#f9f7ff', cursor: 'pointer', userSelect: 'none' }}>
                            <span style={{ background: purpleD, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 900, fontFamily: 'monospace' }}>{vid || '(no vendor)'}</span>
                            <span style={{ fontSize: 11, color: gray }}>{vidRows.length} item{vidRows.length !== 1 ? 's' : ''}</span>
                            <span style={{ marginLeft: 'auto', color: gray }}>{isOpen ? '▾' : '▸'}</span>
                          </div>
                          {isOpen && (
                            <div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 12px', padding: '4px 14px', background: '#f5f3ff', borderBottom: `1px solid ${border}` }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Item Name</div>
                                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Price</div>
                              </div>
                              {vidRows.map((r, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 12px', padding: '5px 14px', borderBottom: i < vidRows.length - 1 ? `1px solid #f9f9f9` : 'none', background: i % 2 === 0 ? '#fff' : '#fafbff' }}>
                                  <span style={{ fontSize: 12, color: '#374151' }}>{r.style}</span>
                                  <span style={{ fontSize: 12, color: gray, fontFamily: 'monospace' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

              </div>
            </div>
          </div>
        )
      })()}

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        <Steps current={step} />

        {/* ── STEP 0: Paste ───────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, padding: 24, boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 6 }}>Paste vendor data</div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 16, lineHeight: 1.6 }}>
              Paste tab-separated rows from Excel. Format: <code style={{ background: '#f5f3ff', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>VendorID · Style · Price</code> — or just one style name per line.
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              autoFocus
              placeholder={'MD27001\tHEADBAND\t1.9\n\tLARGE CLIP\t2.3\nor plain:\nSCRUNCHY\nPLEATED HEADBAND\nFlat headband'}
              style={{ width: '100%', height: 280, fontFamily: 'monospace', fontSize: 12, border: `1.5px solid #d4c8f0`, borderRadius: 8, padding: 12, resize: 'vertical', outline: 'none', color: '#374151', lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            {paste && parsedRows.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: gray }}>{parsedRows.length} rows · {uniqueStyles.length} unique styles</div>
            )}
            <button
              onClick={() => {
                if (!paste.trim() || uniqueStyles.length === 0) return
                // Load saved endings
                const saved = loadSaved<Record<string, string>>(LS_ABBREV_KEY, {})
                const merged: Record<string, string> = {}
                for (const s of uniqueStyles) merged[s] = saved[s] ?? ''
                setAbbrevMap(merged)
                setStep(1)
              }}
              disabled={!paste.trim() || uniqueStyles.length === 0}
              style={{ marginTop: 16, background: paste.trim() && uniqueStyles.length > 0 ? `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)` : '#e5e7eb', color: paste.trim() && uniqueStyles.length > 0 ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: paste.trim() ? 'pointer' : 'not-allowed', boxShadow: paste.trim() ? '0 2px 10px rgba(124,58,237,0.3)' : 'none' }}
            >Next: Set Endings →</button>
          </div>
        )}

        {/* ── STEP 1: Endings & Order (two-panel) ─────────────────────── */}
        {step === 1 && (() => {
          // Build vendor groups directly from parsedRows to preserve all vendor→style mappings
          const vendorGroupMap = new Map<string, string[]>()
          for (const r of parsedRows) {
            if (!vendorGroupMap.has(r.vendorId)) vendorGroupMap.set(r.vendorId, [])
            const arr = vendorGroupMap.get(r.vendorId)!
            if (!arr.includes(r.style)) arr.push(r.style)
          }
          const vendorGroups = Array.from(vendorGroupMap)
          // Right panel: all vendors, keeping only non-X styles
          const activeVendorGroups = vendorGroups.map(([vid, styles]) => ({
            vid,
            styles: styles.filter(s => (abbrevMap[s] ?? '').trim().toUpperCase() !== 'X')
          })).filter(g => g.styles.length > 0)

          const allVids = activeVendorGroups.map(g => g.vid)
          const allSelected = allVids.length > 0 && allVids.every(v => selected.has(v))
          const selCount = activeVendorGroups.filter(g => selected.has(g.vid)).length

          return (
            <div>
              {/* Top nav */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                <button onClick={() => {
                  saveTo(LS_ABBREV_KEY, abbrevMap)
                  saveTo(LS_FINALDESC_KEY, finalDesc)
                  saveTo(LS_SELECTED_KEY, Array.from(selected))
                  const orderStyles = selCount > 0 ? activeStyles.filter(s => selected.has(s)) : activeStyles
                  const saved = loadSaved<Record<string, ColorEntry[]>>(LS_COLORS_KEY, {})
                  const merged: Record<string, ColorEntry[]> = {}
                  for (const s of orderStyles) merged[s] = saved[s] ?? [{ code: '', name: '', qty: '' }]
                  setColorMap(merged)
                  setStep(2)
                }} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }}>
                  Next: Colors & Qty →
                </button>
                <span style={{ fontSize: 12, color: gray }}>
                  {selCount > 0 ? `${selCount} vendor${selCount !== 1 ? 's' : ''} selected` : `All ${activeVendorGroups.length} vendors`}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

                {/* ── LEFT: Endings editor (unique styles, with alias) ── */}
                <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
                  <div style={{ background: '#f5f3ff', borderBottom: `1px solid ${border}`, padding: '12px 16px' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: purpleD }}>Style Endings</div>
                    <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>VendorID + Ending = Style Code · <strong>Same as</strong> merges into another style · Type <span style={{ color: '#dc2626', fontWeight: 700 }}>X</span> to hide</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 68px', gap: '0 6px', padding: '5px 14px', borderBottom: `1px solid #f0f0f0` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Style (from paste)</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Same as</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Ending</div>
                  </div>
                  {uniqueStyles.map(s => {
                    const alias = aliasMap[s] ?? ''
                    const ownEnding = abbrevMap[s] ?? ''
                    const effectiveEnding = alias ? (abbrevMap[alias] ?? '') : ownEnding
                    const isX = effectiveEnding.trim().toUpperCase() === 'X'
                    const isAliased = !!alias
                    // Other unique styles this one could alias to (not itself, not styles that alias to this one)
                    const aliasTargets = uniqueStyles.filter(o => o !== s && !aliasMap[o])
                    return (
                      <div key={s} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 68px', gap: '0 6px', padding: '4px 14px', borderBottom: `1px solid #f9f9f9`, alignItems: 'center', background: isX ? '#fef9f9' : isAliased ? '#f9f7ff' : 'transparent' }}>
                        <div style={{ fontSize: 12, color: isX ? '#9ca3af' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isX ? 'line-through' : 'none' }} title={s}>{s}</div>
                        <select
                          value={alias}
                          onChange={e => {
                            const val = e.target.value
                            const am = { ...aliasMap, [s]: val }
                            setAliasMap(am); saveTo(LS_ALIAS_KEY, am)
                          }}
                          style={{ ...inp, fontSize: 11, padding: '2px 4px', color: alias ? purpleD : '#9ca3af' }}
                        >
                          <option value="">—</option>
                          {aliasTargets.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input
                          value={isAliased ? effectiveEnding : ownEnding}
                          readOnly={isAliased}
                          onChange={e => {
                            if (isAliased) return
                            const val = e.target.value.toUpperCase()
                            const updated = { ...abbrevMap, [s]: val }
                            setAbbrevMap(updated); saveTo(LS_ABBREV_KEY, updated)
                            if (val && val !== 'X') {
                              const fdUpdated = { ...finalDesc, [s]: buildFinalDesc('', s) }
                              setFinalDesc(fdUpdated); saveTo(LS_FINALDESC_KEY, fdUpdated)
                            }
                            if (val === 'X') {
                              const next = new Set(selected); next.delete(s)
                              setSelected(next); saveTo(LS_SELECTED_KEY, Array.from(next))
                            }
                          }}
                          placeholder="HC"
                          style={{ ...inp, fontFamily: 'monospace', fontWeight: 700, fontSize: 12, background: isAliased ? '#ede9fe' : isX ? '#fef2f2' : '#fff', color: isAliased ? purpleD : isX ? '#dc2626' : '#111', borderColor: isAliased ? '#c4b5fd' : isX ? '#fca5a5' : border, width: '100%' }}
                          onFocus={e => { if (!isX && !isAliased) e.target.style.borderColor = purple }}
                          onBlur={e => { e.target.style.borderColor = isAliased ? '#c4b5fd' : isX ? '#fca5a5' : border }}
                        />
                      </div>
                    )
                  })}
                </div>

                {/* ── RIGHT: Order checklist ── */}
                <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
                  <div style={{ background: '#f5f3ff', borderBottom: `1px solid ${border}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: purpleD }}>Select to Order</div>
                      <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>
                        {selCount > 0 ? `${selCount} of ${activeVendorGroups.length} vendors selected` : `${activeVendorGroups.length} vendors`}
                      </div>
                    </div>
                    <button onClick={() => {
                      const next = allSelected ? new Set<string>() : new Set(allVids)
                      setSelected(next); saveTo(LS_SELECTED_KEY, Array.from(next))
                    }} style={{ background: '#ede9fe', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: purple, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {/* One row per vendor: checkbox | vendor ID | pre description */}
                  <div style={{ padding: '6px 0' }}>
                    {activeVendorGroups.map(({ vid, styles }) => {
                      const isSel = selected.has(vid)
                      return (
                        <div key={vid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 14px', borderBottom: `1px solid #f9f9f9`, background: isSel ? '#f8f7ff' : 'transparent' }}>
                          <input type="checkbox" checked={isSel} onChange={() => {
                            const next = new Set(selected)
                            isSel ? next.delete(vid) : next.add(vid)
                            setSelected(next); saveTo(LS_SELECTED_KEY, Array.from(next))
                          }} style={{ accentColor: purple, width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }} />
                          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 900, color: isSel ? purpleD : '#6b7280', minWidth: 72, flexShrink: 0 }}>{vid || '—'}</span>
                          <input
                            value={preDesc[vid] ?? ''}
                            onChange={e => {
                              const updated = { ...preDesc, [vid]: e.target.value }
                              setPreDesc(updated); saveTo(LS_PREDESC_KEY, updated)
                              const fdUpdated = { ...finalDesc }
                              for (const s of styles) {
                                const ending = abbrevMap[s]?.trim() ?? ''
                                if (ending && ending !== 'X') fdUpdated[s] = buildFinalDesc(e.target.value, s)
                              }
                              setFinalDesc(fdUpdated); saveTo(LS_FINALDESC_KEY, fdUpdated)
                            }}
                            placeholder="Pre description…"
                            style={{ ...inp, flex: 1, fontSize: 12 }}
                            onFocus={e => e.target.style.borderColor = purple}
                            onBlur={e => e.target.style.borderColor = border}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

            </div>
          )
        })()}

        {/* ── STEP 2: Colors & Qty (per vendor) ───────────────────────── */}
        {step === 2 && (() => {
          // Show exactly the checked vendors; fall back to all active vendors if none checked
          const allActiveVids = Array.from(new Set(
            parsedRows.filter(r => activeStyles.includes(r.style)).map(r => r.vendorId).filter(Boolean)
          ))
          const orderVids = selected.size > 0 ? Array.from(selected).filter(v => allActiveVids.includes(v)) : allActiveVids
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <button onClick={() => { saveTo(LS_COLORS_KEY, colorMap); setStep(3) }} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }}>
                  Next: See Output →
                </button>
                <button onClick={() => setStep(3)} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>
                  Skip (no colors)
                </button>
                <span style={{ fontSize: 12, color: gray }}>Set colors per vendor — shared across all selected styles of that vendor.</span>
              </div>

              {/* Same-as popup */}
              {sameAsPopup && (() => {
                const srcEntries = (colorMap[sameAsPopup.srcVid] ?? []).filter(c => c.code.trim() || c.name.trim())
                return (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSameAsPopup(null)}>
                    <div style={{ background: '#fff', borderRadius: 14, padding: 20, minWidth: 320, maxWidth: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }} onClick={ev => ev.stopPropagation()}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: purpleD, marginBottom: 4 }}>Copy colors from {sameAsPopup.srcVid}</div>
                      <div style={{ fontSize: 12, color: gray, marginBottom: 14 }}>Select which colors to auto-fill into <strong>{sameAsPopup.forVid}</strong></div>
                      {srcEntries.length === 0 ? (
                        <div style={{ fontSize: 12, color: gray }}>No colors set for {sameAsPopup.srcVid} yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                          {srcEntries.map((c, ci) => {
                            const label = c.code.trim() && c.name.trim() ? `#${c.code.trim()} ${c.name.trim()}` : c.name.trim() || `#${c.code.trim()}`
                            return (
                              <label key={ci} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '5px 8px', borderRadius: 7, background: '#f9f7ff' }}>
                                <input type="checkbox" defaultChecked style={{ accentColor: purple, width: 15, height: 15 }} id={`saPopup-${ci}`} />
                                <span style={{ fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{label}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setSameAsPopup(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, color: gray, cursor: 'pointer' }}>Cancel</button>
                        {srcEntries.length > 0 && (
                          <button onClick={() => {
                            const checks = srcEntries.map((_, ci) => (document.getElementById(`saPopup-${ci}`) as HTMLInputElement)?.checked ?? true)
                            const picked = srcEntries.filter((_, ci) => checks[ci])
                            if (picked.length === 0) { setSameAsPopup(null); return }
                            const existing = (colorMap[sameAsPopup!.forVid] ?? []).filter(c => c.code.trim() || c.name.trim())
                            // Merge: add only colors not already present by code
                            const toAdd = picked.filter(p => !existing.some(e => e.code.trim() === p.code.trim() && e.name.trim() === p.name.trim()))
                            const merged = [...existing, ...toAdd.map(c => ({ code: c.code, name: c.name }))]
                            const cm = { ...colorMap, [sameAsPopup!.forVid]: merged.length ? merged : [{ code: '', name: '' }] }
                            setColorMap(cm); saveTo(LS_COLORS_KEY, cm)
                            setSameAsPopup(null)
                          }} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Copy Selected →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* ── Pivot popup ── */}
              {pivotPopup && (() => {
                const vid = pivotPopup
                const colors = resolveColors(vid)
                // Get ALL styles for this vendor from parsedRows (not filtered by uniqueStyles/activeStyles)
                // so shared style names like "LARGE CLIP" that appear under multiple vendors all show up
                const xEndings = new Set(
                  Object.entries(abbrevMap).filter(([,v]) => v.trim().toUpperCase() === 'X').map(([k]) => k.toLowerCase())
                )
                const vidStyleRows = parsedRows.filter(r => r.vendorId === vid && !xEndings.has(r.style.toLowerCase()))
                // Dedupe styles preserving order
                const seen = new Set<string>()
                const vidUniq = vidStyleRows.filter(r => { if (seen.has(r.style.toLowerCase())) return false; seen.add(r.style.toLowerCase()); return true })
                // pivotStyles[vid] stores selected style names (not endings, to avoid collision)
                const allStyleNames = vidUniq.map(r => r.style)
                const curPivotStyles: string[] = pivotStyles[vid] ?? allStyleNames
                const curQty = qtyMap[vid] ?? {}

                return (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setPivotPopup(null)}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 680, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,0.22)' }} onClick={e => e.stopPropagation()}>

                      {/* Header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <span style={{ background: purpleD, color: '#fff', borderRadius: 6, padding: '3px 12px', fontSize: 13, fontWeight: 900, fontFamily: 'monospace' }}>{vid}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: purpleD }}>Qty per Color × Style</span>
                        <button onClick={() => setPivotPopup(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: gray, lineHeight: 1 }}>×</button>
                      </div>

                      {colors.length === 0 ? (
                        <div style={{ fontSize: 13, color: gray, padding: '20px 0' }}>Add colors to this vendor first in the step above.</div>
                      ) : (
                        <>
                          {/* Style column toggles — keyed by style name to avoid ending collision */}
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Include styles in order</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {vidUniq.map(r => {
                                const ending = resolveEnding(r.style)
                                const on = curPivotStyles.includes(r.style)
                                return (
                                  <button key={r.style} onClick={() => {
                                    const next = on ? curPivotStyles.filter(s => s !== r.style) : [...curPivotStyles, r.style]
                                    const ps = { ...pivotStyles, [vid]: next }
                                    setPivotStyles(ps); saveTo(LS_PIVOT_STYLES, ps)
                                  }} style={{ background: on ? purpleD : '#f3f4f6', color: on ? '#fff' : '#374151', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{r.style}</span>
                                    {ending && (
                                      <span style={{ fontSize: 10, fontWeight: 900, fontFamily: 'monospace', background: on ? 'rgba(255,255,255,0.25)' : '#e5e7eb', borderRadius: 4, padding: '1px 5px' }}>{ending}</span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {/* Pivot table — columns keyed by style name */}
                          {curPivotStyles.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                                <thead>
                                  <tr>
                                    <th style={{ padding: '6px 10px', background: '#f5f3ff', borderBottom: `2px solid ${border}`, textAlign: 'left', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Color</th>
                                    {curPivotStyles.map(styleName => {
                                      const ending = resolveEnding(styleName) || '?'
                                      return (
                                        <th key={styleName} style={{ padding: '6px 10px', background: '#f5f3ff', borderBottom: `2px solid ${border}`, textAlign: 'center', fontFamily: 'monospace', fontWeight: 900, color: purpleD, whiteSpace: 'nowrap' }}>{vid}{ending}</th>
                                      )
                                    })}
                                  </tr>
                                </thead>
                                <tbody>
                                  {colors.map((c, ci) => {
                                    const ck = colorKey(c)
                                    const label = c.code.trim() && c.name.trim() ? `#${c.code} ${c.name}` : c.name.trim() || `#${c.code.trim()}`
                                    return (
                                      <tr key={ci} style={{ background: ci % 2 === 0 ? '#fff' : '#fafbff' }}>
                                        <td style={{ padding: '5px 10px', borderBottom: `1px solid ${border}`, fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#374151' }}>{label}</td>
                                        {curPivotStyles.map(styleName => {
                                          const ending = resolveEnding(styleName) || '?'
                                          const val = curQty[ending]?.[ck] ?? ''
                                          return (
                                            <td key={styleName} style={{ padding: '4px 6px', borderBottom: `1px solid ${border}`, textAlign: 'center' }}>
                                              <input
                                                value={val}
                                                onChange={ev => {
                                                  const nq = { ...qtyMap, [vid]: { ...curQty, [ending]: { ...(curQty[ending] ?? {}), [ck]: ev.target.value } } }
                                                  setQtyMap(nq); saveTo(LS_QTY_KEY, nq)
                                                }}
                                                onKeyDown={ev => {
                                                  if (ev.key === 'Enter' || ev.key === 'Tab') {
                                                    ev.preventDefault()
                                                    const inputs = Array.from(document.querySelectorAll('.pivot-qty-input')) as HTMLInputElement[]
                                                    const idx = inputs.indexOf(ev.currentTarget as HTMLInputElement)
                                                    if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus()
                                                  }
                                                }}
                                                className="pivot-qty-input"
                                                placeholder="—"
                                                style={{ width: 52, textAlign: 'center', border: `1.5px solid ${border}`, borderRadius: 5, padding: '3px 6px', fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
                                                onFocus={ev => ev.target.style.borderColor = purple}
                                                onBlur={ev => ev.target.style.borderColor = border}
                                              />
                                            </td>
                                          )
                                        })}
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      )}

                      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => setPivotPopup(null)} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {orderVids.map((vid, vidIdx) => {
                  const entries: ColorEntry[] = colorMap[vid] ?? [{ code: '', name: '' }]
                  const vidStyles = activeStyles.filter(s => parsedRows.some(r => r.style === s && r.vendorId === vid))
                  // Other vendor cards that have colors set — for "same as" source
                  const otherVidsWithColors = orderVids.filter((v, i) => i !== vidIdx && (colorMap[v] ?? []).some(c => c.code.trim() || c.name.trim()))

                  const addRow = () => {
                    const cm = { ...colorMap, [vid]: [...entries, { code: '', name: '' }] }
                    setColorMap(cm); saveTo(LS_COLORS_KEY, cm)
                  }

                  return (
                    <div key={vid} data-vid={vid} style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.05)' }}>
                      {/* Vendor header */}
                      <div style={{ background: 'linear-gradient(90deg, #f5f3ff 0%, #fff 100%)', borderBottom: `1px solid ${border}`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ background: purpleD, color: '#fff', borderRadius: 5, padding: '2px 10px', fontSize: 12, fontWeight: 900, fontFamily: 'monospace' }}>{vid || '—'}</span>
                        <span style={{ fontSize: 11, color: gray }}>
                          {vidStyles.map(s => abbrevMap[s]?.trim() ?? s).join(' · ')}
                        </span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                          {otherVidsWithColors.length > 0 && (
                            <select
                              value=""
                              onChange={e => { if (e.target.value) setSameAsPopup({ forVid: vid, srcVid: e.target.value }) }}
                              style={{ ...inp, fontSize: 11, padding: '3px 7px', maxWidth: 160 }}
                            >
                              <option value="">Same as…</option>
                              {otherVidsWithColors.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                          )}
                          <button onClick={addRow} style={{ background: '#f0ebff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: purple, cursor: 'pointer' }}>+ Color</button>
                          <button onClick={() => setPivotPopup(vid)} style={{ background: purpleD, color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Set Qty →</button>
                        </div>
                      </div>

                      {/* Color rows — no qty column */}
                      <div style={{ padding: '8px 14px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr 24px', gap: 6, marginBottom: 4 }}>
                          {['Code', 'Color Name', ''].map(h => (
                            <div key={h} style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                          ))}
                        </div>
                        {entries.map((e, ei) => (
                          <div key={ei} className="color-row" style={{ display: 'grid', gridTemplateColumns: '74px 1fr 24px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>#</span>
                              <input
                                value={e.code}
                                onChange={ev => { const u = [...entries]; u[ei] = { ...e, code: ev.target.value }; const cm = { ...colorMap, [vid]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }}
                                onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); (ev.currentTarget.closest('.color-row')?.querySelector('.name-inp') as HTMLInputElement)?.focus() } }}
                                placeholder="001"
                                style={{ ...inp, fontFamily: 'monospace', fontSize: 11, width: '100%' }}
                                onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border}
                              />
                            </div>
                            <input
                              className="name-inp"
                              value={e.name}
                              onChange={ev => { const u = [...entries]; u[ei] = { ...e, name: ev.target.value }; const cm = { ...colorMap, [vid]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }}
                              onKeyDown={ev => {
                                if (ev.key === 'Enter') {
                                  ev.preventDefault()
                                  if (ei === entries.length - 1) {
                                    addRow()
                                    setTimeout(() => {
                                      const rows = document.querySelectorAll(`[data-vid="${vid}"] .color-row`)
                                      const next = rows[ei + 1]?.querySelector('input') as HTMLInputElement
                                      next?.focus()
                                    }, 30)
                                  } else {
                                    const rows = document.querySelectorAll(`[data-vid="${vid}"] .color-row`)
                                    const next = rows[ei + 1]?.querySelector('input') as HTMLInputElement
                                    next?.focus()
                                  }
                                }
                              }}
                              placeholder="Black"
                              style={{ ...inp, fontSize: 11 }}
                              onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border}
                            />
                            <button onClick={() => { const u = entries.filter((_, i) => i !== ei); const cm = { ...colorMap, [vid]: u.length ? u : [{ code: '', name: '' }] }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 15, lineHeight: 1 }} onMouseOver={ev => (ev.currentTarget.style.color = '#ef4444')} onMouseOut={ev => (ev.currentTarget.style.color = '#d1d5db')}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

            </div>
          )
        })()}

        {/* ── STEP 3: Output ──────────────────────────────────────────── */}
        {step === 3 && (() => {
          // Unique vendors in output
          const outVids = Array.from(new Set(outRows.map(r => r.vendorId).filter(Boolean)))
          return (
            <div>
              {/* Top actions */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                <button onClick={copyOutput} style={{ background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: copied ? '#065f46' : '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: copied ? 'none' : '0 2px 10px rgba(124,58,237,0.3)' }}>
                  {copied ? '✓ Copied!' : 'Copy Table (TSV)'}
                </button>
                <button onClick={() => setStep(2)} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>← Edit Colors</button>
                <span style={{ fontSize: 12, color: gray }}>Copy and paste straight into your sheet.</span>
              </div>

              {/* Pre description editor per vendor */}
              {outVids.length > 0 && (
                <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.05)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Pre Description (per vendor)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {outVids.map(vid => (
                      <div key={vid} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                        <span style={{ background: purpleD, color: '#fff', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 900, fontFamily: 'monospace', textAlign: 'center' }}>{vid}</span>
                        <input
                          value={preDesc[vid] ?? ''}
                          onChange={e => {
                            const updated = { ...preDesc, [vid]: e.target.value }
                            setPreDesc(updated); saveTo(LS_PREDESC_KEY, updated)
                            // Rebuild final desc for all styles under this vendor
                            const fdUpdated = { ...finalDesc }
                            parsedRows.filter(r => r.vendorId === vid && activeStyles.includes(r.style)).forEach(r => {
                              fdUpdated[r.style] = buildFinalDesc(e.target.value, r.style)
                            })
                            setFinalDesc(fdUpdated); saveTo(LS_FINALDESC_KEY, fdUpdated)
                          }}
                          placeholder="e.g. Floral Crochet"
                          style={{ ...inp, fontSize: 12 }}
                          onFocus={ev => ev.target.style.borderColor = purple}
                          onBlur={ev => ev.target.style.borderColor = border}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Output table */}
              <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.05)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 130px 60px 70px', padding: '7px 14px', background: '#fafafa', borderBottom: `1px solid ${border}`, gap: 8 }}>
                  {['Vendor', 'Style Code', 'Style Name', 'Color', 'Qty', 'Price'].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
                  ))}
                </div>
                {outRows.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 130px 60px 70px', padding: '5px 14px', borderBottom: i < outRows.length - 1 ? `1px solid #f9f9f9` : 'none', background: i % 2 === 0 ? '#fff' : '#fafbff', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: r.isFirstForVendor && r.vendorId ? purpleD : 'transparent' }}>{r.isFirstForVendor ? r.vendorId : ''}</div>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: purpleD, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 5, padding: '2px 7px', display: 'inline-block' }}>{r.styleCode}</div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{r.styleName}</div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{r.color}</div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{r.qty}</div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

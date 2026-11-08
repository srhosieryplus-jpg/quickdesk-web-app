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
const LS_COLORS_KEY    = 'hairAcc_colorMap'    // per-style color map
const LS_SAMEAS_KEY    = 'hairAcc_sameAs'      // per-style "same as" link
const LS_PREDESC_KEY   = 'hairAcc_preDesc'     // per-vendorId pre-description
const LS_FINALDESC_KEY = 'hairAcc_finalDesc'   // per-style final description (editable)
const LS_SELECTED_KEY  = 'hairAcc_selected'    // vendorIds selected to order

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
interface ColorEntry { code: string; name: string; qty: string }

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

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    setAbbrevMap(loadSaved(LS_ABBREV_KEY, {}))
    setColorMap(loadSaved(LS_COLORS_KEY, {}))
    setSameAs(loadSaved(LS_SAMEAS_KEY, {}))
    setPreDesc(loadSaved(LS_PREDESC_KEY, {}))
    setFinalDesc(loadSaved(LS_FINALDESC_KEY, {}))
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

  // Active styles = those whose ending is NOT 'X'
  const activeStyles = useMemo(() =>
    uniqueStyles.filter(s => (abbrevMap[s] ?? '').trim().toUpperCase() !== 'X'),
    [uniqueStyles, abbrevMap]
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

  // Resolve colors for a style: look up by vendorId (colors shared across all styles of a vendor)
  function resolveColors(vendorId: string): ColorEntry[] {
    const source = colorMap[vendorId] ?? []
    return source.filter(c => c.code.trim() || c.name.trim())
  }

  const outRows = useMemo((): OutRow[] => {
    const out: OutRow[] = []
    let lastVendor = ''

    const orderSet = selectedStyles.length > 0 ? selectedStyles : activeStyles
    for (const r of parsedRows) {
      if (!orderSet.includes(r.style)) continue
      const ending = abbrevMap[r.style]?.trim() ?? ''
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
          out.push({ vendorId: r.vendorId, styleCode, styleName, color: colorStr, qty: c.qty.trim(), price: r.price, isFirstForVendor: ci === 0 && isFirstForVendor })
        })
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedRows, activeStyles, abbrevMap, colorMap, finalDesc, selectedStyles])

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
        {step > 0 && (
          <button onClick={() => { setStep(0); setPaste('') }} style={{ background: '#fee2e2', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>Reset</button>
        )}
      </div>

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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

                {/* ── LEFT: Endings editor ── */}
                <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
                  <div style={{ background: '#f5f3ff', borderBottom: `1px solid ${border}`, padding: '12px 16px' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: purpleD }}>Style Endings</div>
                    <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>VendorID + Ending = Style Code · Type <span style={{ color: '#dc2626', fontWeight: 700 }}>X</span> to hide</div>
                  </div>

                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px', gap: '0 8px', padding: '5px 14px', borderBottom: `1px solid #f0f0f0` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Style (from paste)</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Ending</div>
                  </div>

                  {uniqueStyles.map(s => {
                    const ending = abbrevMap[s] ?? ''
                    const isX = ending.trim().toUpperCase() === 'X'
                    return (
                      <div key={s} style={{ display: 'grid', gridTemplateColumns: '1fr 72px', gap: '0 8px', padding: '4px 14px', borderBottom: `1px solid #f9f9f9`, alignItems: 'center', background: isX ? '#fef9f9' : 'transparent' }}>
                        <div style={{ fontSize: 12, color: isX ? '#9ca3af' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isX ? 'line-through' : 'none' }} title={s}>{s}</div>
                        <input
                          value={ending}
                          onChange={e => {
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
                          style={{ ...inp, fontFamily: 'monospace', fontWeight: 700, fontSize: 12, background: isX ? '#fef2f2' : '#fff', color: isX ? '#dc2626' : '#111', borderColor: isX ? '#fca5a5' : border, width: '100%' }}
                          onFocus={e => { if (!isX) e.target.style.borderColor = purple }}
                          onBlur={e => { e.target.style.borderColor = isX ? '#fca5a5' : border }}
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

              {/* Footer */}
              <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
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
                }} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }}>
                  Next: Colors & Qty →
                </button>
                <span style={{ fontSize: 12, color: gray }}>
                  {selCount > 0 ? `${selCount} vendor${selCount !== 1 ? 's' : ''} selected` : `All ${activeVendorGroups.length} vendors`}
                </span>
              </div>
            </div>
          )
        })()}

        {/* ── STEP 2: Colors & Qty (per vendor) ───────────────────────── */}
        {step === 2 && (() => {
          // Get ordered vendors for selected (or all active) styles
          const orderVids = Array.from(
            new Map(selectedStyles.map(s => {
              const vid = parsedRows.find(r => r.style === s)?.vendorId ?? ''
              return [vid, vid]
            })).keys()
          )
          return (
            <div>
              <div style={{ fontSize: 12, color: gray, marginBottom: 14 }}>
                Set colors per vendor — shared across all selected styles of that vendor. Saved for next time.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {orderVids.map(vid => {
                  const entries: ColorEntry[] = colorMap[vid] ?? [{ code: '', name: '', qty: '' }]
                  const vidStyles = selectedStyles.filter(s => (parsedRows.find(r => r.style === s)?.vendorId ?? '') === vid)
                  return (
                    <div key={vid} style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.05)' }}>
                      {/* Vendor header */}
                      <div style={{ background: 'linear-gradient(90deg, #f5f3ff 0%, #fff 100%)', borderBottom: `1px solid ${border}`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ background: purpleD, color: '#fff', borderRadius: 5, padding: '2px 10px', fontSize: 12, fontWeight: 900, fontFamily: 'monospace' }}>{vid || '—'}</span>
                        <span style={{ fontSize: 11, color: gray }}>
                          {vidStyles.map(s => abbrevMap[s]?.trim() ?? s).join(' · ')}
                        </span>
                        <button onClick={() => {
                          const cm = { ...colorMap, [vid]: [...entries, { code: '', name: '', qty: '' }] }
                          setColorMap(cm); saveTo(LS_COLORS_KEY, cm)
                        }} style={{ background: '#f0ebff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: purple, cursor: 'pointer', marginLeft: 'auto' }}>+ Color</button>
                      </div>

                      {/* Color rows */}
                      <div style={{ padding: '8px 14px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr 70px 24px', gap: 6, marginBottom: 4 }}>
                          {['Code', 'Color Name', 'Qty', ''].map(h => (
                            <div key={h} style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                          ))}
                        </div>
                        {entries.map((e, ei) => (
                          <div key={ei} style={{ display: 'grid', gridTemplateColumns: '74px 1fr 70px 24px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>#</span>
                              <input value={e.code} onChange={ev => { const u = [...entries]; u[ei] = { ...e, code: ev.target.value }; const cm = { ...colorMap, [vid]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} placeholder="001" style={{ ...inp, fontFamily: 'monospace', fontSize: 11, width: '100%' }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                            </div>
                            <input value={e.name} onChange={ev => { const u = [...entries]; u[ei] = { ...e, name: ev.target.value }; const cm = { ...colorMap, [vid]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} placeholder="Black" style={{ ...inp, fontSize: 11 }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                            <input value={e.qty} onChange={ev => { const u = [...entries]; u[ei] = { ...e, qty: ev.target.value }; const cm = { ...colorMap, [vid]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} placeholder="12" style={{ ...inp, fontSize: 11 }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                            <button onClick={() => { const u = entries.filter((_, i) => i !== ei); const cm = { ...colorMap, [vid]: u.length ? u : [{ code: '', name: '', qty: '' }] }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 15, lineHeight: 1 }} onMouseOver={ev => (ev.currentTarget.style.color = '#ef4444')} onMouseOut={ev => (ev.currentTarget.style.color = '#d1d5db')}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <button onClick={() => { saveTo(LS_COLORS_KEY, colorMap); setStep(3) }} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }}>
                  Next: See Output →
                </button>
                <button onClick={() => setStep(3)} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>
                  Skip (no colors)
                </button>
              </div>
            </div>
          )
        })()}

        {/* ── STEP 3: Output ──────────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 14 }}>
              Table is formatted like your original paste — copy and paste straight into your sheet.
            </div>
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
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button onClick={copyOutput} style={{ background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: copied ? '#065f46' : '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: copied ? 'none' : '0 2px 10px rgba(124,58,237,0.3)' }}>
                {copied ? '✓ Copied to clipboard!' : 'Copy Table (TSV)'}
              </button>
              <button onClick={() => setStep(2)} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>← Edit Colors</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

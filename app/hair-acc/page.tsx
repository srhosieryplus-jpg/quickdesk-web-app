'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { User } from '@/lib/types'

const purpleD = '#5b21b6'
const purple = '#7c3aed'
const gray = '#6b7280'
const border = '#e5e7eb'

const LS_ABBREV_KEY = 'hairAcc_abbrevMap'
const LS_COLORS_KEY = 'hairAcc_colorMap'

function loadSaved<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function saveTo(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

interface StyleRow {
  vendorId: string   // empty string if none
  style: string      // normalized style name
  price: number
}

interface ColorEntry { code: string; name: string; qty: string }

// ── Parse paste: handles both "vendorId\tstyle\tprice" and plain "style" per line ─
function parsePaste(text: string): StyleRow[] {
  const rows: StyleRow[] = []
  let currentVendorId = ''

  for (const rawLine of text.split('\n')) {
    const cols = rawLine.split('\t').map(c => c.trim())
    // Remove completely empty lines
    if (cols.every(c => !c)) continue

    if (cols.length === 1) {
      // Single column — treat as style name (no vendor, no price)
      const val = cols[0]
      if (!val) continue
      // Could be a vendor ID line (non-price alphanumeric)
      const looksLikePrice = /^\d+(\.\d+)?$/.test(val) && parseFloat(val) < 500
      const looksLikeVendorId = !looksLikePrice && /^[A-Za-z0-9]/.test(val) && val.length >= 3
      if (looksLikeVendorId && !val.includes(' ')) {
        // Could be vendor ID on its own row — treat as style name anyway since it has spaces or not
        // If it looks more like a code (short, no spaces) treat as vendor id
        if (val.length <= 10 && !/\s/.test(val)) {
          currentVendorId = val
          continue
        }
      }
      rows.push({ vendorId: currentVendorId, style: val, price: 0 })
      continue
    }

    // Multi-column
    const col0 = cols[0]
    const col1 = cols[1] ?? ''
    const col2 = cols[2] ?? ''

    const looksLikePrice0 = /^\d+(\.\d+)?$/.test(col0) && parseFloat(col0) < 500
    const looksLikeVendorId = !!col0 && !looksLikePrice0

    if (looksLikeVendorId && col1) {
      // col0 = vendor ID, col1 = style, col2 = price
      currentVendorId = col0
      const price = parseFloat(col2)
      rows.push({ vendorId: col0, style: col1, price: isNaN(price) ? 0 : price })
    } else if (!col0 && col1) {
      // col0 blank, col1 = style under previous vendor
      const price = parseFloat(col2)
      rows.push({ vendorId: currentVendorId, style: col1, price: isNaN(price) ? 0 : price })
    } else if (col0 && !col1 && looksLikeVendorId) {
      // vendor id alone
      currentVendorId = col0
    } else if (col0 && !looksLikePrice0) {
      // treat col0 as style name
      const price = parseFloat(col1) || parseFloat(col2)
      rows.push({ vendorId: currentVendorId, style: col0, price: isNaN(price) ? 0 : price })
    }
  }
  return rows.filter(r => r.style)
}

export default function HairAccPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [paste, setPaste] = useState('')
  const [abbrevMap, setAbbrevMap] = useState<Record<string, string>>({})
  const [colorMap, setColorMap] = useState<Record<string, ColorEntry[]>>({})
  const [copied, setCopied] = useState(false)
  const [showColors, setShowColors] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    setAbbrevMap(loadSaved(LS_ABBREV_KEY, {}))
    setColorMap(loadSaved(LS_COLORS_KEY, {}))
  }, [router])

  // Parse paste live
  const parsedRows = useMemo(() => parsePaste(paste), [paste])

  // Unique styles in order of first appearance
  const uniqueStyles = useMemo(() =>
    Array.from(new Map(parsedRows.map(r => [r.style.toLowerCase(), r.style])).values()),
    [parsedRows]
  )

  // Build output rows live
  interface OutRow {
    vendorId: string; styleCode: string; styleName: string
    color: string; qty: string; price: number; isFirstForVendor: boolean
  }

  const outRows = useMemo((): OutRow[] => {
    const out: OutRow[] = []
    let lastVendor = ''
    for (const r of parsedRows) {
      const ending = abbrevMap[r.style]?.trim() ?? ''
      const styleCode = ending
        ? (r.vendorId ? `${r.vendorId}${ending}` : ending)
        : (r.vendorId || r.style.slice(0, 8).replace(/\s+/g, '').toUpperCase())
      const colors = (colorMap[r.style] ?? []).filter(c => c.code.trim() || c.name.trim())
      const isFirstForVendor = r.vendorId !== lastVendor
      if (r.vendorId) lastVendor = r.vendorId

      if (colors.length === 0) {
        out.push({ vendorId: r.vendorId, styleCode, styleName: r.style, color: '', qty: '', price: r.price, isFirstForVendor })
      } else {
        colors.forEach((c, ci) => {
          const colorStr = c.code.trim() && c.name.trim()
            ? `#${c.code.trim()} ${c.name.trim()}`
            : c.name.trim() || `#${c.code.trim()}`
          out.push({ vendorId: r.vendorId, styleCode, styleName: r.style, color: colorStr, qty: c.qty.trim(), price: r.price, isFirstForVendor: ci === 0 && isFirstForVendor })
        })
      }
    }
    return out
  }, [parsedRows, abbrevMap, colorMap])

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

  function saveAll() {
    saveTo(LS_ABBREV_KEY, abbrevMap)
    saveTo(LS_COLORS_KEY, colorMap)
  }

  if (!user) return null

  const inp: React.CSSProperties = {
    border: `1.5px solid ${border}`, borderRadius: 6, padding: '4px 8px',
    fontSize: 12, outline: 'none', background: '#fff', color: '#111',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ff', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1.5px solid ${border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
        <button onClick={() => router.push('/selector')} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>← Menu</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: purpleD }}>Hair Accessories</div>
          <div style={{ fontSize: 11, color: gray }}>Style code generator</div>
        </div>
        <button onClick={() => setShowColors(c => !c)} style={{ background: showColors ? purpleD : '#f0ebff', color: showColors ? '#fff' : purple, border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          🎨 {showColors ? 'Hide Colors' : 'Add Colors'}
        </button>
        <button onClick={() => { saveAll(); setCopied(true); setTimeout(() => setCopied(false), 1500) }} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>
          💾 Save
        </button>
        {outRows.length > 0 && (
          <button onClick={copyOutput} style={{ background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: copied ? '#065f46' : '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {copied ? '✓ Copied!' : 'Copy TSV'}
          </button>
        )}
        {paste && (
          <button onClick={() => { setPaste('') }} style={{ background: '#fee2e2', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>Reset</button>
        )}
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 16px' }}>

        {/* Top: paste area */}
        <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: purpleD, marginBottom: 6 }}>Paste vendor data</div>
          <div style={{ fontSize: 11, color: gray, marginBottom: 10 }}>
            Paste tab-separated rows from Excel. Format: <code style={{ background: '#f5f3ff', padding: '1px 6px', borderRadius: 4 }}>VendorID · Style · Price</code> — or just one style name per line.
          </div>
          <textarea
            value={paste}
            onChange={e => setPaste(e.target.value)}
            autoFocus
            placeholder={'MD27001\tHEADBAND\t1.9\n\tLARGE CLIP\t2.3\n\tor just: SCRUNCHIE\nPLEATED HEADBAND\n…'}
            style={{ width: '100%', height: 140, fontFamily: 'monospace', fontSize: 12, border: `1.5px solid #d4c8f0`, borderRadius: 8, padding: 10, resize: 'vertical', outline: 'none', color: '#374151', lineHeight: 1.6, boxSizing: 'border-box' }}
          />
          {paste && (
            <div style={{ marginTop: 8, fontSize: 11, color: gray }}>
              {parsedRows.length} rows · {uniqueStyles.length} unique styles
            </div>
          )}
        </div>

        {/* Bottom: side by side — endings + output */}
        {uniqueStyles.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: showColors ? '1fr' : '340px 1fr', gap: 16, alignItems: 'start' }}>

            {/* Left: unique styles + endings */}
            {!showColors && (
              <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, padding: 16, boxShadow: '0 2px 12px rgba(124,58,237,0.07)', position: 'sticky', top: 70 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: purpleD, marginBottom: 4 }}>Set style code endings</div>
                <div style={{ fontSize: 11, color: gray, marginBottom: 14 }}>Code = VendorID + ending (e.g. <code>MD27001</code> + <code>HC</code> → <code>MD27001HC</code>). Saved automatically.</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '0 12px', alignItems: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6, borderBottom: `1px solid #f0f0f0` }}>Style Name</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6, borderBottom: `1px solid #f0f0f0` }}>Ending</div>

                  {uniqueStyles.map(s => (
                    <>
                      <div key={s + '_l'} style={{ fontSize: 12, color: '#374151', padding: '6px 0', borderBottom: `1px solid #f9f9f9`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s}>{s}</div>
                      <div key={s + '_i'} style={{ padding: '4px 0', borderBottom: `1px solid #f9f9f9` }}>
                        <input
                          value={abbrevMap[s] ?? ''}
                          onChange={e => {
                            const val = e.target.value.toUpperCase()
                            setAbbrevMap(prev => ({ ...prev, [s]: val }))
                            saveTo(LS_ABBREV_KEY, { ...abbrevMap, [s]: val })
                          }}
                          placeholder="e.g. HC"
                          style={{ ...inp, width: '100%', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}
                          onFocus={e => e.target.style.borderColor = purple}
                          onBlur={e => e.target.style.borderColor = border}
                        />
                      </div>
                    </>
                  ))}
                </div>
              </div>
            )}

            {/* Colors view (expanded) */}
            {showColors && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {uniqueStyles.map(s => {
                  const entries = colorMap[s] ?? [{ code: '', name: '', qty: '' }]
                  const ending = abbrevMap[s]?.trim()
                  const vid = parsedRows.find(r => r.style === s)?.vendorId ?? ''
                  const code = ending ? (vid ? `${vid}${ending}` : ending) : s.slice(0, 8).replace(/\s+/g, '').toUpperCase()
                  return (
                    <div key={s} style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.05)' }}>
                      <div style={{ background: 'linear-gradient(90deg, #f5f3ff 0%, #fff 100%)', borderBottom: `1px solid ${border}`, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ background: purpleD, color: '#fff', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>{code}</span>
                        <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                        <button onClick={() => {
                          const updated = { ...colorMap, [s]: [...(colorMap[s] ?? []), { code: '', name: '', qty: '' }] }
                          setColorMap(updated); saveTo(LS_COLORS_KEY, updated)
                        }} style={{ background: '#f0ebff', border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: purple, cursor: 'pointer' }}>+ Color</button>
                      </div>
                      <div style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 52px 20px', gap: 4, marginBottom: 4 }}>
                          {['Code', 'Name', 'Qty', ''].map(h => <div key={h} style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>{h}</div>)}
                        </div>
                        {entries.map((e, ei) => (
                          <div key={ei} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 52px 20px', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <span style={{ color: '#9ca3af', fontSize: 12 }}>#</span>
                              <input value={e.code} onChange={ev => { const u = [...entries]; u[ei] = { ...e, code: ev.target.value }; const cm = { ...colorMap, [s]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} placeholder="001" style={{ ...inp, fontFamily: 'monospace', fontSize: 11, width: '100%' }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                            </div>
                            <input value={e.name} onChange={ev => { const u = [...entries]; u[ei] = { ...e, name: ev.target.value }; const cm = { ...colorMap, [s]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} placeholder="Black" style={{ ...inp, fontSize: 11 }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                            <input value={e.qty} onChange={ev => { const u = [...entries]; u[ei] = { ...e, qty: ev.target.value }; const cm = { ...colorMap, [s]: u }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} placeholder="12" style={{ ...inp, fontSize: 11 }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                            <button onClick={() => { const u = entries.filter((_, i) => i !== ei); const cm = { ...colorMap, [s]: u.length ? u : [{ code: '', name: '', qty: '' }] }; setColorMap(cm); saveTo(LS_COLORS_KEY, cm) }} style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 14, lineHeight: 1 }} onMouseOver={ev => (ev.currentTarget.style.color = '#ef4444')} onMouseOut={ev => (ev.currentTarget.style.color = '#d1d5db')}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Right: live output preview */}
            {!showColors && (
              <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
                <div style={{ padding: '10px 14px', background: '#f8f7ff', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: purpleD, flex: 1 }}>Live Preview</div>
                  <button onClick={copyOutput} style={{ background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: copied ? '#065f46' : '#fff', border: 'none', borderRadius: 7, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {copied ? '✓ Copied!' : 'Copy TSV'}
                  </button>
                </div>

                {/* Table header */}
                <div style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 120px 50px 60px', padding: '6px 14px', background: '#fafafa', borderBottom: `1px solid ${border}`, gap: 8 }}>
                  {['Vendor', 'Style Code', 'Style Name', 'Color', 'Qty', 'Price'].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                  ))}
                </div>

                <div style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
                  {outRows.map((r, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 120px 50px 60px', padding: '5px 14px', borderBottom: i < outRows.length - 1 ? `1px solid #f9f9f9` : 'none', background: i % 2 === 0 ? '#fff' : '#fafbff', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: r.isFirstForVendor && r.vendorId ? purpleD : 'transparent' }}>{r.isFirstForVendor ? r.vendorId : ''}</div>
                      <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: purpleD, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 4, padding: '2px 6px', display: 'inline-block' }}>{r.styleCode}</div>
                      <div style={{ fontSize: 11, color: '#374151' }}>{r.styleName}</div>
                      <div style={{ fontSize: 11, color: '#374151' }}>{r.color}</div>
                      <div style={{ fontSize: 11, color: '#374151' }}>{r.qty}</div>
                      <div style={{ fontSize: 11, color: '#374151' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

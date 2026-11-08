'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { User } from '@/lib/types'

const purpleD = '#5b21b6'
const purple = '#7c3aed'
const gray = '#6b7280'
const border = '#e5e7eb'

const LS_ABBREV_KEY  = 'hairAcc_abbrevMap'
const LS_COLORS_KEY  = 'hairAcc_colorList'   // global color list
const LS_COLMAP_KEY  = 'hairAcc_colMapping'

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
  const steps = ['Paste', 'Endings', 'Colors & Qty', 'Output']
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
  const [abbrevMap, setAbbrevMap] = useState<Record<string, string>>({})
  const [colorList, setColorList] = useState<ColorEntry[]>([{ code: '', name: '', qty: '' }])
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    setAbbrevMap(loadSaved(LS_ABBREV_KEY, {}))
    setColorList(loadSaved(LS_COLORS_KEY, [{ code: '', name: '', qty: '' }]))
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

  // Build output — only active styles, colors from global list
  interface OutRow { vendorId: string; styleCode: string; styleName: string; color: string; qty: string; price: number; isFirstForVendor: boolean }

  const outRows = useMemo((): OutRow[] => {
    const out: OutRow[] = []
    let lastVendor = ''
    const activeColors = colorList.filter(c => c.code.trim() || c.name.trim())

    for (const r of parsedRows) {
      if (!activeStyles.includes(r.style)) continue  // skip X'd styles
      const ending = abbrevMap[r.style]?.trim() ?? ''
      const styleCode = ending
        ? (r.vendorId ? `${r.vendorId}${ending}` : ending)
        : (r.vendorId || r.style.slice(0, 8).replace(/\s+/g, '').toUpperCase())
      const isFirstForVendor = r.vendorId !== lastVendor
      if (r.vendorId) lastVendor = r.vendorId

      if (activeColors.length === 0) {
        out.push({ vendorId: r.vendorId, styleCode, styleName: r.style, color: '', qty: '', price: r.price, isFirstForVendor })
      } else {
        activeColors.forEach((c, ci) => {
          const colorStr = c.code.trim() && c.name.trim()
            ? `#${c.code.trim()} ${c.name.trim()}`
            : c.name.trim() || `#${c.code.trim()}`
          out.push({ vendorId: r.vendorId, styleCode, styleName: r.style, color: colorStr, qty: c.qty.trim(), price: r.price, isFirstForVendor: ci === 0 && isFirstForVendor })
        })
      }
    }
    return out
  }, [parsedRows, activeStyles, abbrevMap, colorList])

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

        {/* ── STEP 1: Endings ─────────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            {/* Left: endings input */}
            <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, padding: 20, boxShadow: '0 2px 12px rgba(124,58,237,0.07)', position: 'sticky', top: 70 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 4 }}>Set style code endings</div>
              <div style={{ fontSize: 12, color: gray, marginBottom: 4 }}>
                Code = VendorID + ending &nbsp;·&nbsp; e.g. <code>MD27001</code> + <code>HC</code> → <code>MD27001HC</code>
              </div>
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 16, fontWeight: 600 }}>
                Type <code style={{ background: '#fef2f2', padding: '1px 5px', borderRadius: 4 }}>X</code> to hide a style (not carried).
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '0 12px', alignItems: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6, borderBottom: `1px solid #f0f0f0` }}>Style Name</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6, borderBottom: `1px solid #f0f0f0` }}>Ending</div>

                {uniqueStyles.map(s => {
                  const ending = abbrevMap[s] ?? ''
                  const isX = ending.trim().toUpperCase() === 'X'
                  return (
                    <>
                      <div key={s + '_l'} style={{ fontSize: 12, color: isX ? '#9ca3af' : '#374151', padding: '6px 0', borderBottom: `1px solid #f9f9f9`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isX ? 'line-through' : 'none' }} title={s}>{s}</div>
                      <div key={s + '_i'} style={{ padding: '4px 0', borderBottom: `1px solid #f9f9f9` }}>
                        <input
                          value={ending}
                          onChange={e => {
                            const val = e.target.value.toUpperCase()
                            const updated = { ...abbrevMap, [s]: val }
                            setAbbrevMap(updated)
                            saveTo(LS_ABBREV_KEY, updated)
                          }}
                          placeholder="e.g. HC"
                          style={{ ...inp, width: '100%', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, background: isX ? '#fef2f2' : '#fff', color: isX ? '#dc2626' : '#111', borderColor: isX ? '#fca5a5' : border }}
                          onFocus={e => { if (!isX) e.target.style.borderColor = purple }}
                          onBlur={e => { e.target.style.borderColor = isX ? '#fca5a5' : border }}
                        />
                      </div>
                    </>
                  )
                })}
              </div>

              <button onClick={() => { saveTo(LS_ABBREV_KEY, abbrevMap); setStep(2) }} style={{ marginTop: 20, background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }}>
                Next: Colors & Qty →
              </button>
            </div>

            {/* Right: live preview */}
            <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
              <div style={{ padding: '10px 14px', background: '#f8f7ff', borderBottom: `1px solid ${border}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: purpleD }}>Live Preview</div>
                <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>{activeStyles.length} active · {uniqueStyles.length - activeStyles.length} hidden</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 60px', padding: '6px 14px', background: '#fafafa', borderBottom: `1px solid ${border}`, gap: 8 }}>
                {['Vendor', 'Style Code', 'Style Name', 'Price'].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                ))}
              </div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {parsedRows
                  .filter(r => activeStyles.includes(r.style))
                  .map((r, i) => {
                    const ending = abbrevMap[r.style]?.trim() ?? ''
                    const styleCode = ending
                      ? (r.vendorId ? `${r.vendorId}${ending}` : ending)
                      : (r.vendorId || r.style.slice(0, 8).replace(/\s+/g, '').toUpperCase())
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 60px', padding: '5px 14px', borderBottom: `1px solid #f9f9f9`, background: i % 2 === 0 ? '#fff' : '#fafbff', gap: 8, alignItems: 'center' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>{r.vendorId}</div>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: purpleD, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 4, padding: '2px 6px' }}>{styleCode}</div>
                        <div style={{ fontSize: 11, color: '#374151' }}>{r.style}</div>
                        <div style={{ fontSize: 11, color: '#374151' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : ''}</div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Colors & Qty (global list) ──────────────────────── */}
        {step === 2 && (
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, padding: 20, boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 4 }}>Colors & Qty</div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 18 }}>
              This color list applies to <strong>all</strong> styles. Enter as <code style={{ background: '#f5f3ff', padding: '1px 5px', borderRadius: 4 }}>code name</code> (e.g. <code>001 Black</code>) — shows as <strong>#001 Black</strong>. Saved for next time.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 28px', gap: 8, marginBottom: 8, maxWidth: 500 }}>
              {['Code', 'Color Name', 'Qty', ''].map(h => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
              ))}
            </div>

            {colorList.map((e, ei) => (
              <div key={ei} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 28px', gap: 8, marginBottom: 8, alignItems: 'center', maxWidth: 500 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#9ca3af', fontSize: 13, fontWeight: 700 }}>#</span>
                  <input value={e.code} onChange={ev => { const u = [...colorList]; u[ei] = { ...e, code: ev.target.value }; setColorList(u); saveTo(LS_COLORS_KEY, u) }} placeholder="001" style={{ ...inp, fontFamily: 'monospace', fontSize: 12, width: '100%' }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                </div>
                <input value={e.name} onChange={ev => { const u = [...colorList]; u[ei] = { ...e, name: ev.target.value }; setColorList(u); saveTo(LS_COLORS_KEY, u) }} placeholder="Black" style={{ ...inp, fontSize: 12 }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                <input value={e.qty} onChange={ev => { const u = [...colorList]; u[ei] = { ...e, qty: ev.target.value }; setColorList(u); saveTo(LS_COLORS_KEY, u) }} placeholder="12" style={{ ...inp, fontSize: 12 }} onFocus={ev => ev.target.style.borderColor = purple} onBlur={ev => ev.target.style.borderColor = border} />
                <button onClick={() => { const u = colorList.filter((_, i) => i !== ei); const final = u.length ? u : [{ code: '', name: '', qty: '' }]; setColorList(final); saveTo(LS_COLORS_KEY, final) }} style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 16, lineHeight: 1 }} onMouseOver={ev => (ev.currentTarget.style.color = '#ef4444')} onMouseOut={ev => (ev.currentTarget.style.color = '#d1d5db')}>×</button>
              </div>
            ))}

            <button onClick={() => { const u = [...colorList, { code: '', name: '', qty: '' }]; setColorList(u); saveTo(LS_COLORS_KEY, u) }} style={{ background: '#f0ebff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer', marginTop: 4 }}>
              + Add Color
            </button>

            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button onClick={() => { saveTo(LS_COLORS_KEY, colorList); setStep(3) }} style={{ background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }}>
                Next: See Output →
              </button>
              <button onClick={() => setStep(3)} style={{ background: '#f0ebff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer' }}>
                Skip (no colors)
              </button>
            </div>
          </div>
        )}

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

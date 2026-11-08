'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { User } from '@/lib/types'

const purpleD = '#5b21b6'
const purple = '#7c3aed'
const gray = '#6b7280'

const LS_ABBREV_KEY = 'hairAcc_abbrevMap'
const LS_COLORS_KEY = 'hairAcc_colorMap'
const LS_COLMAP_KEY = 'hairAcc_colMapping'

type ColRole = 'styleNum' | 'description' | 'price' | 'ignore'
interface ColMapping { [colIdx: number]: ColRole }

function loadSaved<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch { return fallback }
}
function saveTo(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ── Types ──────────────────────────────────────────────────────────────────
interface RawRow {
  vendorId: string
  style: string      // normalized style name from paste
  price: number
}

interface ColorEntry {
  code: string   // e.g. "001"
  name: string   // e.g. "Black"
  qty: string    // e.g. "12"
}

// ── Split paste into 2D grid ───────────────────────────────────────────────
function splitGrid(text: string): string[][] {
  return text.split('\n').map(l => l.split('\t').map(c => c.trim()))
}

function maxCols(grid: string[][]): number {
  return grid.reduce((m, r) => Math.max(m, r.length), 0)
}

// ── Guess initial column roles from grid ───────────────────────────────────
function guessColRoles(grid: string[][]): ColMapping {
  const n = maxCols(grid)
  const mapping: ColMapping = {}
  for (let i = 0; i < n; i++) {
    const vals = grid.map(r => r[i] ?? '').filter(Boolean)
    const numericCount = vals.filter(v => !isNaN(parseFloat(v))).length
    const shortNumeric = vals.filter(v => /^\d{3,10}$/.test(v)).length
    // Alphanumeric style IDs: mix of letters+digits, some cells blank (sub-items)
    const alphaNum = vals.filter(v => /^[A-Za-z]+\d/.test(v) || /^\d+[A-Za-z]/.test(v)).length
    const blankRatio = grid.map(r => r[i] ?? '').filter(c => !c).length / (grid.length || 1)
    if (shortNumeric > 0 || (alphaNum > 0 && blankRatio > 0.3)) mapping[i] = 'styleNum'
    else if (numericCount / (vals.length || 1) > 0.6) mapping[i] = 'price'
    else mapping[i] = 'description'
  }
  return mapping
}

// ── Parser — uses explicit ColMapping ─────────────────────────────────────
function parsePaste(text: string, mapping: ColMapping): RawRow[] {
  const grid = splitGrid(text)
  const rows: RawRow[] = []
  let currentVendorId = ''

  const styleNumCol   = Object.entries(mapping).find(([,v]) => v === 'styleNum')?.[0]
  const descCol       = Object.entries(mapping).find(([,v]) => v === 'description')?.[0]
  const priceCol      = Object.entries(mapping).find(([,v]) => v === 'price')?.[0]

  const snIdx  = styleNumCol  != null ? parseInt(styleNumCol)  : -1
  const dIdx   = descCol      != null ? parseInt(descCol)      : -1
  const pIdx   = priceCol     != null ? parseInt(priceCol)     : -1

  for (const cols of grid) {
    const styleNum  = snIdx  >= 0 ? (cols[snIdx]  ?? '').trim() : ''
    const desc      = dIdx   >= 0 ? (cols[dIdx]   ?? '').trim() : ''
    const priceStr  = pIdx   >= 0 ? (cols[pIdx]   ?? '').trim() : ''

    // Style # = any non-empty value in the styleNum column that isn't a plain decimal (e.g. MD27001, 27029)
    const looksLikePrice = /^\d+(\.\d+)?$/.test(styleNum) && parseFloat(styleNum) < 100
    const isStyleNum = !!styleNum && !looksLikePrice

    // Case 1: style # and description on the SAME row
    if (isStyleNum && desc) {
      currentVendorId = styleNum
      const price = parseFloat(priceStr)
      rows.push({ vendorId: currentVendorId, style: desc, price: isNaN(price) ? 0 : price })
      continue
    }

    // Case 2: style # alone on its own row (next rows carry descriptions)
    if (isStyleNum && !desc) {
      currentVendorId = styleNum
      continue
    }

    // Case 3: description row under a previously seen style #
    if (!desc) continue
    if (!currentVendorId) continue

    const price = parseFloat(priceStr)
    rows.push({
      vendorId: currentVendorId,
      style: desc,
      price: isNaN(price) ? 0 : price,
    })
  }

  return rows
}

// ── Step indicator ─────────────────────────────────────────────────────────
function Steps({ current }: { current: number }) {
  const steps = ['Paste', 'Columns', 'Endings', 'Colors & Qty', 'Output']
  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'center', marginBottom: 24 }}>
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 14px',
              borderRadius: 20,
              background: active ? purpleD : done ? '#d1fae5' : '#f3f4f6',
              color: active ? '#fff' : done ? '#065f46' : '#9ca3af',
              fontSize: 12, fontWeight: 700,
              transition: 'all 0.2s',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 900,
                background: active ? 'rgba(255,255,255,0.2)' : done ? '#6ee7b7' : '#e5e7eb',
                color: active ? '#fff' : done ? '#065f46' : '#9ca3af',
              }}>{done ? '✓' : i + 1}</span>
              {s}
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 24, height: 2, background: done ? '#6ee7b7' : '#e5e7eb' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function HairAccPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [step, setStep] = useState(0)
  const [parseError, setParseError] = useState('')

  // Step 0 — paste
  const [paste, setPaste] = useState('')
  const [previewGrid, setPreviewGrid] = useState<string[][]>([])

  // Step 1 — column mapping
  const [colMapping, setColMapping] = useState<ColMapping>({})

  // Step 2 — endings per unique style name
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [abbrevMap, setAbbrevMap] = useState<Record<string, string>>({})   // style → ending
  const [uniqueStyles, setUniqueStyles] = useState<string[]>([])

  // Step 3 — colors & qty per unique style name
  const [colorMap, setColorMap] = useState<Record<string, ColorEntry[]>>({})

  // Step 4 — output
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  // ── Step 0 → 1 ────────────────────────────────────────────────────────
  function handlePaste() {
    if (!paste.trim()) return
    const grid = splitGrid(paste)
    setPreviewGrid(grid)
    // Load saved mapping or guess
    const saved = loadSaved<ColMapping>(LS_COLMAP_KEY, {})
    const n = maxCols(grid)
    const hasSaved = Object.keys(saved).length > 0 && parseInt(Object.keys(saved).sort().pop()!) < n
    setColMapping(hasSaved ? saved : guessColRoles(grid))
    setStep(1)
  }

  // ── Step 1 → 2 ────────────────────────────────────────────────────────
  function handleColMapping() {
    saveTo(LS_COLMAP_KEY, colMapping)
    const rows = parsePaste(paste, colMapping)
    if (rows.length === 0) {
      // Show first few raw cells to help debug
      const grid2 = paste.split('\n').slice(0, 3).map(l => l.split('\t').map(c => c.trim()))
      const sample = grid2.map(r => r.join(' | ')).join(' /// ')
      setParseError(`No rows parsed. Sample data: "${sample.slice(0, 200)}". Make sure Style # column contains the vendor number and Description column contains the style name.`)
      return
    }
    setParseError('')
    setRawRows(rows)

    const styles = Array.from(new Set(rows.map(r => r.style)))
    setUniqueStyles(styles)

    const saved = loadSaved<Record<string, string>>(LS_ABBREV_KEY, {})
    const merged: Record<string, string> = {}
    for (const s of styles) merged[s] = saved[s] ?? ''
    setAbbrevMap(merged)

    const savedColors = loadSaved<Record<string, ColorEntry[]>>(LS_COLORS_KEY, {})
    const mergedColors: Record<string, ColorEntry[]> = {}
    for (const s of styles) mergedColors[s] = savedColors[s] ?? [{ code: '', name: '', qty: '' }]
    setColorMap(mergedColors)

    setStep(2)
  }

  // ── Step 2 → 3 ────────────────────────────────────────────────────────
  function handleSaveAbbrevs() {
    saveTo(LS_ABBREV_KEY, abbrevMap)
    setStep(3)
  }

  // ── Step 3 → 4 ────────────────────────────────────────────────────────
  function handleSaveColors() {
    saveTo(LS_COLORS_KEY, colorMap)
    setStep(4)
  }

  // ── Build output rows ──────────────────────────────────────────────────
  // For each raw row, expand by its colors.
  // Output columns: VendorID | Style Code | Style Name | Color | Qty | Price
  // VendorID only on first row of each vendor group (like original)
  interface OutRow {
    vendorId: string
    styleCode: string
    styleName: string
    color: string
    qty: string
    price: number
    isFirstForVendor: boolean
  }

  function buildOutput(): OutRow[] {
    const out: OutRow[] = []
    let lastVendor = ''

    for (const r of rawRows) {
      const ending = abbrevMap[r.style]?.trim() ?? ''
      const styleCode = ending ? `${r.vendorId}${ending}` : r.vendorId
      const colors = (colorMap[r.style] ?? []).filter(c => c.code.trim() || c.name.trim())

      const isFirstForVendor = r.vendorId !== lastVendor
      if (r.vendorId) lastVendor = r.vendorId

      if (colors.length === 0) {
        out.push({
          vendorId: r.vendorId,
          styleCode,
          styleName: r.style,
          color: '',
          qty: '',
          price: r.price,
          isFirstForVendor,
        })
      } else {
        colors.forEach((c, ci) => {
          const colorStr = c.code.trim() && c.name.trim()
            ? `#${c.code.trim()} ${c.name.trim()}`
            : c.name.trim() || `#${c.code.trim()}`
          out.push({
            vendorId: r.vendorId,
            styleCode,
            styleName: r.style,
            color: colorStr,
            qty: c.qty.trim(),
            price: r.price,
            isFirstForVendor: ci === 0 && isFirstForVendor,
          })
        })
      }
    }
    return out
  }

  function buildTSV(outRows: OutRow[]): string {
    // Mirror the original paste format: VendorID (only on first of group) | StyleCode | StyleName | Color | Qty | Price
    return outRows.map(r => [
      r.isFirstForVendor ? r.vendorId : '',
      r.styleCode,
      r.styleName,
      r.color,
      r.qty,
      r.price > 0 ? r.price.toFixed(2) : '',
    ].join('\t')).join('\n')
  }

  function copyOutput() {
    const rows = buildOutput()
    navigator.clipboard.writeText(buildTSV(rows))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!user) return null

  const outRows = step === 4 ? buildOutput() : []

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ff', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1.5px solid #e5e7eb',
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 1px 6px rgba(124,58,237,0.07)',
      }}>
        <button onClick={() => { if (step > 0) setStep(step - 1); else router.push('/selector') }} style={{
          background: '#f0ebff', border: 'none', borderRadius: 8,
          padding: '6px 12px', fontSize: 12, fontWeight: 700, color: purple, cursor: 'pointer',
        }}>← {step > 0 ? 'Back' : 'Menu'}</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: purpleD }}>Hair Accessories</div>
          <div style={{ fontSize: 11, color: gray, marginTop: 1 }}>Style code generator</div>
        </div>
        {step === 4 && (
          <button onClick={copyOutput} style={{
            background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`,
            color: copied ? '#065f46' : '#fff',
            border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            {copied ? '✓ Copied!' : 'Copy Table (TSV)'}
          </button>
        )}
        {step > 0 && (
          <button onClick={() => { setStep(0); setPaste(''); setRawRows([]) }} style={{
            background: '#fee2e2', border: 'none', borderRadius: 8,
            padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#dc2626', cursor: 'pointer',
          }}>Reset</button>
        )}
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
        <Steps current={step} />

        {/* ── STEP 0: Paste ────────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{
            background: '#fff', border: '1.5px solid #e5e7eb',
            borderRadius: 14, padding: 24,
            boxShadow: '0 2px 12px rgba(124,58,237,0.07)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 6 }}>Paste vendor data</div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 16, lineHeight: 1.6 }}>
              Copy from Excel or a text file. Format: <code style={{ background: '#f5f3ff', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>VendorID &nbsp; Style Name &nbsp; Price</code>
              &nbsp;— rows without a vendor ID inherit the last one above them.
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              autoFocus
              placeholder="Paste tab-separated data here…"
              style={{
                width: '100%', height: 280, fontFamily: 'monospace', fontSize: 12,
                border: '1.5px solid #d4c8f0', borderRadius: 8, padding: 12,
                resize: 'vertical', outline: 'none', color: '#374151', lineHeight: 1.6,
              }}
            />
            <button
              onClick={handlePaste}
              disabled={!paste.trim()}
              style={{
                marginTop: 14,
                background: paste.trim() ? `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)` : '#e5e7eb',
                color: paste.trim() ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: 8, padding: '10px 24px',
                fontSize: 13, fontWeight: 700,
                cursor: paste.trim() ? 'pointer' : 'not-allowed',
                boxShadow: paste.trim() ? '0 2px 10px rgba(124,58,237,0.3)' : 'none',
              }}
            >Next: Map Columns →</button>
          </div>
        )}

        {/* ── STEP 1: Column mapping ───────────────────────────────────── */}
        {step === 1 && (() => {
          const grid = previewGrid
          const numCols = maxCols(grid)
          const previewRows = grid.filter(r => r.some(c => c)).slice(0, 8)
          const roleLabels: Record<ColRole, string> = {
            styleNum: 'Style #',
            description: 'Description',
            price: 'Price',
            ignore: 'Ignore',
          }
          const roleColors: Record<ColRole, { bg: string; color: string }> = {
            styleNum:    { bg: '#ede9fe', color: purpleD },
            description: { bg: '#dbeafe', color: '#1e40af' },
            price:       { bg: '#d1fae5', color: '#065f46' },
            ignore:      { bg: '#f3f4f6', color: '#9ca3af' },
          }
          return (
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: 14, padding: 20,
              boxShadow: '0 2px 12px rgba(124,58,237,0.07)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 4 }}>Which column is which?</div>
              <div style={{ fontSize: 12, color: gray, marginBottom: 18 }}>
                Tag each column so the parser knows what's the style number, what's the description, and what's the price.
              </div>

              {/* Column role pickers */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                {Array.from({ length: numCols }, (_, i) => {
                  const role = colMapping[i] ?? 'ignore'
                  const { bg, color } = roleColors[role]
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Col {i + 1}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(['styleNum', 'description', 'price', 'ignore'] as ColRole[]).map(r => (
                          <button key={r} onClick={() => setColMapping(prev => ({ ...prev, [i]: r }))}
                            style={{
                              background: role === r ? bg : '#f9fafb',
                              color: role === r ? color : '#9ca3af',
                              border: `1.5px solid ${role === r ? (roleColors[r].bg) : '#e5e7eb'}`,
                              borderRadius: 6, padding: '4px 10px',
                              fontSize: 11, fontWeight: role === r ? 700 : 500,
                              cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >{roleLabels[r]}</button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Preview table */}
              <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                  <thead>
                    <tr>
                      {Array.from({ length: numCols }, (_, i) => {
                        const role = colMapping[i] ?? 'ignore'
                        const { bg, color } = roleColors[role]
                        return (
                          <th key={i} style={{
                            background: bg, color, padding: '5px 10px',
                            border: '1px solid #e5e7eb', fontWeight: 700,
                            fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
                          }}>{roleLabels[role]}</th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafbff' }}>
                        {Array.from({ length: numCols }, (_, ci) => (
                          <td key={ci} style={{
                            padding: '5px 10px', border: '1px solid #f0f0f0',
                            color: '#374151', maxWidth: 180,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{row[ci] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button onClick={handleColMapping} style={{
                background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`,
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
              }}>Next: Set Endings →</button>
              {parseError && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                  ⚠️ {parseError}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── STEP 2: Endings ──────────────────────────────────────────── */}
        {step === 2 && (
          <div>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: 14, padding: 20, marginBottom: 16,
              boxShadow: '0 2px 12px rgba(124,58,237,0.07)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 4 }}>Set style code endings</div>
              <div style={{ fontSize: 12, color: gray, marginBottom: 18 }}>
                Enter the suffix for each style. The code will be <strong>VendorID + ending</strong> (e.g. vendor <code>27029</code> + ending <code>LC</code> → <code>27029LC</code>). These are saved for next time.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0px 16px', alignItems: 'center' }}>
                {/* header */}
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', paddingBottom: 6, borderBottom: '1px solid #f0f0f0' }}>Style Name</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', paddingBottom: 6, borderBottom: '1px solid #f0f0f0', minWidth: 120 }}>Ending</div>

                {uniqueStyles.map(s => (
                  <>
                    <div key={s + '_label'} style={{ fontSize: 13, color: '#374151', padding: '7px 0', borderBottom: '1px solid #f9f9f9' }}>{s}</div>
                    <div key={s + '_input'} style={{ padding: '5px 0', borderBottom: '1px solid #f9f9f9' }}>
                      <input
                        value={abbrevMap[s] ?? ''}
                        onChange={e => setAbbrevMap(prev => ({ ...prev, [s]: e.target.value.toUpperCase() }))}
                        placeholder="e.g. LC"
                        style={{
                          width: 120, fontFamily: 'monospace', fontWeight: 700,
                          fontSize: 13, padding: '4px 8px',
                          border: '1.5px solid #d4c8f0', borderRadius: 6, outline: 'none',
                        }}
                        onFocus={e => e.target.style.borderColor = purple}
                        onBlur={e => e.target.style.borderColor = '#d4c8f0'}
                      />
                    </div>
                  </>
                ))}
              </div>

              <button onClick={handleSaveAbbrevs} style={{
                marginTop: 20,
                background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`,
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
              }}>Next: Colors & Qty →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Colors & Qty ─────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 14 }}>
              Enter colors as <strong>code name</strong> (e.g. <code>001 Black</code>) — the table will show <strong>#001 Black</strong>. Leave blank to skip. Qty is optional.
            </div>
            {uniqueStyles.map(s => {
              const entries = colorMap[s] ?? [{ code: '', name: '', qty: '' }]
              return (
                <div key={s} style={{
                  background: '#fff', border: '1.5px solid #e5e7eb',
                  borderRadius: 12, marginBottom: 12, overflow: 'hidden',
                  boxShadow: '0 1px 6px rgba(124,58,237,0.05)',
                }}>
                  {/* Style header */}
                  <div style={{
                    background: 'linear-gradient(90deg, #f5f3ff 0%, #fff 100%)',
                    borderBottom: '1px solid #e5e7eb',
                    padding: '8px 14px',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      background: purpleD, color: '#fff',
                      borderRadius: 6, padding: '2px 10px',
                      fontSize: 12, fontWeight: 800,
                    }}>
                      {abbrevMap[s] ? `${rawRows.find(r => r.style === s)?.vendorId ?? '?'}${abbrevMap[s]}` : s.slice(0, 12)}
                    </span>
                    <span style={{ fontSize: 13, color: '#374151' }}>{s}</span>
                    <button onClick={() => {
                      setColorMap(prev => ({
                        ...prev,
                        [s]: [...(prev[s] ?? []), { code: '', name: '', qty: '' }]
                      }))
                    }} style={{
                      marginLeft: 'auto',
                      background: '#f0ebff', border: 'none', borderRadius: 6,
                      padding: '3px 10px', fontSize: 11, fontWeight: 700,
                      color: purple, cursor: 'pointer',
                    }}>+ Color</button>
                  </div>

                  {/* Color rows */}
                  <div style={{ padding: '8px 14px' }}>
                    {/* Column headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 28px', gap: 8, marginBottom: 6 }}>
                      {['Code', 'Color Name', 'Qty', ''].map(h => (
                        <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                      ))}
                    </div>
                    {entries.map((e, ei) => (
                      <div key={ei} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 28px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: '#9ca3af', fontSize: 13, fontWeight: 700 }}>#</span>
                          <input
                            value={e.code}
                            onChange={ev => {
                              const updated = [...entries]; updated[ei] = { ...e, code: ev.target.value }
                              setColorMap(prev => ({ ...prev, [s]: updated }))
                            }}
                            placeholder="001"
                            style={{ fontFamily: 'monospace', fontSize: 13, padding: '4px 6px', border: '1.5px solid #e5e7eb', borderRadius: 6, outline: 'none', width: '100%' }}
                            onFocus={ev => ev.target.style.borderColor = purple}
                            onBlur={ev => ev.target.style.borderColor = '#e5e7eb'}
                          />
                        </div>
                        <input
                          value={e.name}
                          onChange={ev => {
                            const updated = [...entries]; updated[ei] = { ...e, name: ev.target.value }
                            setColorMap(prev => ({ ...prev, [s]: updated }))
                          }}
                          placeholder="Black"
                          style={{ fontSize: 13, padding: '4px 8px', border: '1.5px solid #e5e7eb', borderRadius: 6, outline: 'none' }}
                          onFocus={ev => ev.target.style.borderColor = purple}
                          onBlur={ev => ev.target.style.borderColor = '#e5e7eb'}
                        />
                        <input
                          value={e.qty}
                          onChange={ev => {
                            const updated = [...entries]; updated[ei] = { ...e, qty: ev.target.value }
                            setColorMap(prev => ({ ...prev, [s]: updated }))
                          }}
                          placeholder="12"
                          style={{ fontSize: 13, padding: '4px 8px', border: '1.5px solid #e5e7eb', borderRadius: 6, outline: 'none' }}
                          onFocus={ev => ev.target.style.borderColor = purple}
                          onBlur={ev => ev.target.style.borderColor = '#e5e7eb'}
                        />
                        <button onClick={() => {
                          const updated = entries.filter((_, i) => i !== ei)
                          setColorMap(prev => ({ ...prev, [s]: updated.length ? updated : [{ code: '', name: '', qty: '' }] }))
                        }} style={{
                          background: 'none', border: 'none', color: '#d1d5db',
                          cursor: 'pointer', fontSize: 16, lineHeight: 1,
                        }}
                          onMouseOver={ev => (ev.currentTarget.style.color = '#ef4444')}
                          onMouseOut={ev => (ev.currentTarget.style.color = '#d1d5db')}
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            <button onClick={handleSaveColors} style={{
              marginTop: 8,
              background: `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`,
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
            }}>Next: See Output →</button>
          </div>
        )}

        {/* ── STEP 4: Output ───────────────────────────────────────────── */}
        {step === 4 && (
          <div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 14 }}>
              Table is formatted like your original paste — copy it and paste straight into your sheet.
            </div>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: 12, overflow: 'hidden',
              boxShadow: '0 1px 6px rgba(124,58,237,0.05)',
            }}>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '90px 110px 1fr 130px 60px 70px',
                padding: '7px 14px',
                background: '#fafafa',
                borderBottom: '1px solid #e5e7eb',
                gap: 8,
              }}>
                {['Vendor', 'Style Code', 'Style Name', 'Color', 'Qty', 'Price'].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
                ))}
              </div>

              {outRows.map((r, i) => (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 110px 1fr 130px 60px 70px',
                  padding: '5px 14px',
                  borderBottom: i < outRows.length - 1 ? '1px solid #f9f9f9' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafbff',
                  gap: 8,
                  alignItems: 'center',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: r.isFirstForVendor ? purpleD : 'transparent' }}>
                    {r.isFirstForVendor ? r.vendorId : ''}
                  </div>
                  <div style={{
                    fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
                    color: purpleD, background: '#f5f3ff',
                    border: '1px solid #ddd6fe', borderRadius: 5,
                    padding: '2px 7px', display: 'inline-block',
                  }}>{r.styleCode}</div>
                  <div style={{ fontSize: 12, color: '#374151' }}>{r.styleName}</div>
                  <div style={{ fontSize: 12, color: '#374151' }}>{r.color}</div>
                  <div style={{ fontSize: 12, color: '#374151' }}>{r.qty}</div>
                  <div style={{ fontSize: 12, color: '#374151' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : ''}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button onClick={copyOutput} style={{
                background: copied ? '#d1fae5' : `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)`,
                color: copied ? '#065f46' : '#fff',
                border: 'none', borderRadius: 8, padding: '10px 24px',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                boxShadow: copied ? 'none' : '0 2px 10px rgba(124,58,237,0.3)',
              }}>
                {copied ? '✓ Copied to clipboard!' : 'Copy Table (TSV)'}
              </button>
              <button onClick={() => setStep(3)} style={{
                background: '#f0ebff', border: 'none', borderRadius: 8,
                padding: '10px 16px', fontSize: 12, fontWeight: 700,
                color: purple, cursor: 'pointer',
              }}>← Edit Colors</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

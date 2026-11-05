'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { User } from '@/lib/types'

const purpleD = '#5b21b6'
const purple = '#7c3aed'
const gray = '#6b7280'

// Style abbreviation map — normalized lowercase key → abbreviation
const STYLE_ABBREV: Record<string, string> = {
  'large clip':           'LC',
  'medium clip':          'MC',
  'meduim clip':          'MC',   // typo variant in source data
  'mini clip':            'MNC',
  'padded headband':      'PHB',
  'pleated headband':     'PLHB',
  'flat headband':        'FHB',
  'bow headband':         'BWHB',
  'elastic band':         'EB',
  'scruchy':              'SC',
  'scruchy with tail':    'SCT',
  'scrychy with bow':     'SCWB',  // typo variant
  'scruchy with bow':     'SCWB',
  'square scruchy':       'SQSC',
  'pony':                 'PY',
  'babyband':             'BB',
  'baby band with bow':   'BBWB',
  'snap clip':            'SNC',
  'kechif band':          'KCB',
  'pacifer':              'PAC',
  'pacifier':             'PAC',
  'sweetband':            'SWB',
  'beanies':              'BNS',
  'headband':             'HB',
  'wrapped headband':     'WHB',
}

function getAbbrev(style: string): string {
  const key = style.trim().toLowerCase()
  return STYLE_ABBREV[key] ?? style.trim().toUpperCase().replace(/\s+/g, '').slice(0, 4)
}

interface StyleRow {
  vendorId: string
  style: string
  price: number
  styleCode: string
}

function parsePaste(text: string): StyleRow[] {
  const lines = text.split('\n').map(l => l.split('\t'))
  const rows: StyleRow[] = []
  let currentVendor = ''

  for (const cols of lines) {
    // Trim all cells
    const c0 = (cols[0] ?? '').trim()
    const c1 = (cols[1] ?? '').trim()
    const c2 = (cols[2] ?? '').trim()

    // Figure out which column is vendor, which is style, which is price
    // Format: vendorId | style | price  OR  (empty) | style | price
    let vendorCell = c0
    let styleCell = c1
    let priceCell = c2

    // If only 2 non-empty cols and first is a number that looks like a vendor id
    // vs a price — vendor IDs are 5-digit numbers
    if (c0 && /^\d{5,}$/.test(c0)) {
      currentVendor = c0
      // style is c1, price is c2
    } else if (c0 === '' && c1 !== '') {
      // continuation row — vendor stays from above
      styleCell = c1
      priceCell = c2
    } else if (c0 !== '' && c1 !== '') {
      // might be style in c0 and price in c1 (2-col paste)
      // check if c0 looks like a vendor id
      if (/^\d{5,}$/.test(c0)) {
        currentVendor = c0
        styleCell = c1
        priceCell = c2
      } else {
        styleCell = c0
        priceCell = c1
      }
    } else {
      continue
    }

    if (!styleCell || !currentVendor) continue
    const price = parseFloat(priceCell)
    if (isNaN(price) && priceCell !== '') continue // skip non-numeric price rows unless blank
    if (!styleCell) continue

    const abbrev = getAbbrev(styleCell)
    rows.push({
      vendorId: currentVendor,
      style: styleCell,
      price: isNaN(price) ? 0 : price,
      styleCode: `${currentVendor}${abbrev}`,
    })
  }

  return rows
}

export default function HairAccPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [paste, setPaste] = useState('')
  const [rows, setRows] = useState<StyleRow[]>([])
  const [parsed, setParsed] = useState(false)
  const [editingCell, setEditingCell] = useState<{ row: number; col: 'style' | 'price' | 'styleCode' } | null>(null)
  const [editVal, setEditVal] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  function handleParse() {
    const result = parsePaste(paste)
    setRows(result)
    setParsed(true)
  }

  function handleReset() {
    setPaste('')
    setRows([])
    setParsed(false)
    setEditingCell(null)
  }

  function startEdit(rowIdx: number, col: 'style' | 'price' | 'styleCode', val: string) {
    setEditingCell({ row: rowIdx, col })
    setEditVal(val)
  }

  function commitEdit() {
    if (!editingCell) return
    setRows(prev => prev.map((r, i) => {
      if (i !== editingCell.row) return r
      const updated = { ...r }
      if (editingCell.col === 'style') {
        updated.style = editVal
        // Re-derive styleCode if it still matched the auto pattern
        const autoCode = `${r.vendorId}${getAbbrev(r.style)}`
        if (r.styleCode === autoCode) {
          updated.styleCode = `${r.vendorId}${getAbbrev(editVal)}`
        }
      } else if (editingCell.col === 'price') {
        updated.price = parseFloat(editVal) || 0
      } else if (editingCell.col === 'styleCode') {
        updated.styleCode = editVal.trim().toUpperCase()
      }
      return updated
    }))
    setEditingCell(null)
  }

  function deleteRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  function addRow(afterIdx: number) {
    const ref = rows[afterIdx]
    const newRow: StyleRow = {
      vendorId: ref?.vendorId ?? '',
      style: '',
      price: 0,
      styleCode: '',
    }
    setRows(prev => [...prev.slice(0, afterIdx + 1), newRow, ...prev.slice(afterIdx + 1)])
    // Start editing the style cell of the new row
    setTimeout(() => setEditingCell({ row: afterIdx + 1, col: 'style' }), 50)
  }

  function copyStyleCodes() {
    const codes = Array.from(new Set(rows.map(r => r.styleCode).filter(Boolean))).join('\n')
    navigator.clipboard.writeText(codes)
    setCopied('codes')
    setTimeout(() => setCopied(null), 2000)
  }

  function copyAll() {
    const tsv = rows.map(r => `${r.styleCode}\t${r.style}\t${r.vendorId}\t${r.price}`).join('\n')
    navigator.clipboard.writeText(tsv)
    setCopied('all')
    setTimeout(() => setCopied(null), 2000)
  }

  if (!user) return null

  // Group rows by vendor for display
  const byVendor = new Map<string, StyleRow[]>()
  for (const r of rows) {
    if (!byVendor.has(r.vendorId)) byVendor.set(r.vendorId, [])
    byVendor.get(r.vendorId)!.push(r)
  }
  const vendors = Array.from(byVendor.keys())

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ff', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{
        background: '#fff',
        borderBottom: '1.5px solid #e5e7eb',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 1px 6px rgba(124,58,237,0.07)',
      }}>
        <button onClick={() => router.push('/selector')} style={{
          background: '#f0ebff', border: 'none', borderRadius: 8,
          padding: '6px 12px', fontSize: 12, fontWeight: 700,
          color: purple, cursor: 'pointer',
        }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: purpleD, letterSpacing: '0.03em' }}>Hair Accessories</div>
          <div style={{ fontSize: 11, color: gray, marginTop: 1 }}>Style code generator</div>
        </div>
        {parsed && rows.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={copyStyleCodes} style={{
              background: copied === 'codes' ? '#d1fae5' : '#f0ebff',
              border: 'none', borderRadius: 8, padding: '6px 12px',
              fontSize: 12, fontWeight: 700,
              color: copied === 'codes' ? '#065f46' : purple,
              cursor: 'pointer',
            }}>{copied === 'codes' ? '✓ Copied' : 'Copy Codes'}</button>
            <button onClick={copyAll} style={{
              background: copied === 'all' ? '#d1fae5' : '#ede9fe',
              border: 'none', borderRadius: 8, padding: '6px 12px',
              fontSize: 12, fontWeight: 700,
              color: copied === 'all' ? '#065f46' : purpleD,
              cursor: 'pointer',
            }}>{copied === 'all' ? '✓ Copied' : 'Copy All (TSV)'}</button>
            <button onClick={handleReset} style={{
              background: '#fee2e2', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 12, fontWeight: 700,
              color: '#dc2626', cursor: 'pointer',
            }}>Reset</button>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>

        {!parsed ? (
          /* Paste panel */
          <div style={{
            background: '#fff',
            border: '1.5px solid #e5e7eb',
            borderRadius: 14,
            padding: 24,
            boxShadow: '0 2px 12px rgba(124,58,237,0.07)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 6 }}>
              Paste vendor data
            </div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 16, lineHeight: 1.6 }}>
              Copy from Excel or a text file. Expected format: <br />
              <code style={{ background: '#f5f3ff', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>
                VendorID &nbsp; Style Name &nbsp; Price
              </code>
              &nbsp; — rows without a vendor ID inherit the last one above them.
            </div>
            <textarea
              ref={textRef}
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="Paste tab-separated data here…"
              style={{
                width: '100%',
                height: 300,
                fontFamily: 'monospace',
                fontSize: 12,
                border: '1.5px solid #d4c8f0',
                borderRadius: 8,
                padding: 12,
                resize: 'vertical',
                outline: 'none',
                color: '#374151',
                lineHeight: 1.6,
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={handleParse}
                disabled={!paste.trim()}
                style={{
                  background: paste.trim() ? `linear-gradient(135deg, ${purple} 0%, #6d28d9 100%)` : '#e5e7eb',
                  color: paste.trim() ? '#fff' : '#9ca3af',
                  border: 'none', borderRadius: 8,
                  padding: '10px 24px', fontSize: 13, fontWeight: 700,
                  cursor: paste.trim() ? 'pointer' : 'not-allowed',
                  boxShadow: paste.trim() ? '0 2px 10px rgba(124,58,237,0.3)' : 'none',
                }}
              >
                Generate Style Codes →
              </button>
              <button onClick={() => { setPaste(''); textRef.current?.focus() }} style={{
                background: '#f5f5f5', border: 'none', borderRadius: 8,
                padding: '10px 16px', fontSize: 12, fontWeight: 600,
                color: gray, cursor: 'pointer',
              }}>Clear</button>
            </div>
          </div>
        ) : (
          /* Results panel */
          <div>
            {/* Summary bar */}
            <div style={{
              background: '#fff',
              border: '1.5px solid #e5e7eb',
              borderRadius: 10,
              padding: '10px 16px',
              marginBottom: 16,
              display: 'flex',
              gap: 20,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 12, color: gray }}>
                <span style={{ fontWeight: 700, color: purpleD, fontSize: 14 }}>{rows.length}</span> styles
              </div>
              <div style={{ fontSize: 12, color: gray }}>
                <span style={{ fontWeight: 700, color: purpleD, fontSize: 14 }}>{vendors.length}</span> vendors
              </div>
              <div style={{ fontSize: 12, color: gray }}>
                <span style={{ fontWeight: 700, color: purpleD, fontSize: 14 }}>{Array.from(new Set(rows.map(r => r.styleCode))).length}</span> unique style codes
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
                Click any cell to edit · Double-click style code to override
              </div>
            </div>

            {/* Table per vendor */}
            {vendors.map(vid => {
              const vrows = byVendor.get(vid)!
              const globalBase = rows.indexOf(vrows[0])
              return (
                <div key={vid} style={{
                  background: '#fff',
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 12,
                  marginBottom: 14,
                  overflow: 'hidden',
                  boxShadow: '0 1px 6px rgba(124,58,237,0.05)',
                }}>
                  {/* Vendor header */}
                  <div style={{
                    background: 'linear-gradient(90deg, #f5f3ff 0%, #fff 100%)',
                    borderBottom: '1px solid #e5e7eb',
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <span style={{
                      background: purpleD, color: '#fff',
                      borderRadius: 6, padding: '2px 10px',
                      fontSize: 13, fontWeight: 800, letterSpacing: '0.04em',
                    }}>{vid}</span>
                    <span style={{ fontSize: 12, color: gray }}>{vrows.length} style{vrows.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => addRow(globalBase + vrows.length - 1)} style={{
                      marginLeft: 'auto',
                      background: '#f0ebff', border: 'none', borderRadius: 6,
                      padding: '3px 10px', fontSize: 11, fontWeight: 700,
                      color: purple, cursor: 'pointer',
                    }}>+ Add style</button>
                  </div>

                  {/* Column headers */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1.5fr 36px',
                    padding: '5px 14px',
                    background: '#fafafa',
                    borderBottom: '1px solid #f0f0f0',
                    gap: 8,
                  }}>
                    {['Style Name', 'Price', 'Style Code', ''].map(h => (
                      <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</div>
                    ))}
                  </div>

                  {/* Rows */}
                  {vrows.map((r, vi) => {
                    const gi = globalBase + vi
                    const isEditStyle = editingCell?.row === gi && editingCell.col === 'style'
                    const isEditPrice = editingCell?.row === gi && editingCell.col === 'price'
                    const isEditCode = editingCell?.row === gi && editingCell.col === 'styleCode'
                    return (
                      <div key={gi} style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1.5fr 36px',
                        padding: '5px 14px',
                        borderBottom: vi < vrows.length - 1 ? '1px solid #f9f9f9' : 'none',
                        alignItems: 'center',
                        gap: 8,
                        background: gi % 2 === 0 ? '#fff' : '#fafbff',
                      }}>

                        {/* Style name */}
                        {isEditStyle ? (
                          <input
                            autoFocus
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null) }}
                            style={{ fontSize: 13, padding: '3px 6px', border: '1.5px solid #7c3aed', borderRadius: 5, width: '100%' }}
                          />
                        ) : (
                          <div onClick={() => startEdit(gi, 'style', r.style)} style={{
                            fontSize: 13, color: '#374151', cursor: 'text',
                            padding: '3px 4px', borderRadius: 4,
                            border: '1.5px solid transparent',
                          }}
                            onMouseOver={e => (e.currentTarget.style.borderColor = '#d4c8f0')}
                            onMouseOut={e => (e.currentTarget.style.borderColor = 'transparent')}
                          >{r.style || <span style={{ color: '#ccc' }}>—</span>}</div>
                        )}

                        {/* Price */}
                        {isEditPrice ? (
                          <input
                            autoFocus
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null) }}
                            style={{ fontSize: 13, padding: '3px 6px', border: '1.5px solid #7c3aed', borderRadius: 5, width: '100%' }}
                          />
                        ) : (
                          <div onClick={() => startEdit(gi, 'price', String(r.price))} style={{
                            fontSize: 13, color: '#374151', cursor: 'text',
                            padding: '3px 4px', borderRadius: 4,
                            border: '1.5px solid transparent',
                          }}
                            onMouseOver={e => (e.currentTarget.style.borderColor = '#d4c8f0')}
                            onMouseOut={e => (e.currentTarget.style.borderColor = 'transparent')}
                          >${r.price.toFixed(2)}</div>
                        )}

                        {/* Style code */}
                        {isEditCode ? (
                          <input
                            autoFocus
                            value={editVal}
                            onChange={e => setEditVal(e.target.value.toUpperCase())}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null) }}
                            style={{ fontSize: 13, fontFamily: 'monospace', padding: '3px 6px', border: '1.5px solid #7c3aed', borderRadius: 5, width: '100%' }}
                          />
                        ) : (
                          <div
                            onDoubleClick={() => startEdit(gi, 'styleCode', r.styleCode)}
                            title="Double-click to override"
                            style={{
                              fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
                              color: purpleD, background: '#f5f3ff',
                              border: '1px solid #ddd6fe',
                              borderRadius: 5, padding: '2px 8px',
                              display: 'inline-block', cursor: 'default',
                            }}
                          >{r.styleCode || <span style={{ color: '#ccc', fontStyle: 'italic', fontWeight: 400 }}>no code</span>}</div>
                        )}

                        {/* Delete */}
                        <button onClick={() => deleteRow(gi)} style={{
                          background: 'none', border: 'none',
                          color: '#d1d5db', cursor: 'pointer',
                          fontSize: 15, lineHeight: 1,
                          borderRadius: 4, padding: '2px 4px',
                        }}
                          onMouseOver={e => (e.currentTarget.style.color = '#ef4444')}
                          onMouseOut={e => (e.currentTarget.style.color = '#d1d5db')}
                        >×</button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

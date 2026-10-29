'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { User } from '@/lib/types'

// ── Keyword rules for auto-filling Mg/Sg/Ssg ──────────────────────────────────
const DEFAULT_RULES = [
  { keyword: 'Cotton Tights', mg: 'Legwear',     sg: 'Hosiery',   ssg: 'Tights' },
  { keyword: 'Turtle Neck',   mg: 'Apparel',     sg: 'Tops',      ssg: 'Turtlenecks' },
  { keyword: 'Sweatshirt',    mg: 'Apparel',     sg: 'Tops',      ssg: 'Sweaters' },
  { keyword: 'Turtleneck',    mg: 'Apparel',     sg: 'Tops',      ssg: 'Turtlenecks' },
  { keyword: 'Pantyhose',     mg: 'Legwear',     sg: 'Hosiery',   ssg: 'Pantyhose' },
  { keyword: 'Knee High',     mg: 'Legwear',     sg: 'Socks',     ssg: 'Knee Socks' },
  { keyword: 'Underwear',     mg: 'Intimates',   sg: 'Underwear', ssg: '' },
  { keyword: 'Nightgown',     mg: 'Sleepwear',   sg: 'Nightgown', ssg: '' },
  { keyword: 'Cardigan',      mg: 'Apparel',     sg: 'Tops',      ssg: 'Cardigans' },
  { keyword: 'Mockneck',      mg: 'Apparel',     sg: 'Tops',      ssg: 'Mock Neck' },
  { keyword: 'T-Shirt',       mg: 'Apparel',     sg: 'Tops',      ssg: 'T-Shirts' },
  { keyword: 'Sweater',       mg: 'Apparel',     sg: 'Tops',      ssg: 'Sweaters' },
  { keyword: 'Bloomer',       mg: 'Apparel',     sg: 'Bottoms',   ssg: 'Bloomers' },
  { keyword: 'Blanket',       mg: 'Accessories', sg: 'Blankets',  ssg: '' },
  { keyword: 'Mittens',       mg: 'Accessories', sg: 'Mittens',   ssg: '' },
  { keyword: 'Swaddle',       mg: 'Accessories', sg: 'Swaddles',  ssg: '' },
  { keyword: 'Jacket',        mg: 'Outerwear',   sg: 'Jackets',   ssg: '' },
  { keyword: 'Leggin',        mg: 'Apparel',     sg: 'Bottoms',   ssg: 'Leggings' },
  { keyword: 'Romper',        mg: 'Apparel',     sg: 'Rompers',   ssg: '' },
  { keyword: 'Blouse',        mg: 'Apparel',     sg: 'Tops',      ssg: 'Blouses' },
  { keyword: 'Hoodie',        mg: 'Apparel',     sg: 'Tops',      ssg: 'Hoodies' },
  { keyword: 'Blazer',        mg: 'Outerwear',   sg: 'Blazers',   ssg: '' },
  { keyword: 'Pajama',        mg: 'Sleepwear',   sg: 'Pajamas',   ssg: '' },
  { keyword: 'Pyjama',        mg: 'Sleepwear',   sg: 'Pajamas',   ssg: '' },
  { keyword: 'Jumper',        mg: 'Apparel',     sg: 'Jumpers',   ssg: '' },
  { keyword: 'Footie',        mg: 'Apparel',     sg: 'Layette',   ssg: 'Footie' },
  { keyword: 'Onesie',        mg: 'Apparel',     sg: 'Tops',      ssg: 'Rompers' },
  { keyword: 'Anklet',        mg: 'Legwear',     sg: 'Socks',     ssg: 'Anklets' },
  { keyword: 'Tights',        mg: 'Legwear',     sg: 'Hosiery',   ssg: 'Tights' },
  { keyword: 'Beanie',        mg: 'Accessories', sg: 'Beanies',   ssg: '' },
  { keyword: 'Gloves',        mg: 'Accessories', sg: 'Gloves',    ssg: '' },
  { keyword: 'Shorts',        mg: 'Apparel',     sg: 'Bottoms',   ssg: 'Shorts' },
  { keyword: 'Skirt',         mg: 'Apparel',     sg: 'Bottoms',   ssg: 'Skirts' },
  { keyword: 'Shirt',         mg: 'Apparel',     sg: 'Tops',      ssg: 'Shirts' },
  { keyword: 'Ankle',         mg: 'Legwear',     sg: 'Socks',     ssg: 'Anklets' },
  { keyword: 'Dress',         mg: 'Apparel',     sg: 'Dresses',   ssg: '' },
  { keyword: 'Pant',          mg: 'Apparel',     sg: 'Bottoms',   ssg: 'Pants' },
  { keyword: 'Vest',          mg: 'Apparel',     sg: 'Tops',      ssg: 'Vest' },
  { keyword: 'Coat',          mg: 'Outerwear',   sg: 'Coats',     ssg: '' },
  { keyword: 'Sock',          mg: 'Legwear',     sg: 'Socks',     ssg: '' },
  { keyword: 'Polo',          mg: 'Apparel',     sg: 'Tops',      ssg: 'Polos' },
  { keyword: 'Knee',          mg: 'Legwear',     sg: 'Socks',     ssg: 'Knee Socks' },
  { keyword: 'Crew',          mg: 'Legwear',     sg: 'Socks',     ssg: 'Crews' },
  { keyword: 'Robe',          mg: 'Apparel',     sg: 'Robes',     ssg: '' },
  { keyword: 'Set',           mg: 'Apparel',     sg: 'Sets',      ssg: '' },
  { keyword: 'Tee',           mg: 'Apparel',     sg: 'Tops',      ssg: 'T-Shirts' },
  { keyword: 'Top',           mg: 'Apparel',     sg: 'Tops',      ssg: '' },
  { keyword: 'Bib',           mg: 'Accessories', sg: 'Bibs',      ssg: '' },
  { keyword: 'Hat',           mg: 'Accessories', sg: '-',         ssg: 'Hats' },
  { keyword: 'Pj',            mg: 'Sleepwear',   sg: 'Pajamas',   ssg: '' },
]

interface Rule { keyword: string; mg: string; sg: string; ssg: string }

interface EntryRow {
  upc: string; vendorid: string; brand: string; productid: string; pcode: string
  description: string; color: string; size: string; unitcost: string
}

interface ResultRow {
  Upc: string; Vendorid: string; Brand: string; Productid: string; Pcode: string
  Mg: string; Sg: string; Ssg: string; Iu1: string; Iu2: string; Iu3: string; Iu4: string
  Description: string; Color: string; Size: string; Saleprice: string; Unitcost: string
  Season: string; Taxrule: string; Website: string; Scale: string; Pu4: string
}

// ── helpers ──────────────────────────────────────────────────────────────────
function toTitleCase(s: string) { return s ? s.trim().replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()) : s }
function fmtColor(s: string) { return toTitleCase(s) }
function fmtSize(s: string) {
  const t = s.trim()
  if (!t) return t
  if (t.toUpperCase() === 'OS') return 'One Size'
  return t.length <= 4 ? t.toUpperCase() : toTitleCase(t)
}

function matchDesc(desc: string, rules: Rule[]) {
  const d = (desc || '').toLowerCase()
  for (const rule of rules) {
    if (rule.keyword && d.includes(rule.keyword.toLowerCase())) {
      return { mg: rule.mg, sg: rule.sg, ssg: rule.ssg }
    }
  }
  return { mg: '', sg: '', ssg: '' }
}

function applyMarkup(unitcost: string, formula: string): string {
  try {
    const uc = parseFloat(unitcost.replace(/[$,]/g, '')) || 0
    // Simple formula evaluation: support "unitcost * N" and "round(unitcost * N)"
    const expr = formula
      .replace(/round\((.+)\)/i, '$1')
      .replace(/unitcost/gi, String(uc))
    // eslint-disable-next-line no-eval
    const result = eval(expr) as number
    return isNaN(result) ? '' : result.toFixed(2)
  } catch { return '' }
}

function computeWebsite(storeTT: boolean, storeHP: boolean, storePO: boolean) {
  if (storeTT && storeHP) return '3'
  if (storePO) return '0'
  if (storeHP) return '2'
  return '1'
}

function expandRows(entry: EntryRow, season: string, iu: string, storeTT: boolean, storeHP: boolean, storePO: boolean, markup: string, usePu4: boolean, rules: Rule[]): ResultRow[] {
  const colors = entry.color.split(',').map(s => s.trim()).filter(Boolean) || ['']
  const sizes = entry.size.split(',').map(s => s.trim()).filter(Boolean) || ['']
  const iuParts = iu.split(',').map(s => s.trim()).filter(Boolean)
  const website = computeWebsite(storeTT, storeHP, storePO)
  const { mg, sg, ssg } = matchDesc(entry.description, rules)
  const saleprice = applyMarkup(entry.unitcost, markup)

  const out: ResultRow[] = []
  for (const color of (colors.length ? colors : [''])) {
    for (const size of (sizes.length ? sizes : [''])) {
      out.push({
        Upc: entry.upc,
        Vendorid: entry.vendorid.toUpperCase(),
        Brand: entry.brand,
        Productid: entry.productid,
        Pcode: entry.pcode || entry.productid,
        Mg: mg, Sg: sg, Ssg: ssg,
        Iu1: iuParts[0] || '', Iu2: iuParts[1] || '', Iu3: iuParts[2] || '', Iu4: iuParts[3] || '',
        Description: toTitleCase(entry.description),
        Color: fmtColor(color),
        Size: fmtSize(size),
        Saleprice: saleprice,
        Unitcost: entry.unitcost,
        Season: season,
        Taxrule: '1',
        Website: website,
        Scale: '',
        Pu4: usePu4 ? 'TTSplit' : '',
      })
    }
  }
  return out
}

const CSV_COLS: (keyof ResultRow)[] = [
  'Upc','Vendorid','Brand','Productid','Pcode',
  'Mg','Sg','Ssg','Iu1','Iu2','Iu3','Iu4',
  'Description','Color','Size','Saleprice','Unitcost',
  'Season','Taxrule','Website','Scale','Pu4',
]

const purple = '#7c3aed'
const purpleLight = '#f5f3ff'
const border = '#d4c8f0'

const emptyEntry: EntryRow = { upc:'', vendorid:'', brand:'', productid:'', pcode:'', description:'', color:'', size:'', unitcost:'' }

export default function AutoCSVPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [entry, setEntry] = useState<EntryRow>(emptyEntry)
  const [season, setSeason] = useState('SS26')
  const [iu, setIu] = useState('')
  const [markup, setMarkup] = useState('unitcost * 2')
  const [storeTT, setStoreTT] = useState(true)
  const [storeHP, setStoreHP] = useState(false)
  const [storePO, setStorePO] = useState(false)
  const [usePu4, setUsePu4] = useState(false)
  const [rows, setRows] = useState<ResultRow[]>([])
  const [rules] = useState<Rule[]>(DEFAULT_RULES)
  const [toast, setToast] = useState('')
  const [editIdx, setEditIdx] = useState<number | null>(null)

  // refs for enter-key navigation
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([])
  const FIELDS: (keyof EntryRow)[] = ['upc','vendorid','brand','productid','pcode','description','color','size','unitcost']

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function setField(k: keyof EntryRow, v: string) {
    setEntry(e => {
      const next = { ...e, [k]: v }
      // sync pcode ↔ productid if neither manually set
      if (k === 'productid' && !e.pcode) next.pcode = v
      if (k === 'pcode' && !e.productid) next.productid = v
      return next
    })
  }

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (idx < FIELDS.length - 1) {
        fieldRefs.current[idx + 1]?.focus()
      } else {
        addRow()
      }
    }
  }

  function addRow() {
    if (!entry.description.trim() && !entry.upc.trim()) {
      showToast('⚠️ Description or UPC is required')
      return
    }
    const newRows = expandRows(entry, season, iu, storeTT, storeHP, storePO, markup, usePu4, rules)
    if (editIdx !== null) {
      // replace the block for this edit
      setRows(prev => {
        const next = [...prev]
        next.splice(editIdx, 1, ...newRows)
        return next
      })
      setEditIdx(null)
      showToast(`✅ Updated ${newRows.length} row${newRows.length !== 1 ? 's' : ''}`)
    } else {
      setRows(prev => [...prev, ...newRows])
      showToast(`✅ Added ${newRows.length} row${newRows.length !== 1 ? 's' : ''}`)
    }
    setEntry(emptyEntry)
    fieldRefs.current[0]?.focus()
  }

  function editRow(idx: number) {
    const r = rows[idx]
    setEntry({
      upc: r.Upc, vendorid: r.Vendorid, brand: r.Brand,
      productid: r.Productid, pcode: r.Pcode,
      description: r.Description, color: r.Color, size: r.Size,
      unitcost: r.Unitcost,
    })
    setEditIdx(idx)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function deleteRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  function clearAll() {
    if (!confirm('Clear all rows?')) return
    setRows([])
    setEntry(emptyEntry)
    setEditIdx(null)
  }

  function exportCSV() {
    if (!rows.length) { showToast('⚠️ No rows to export'); return }
    const header = CSV_COLS.join(',')
    const lines = rows.map(r =>
      CSV_COLS.map(c => {
        const v = String(r[c] ?? '')
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
      }).join(',')
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `autocsv_${season}_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`📥 Exported ${rows.length} rows`)
  }

  function copySheet() {
    if (!rows.length) { showToast('⚠️ No rows to copy'); return }
    const header = CSV_COLS.join('\t')
    const lines = rows.map(r => CSV_COLS.map(c => r[c] ?? '').join('\t'))
    navigator.clipboard.writeText([header, ...lines].join('\n'))
      .then(() => showToast('📋 Copied to clipboard'))
      .catch(() => showToast('❌ Clipboard not available'))
  }

  const website = computeWebsite(storeTT, storeHP, storePO)

  if (!user) return null

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#9b8ec4', fontWeight: 700,
    letterSpacing: '0.06em', display: 'block', marginBottom: 4,
  }
  const inputStyle: React.CSSProperties = {
    background: '#f5f3ff', border: `1.5px solid ${border}`,
    borderRadius: 7, padding: '8px 10px', fontSize: 13,
    color: '#3b1f8c', fontWeight: 600, width: '100%', outline: 'none',
  }
  const thStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', fontSize: 10,
    fontWeight: 800, color: purple, letterSpacing: '0.07em',
    textTransform: 'uppercase', whiteSpace: 'nowrap',
  }
  const tdStyle: React.CSSProperties = {
    padding: '9px 12px', fontSize: 12, color: '#333', verticalAlign: 'middle',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6' }}>

      {/* Header */}
      <div style={{
        padding: '12px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: `1px solid ${border}`,
        background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#5b21b6', fontWeight: 600 }}>
            ← Back
          </button>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.04em' }}>
              ⚡ Auto CSV
            </h2>
            <p style={{ fontSize: 11, color: '#9b8ec4' }}>
              {rows.length} row{rows.length !== 1 ? 's' : ''} · Season: {season}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {rows.length > 0 && (
            <>
              <button onClick={copySheet}
                style={{ background: '#dbeafe', color: '#1e40af', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                📋 Copy Sheet
              </button>
              <button onClick={exportCSV}
                style={{ background: '#bbf7d0', color: '#166534', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                💾 Export CSV
              </button>
              <button onClick={clearAll}
                style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                🗑 Clear All
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, padding: '20px 24px', maxWidth: 1440, margin: '0 auto' }}>

        {/* ── LEFT PANEL: Entry form ─────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Blueprint globals */}
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, padding: 16, boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: purple, letterSpacing: '0.07em', marginBottom: 12 }}>BLUEPRINT</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>SEASON</label>
                <input value={season} onChange={e => setSeason(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>IU VALUES</label>
                <input value={iu} onChange={e => setIu(e.target.value)} placeholder="e.g. Men, Women" style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>MARKUP FORMULA</label>
              <input value={markup} onChange={e => setMarkup(e.target.value)} placeholder="unitcost * 2" style={inputStyle} />
              <p style={{ fontSize: 10, color: '#b8aed8', marginTop: 4 }}>Use <code>unitcost</code> as variable · e.g. <code>unitcost * 2.5</code></p>
            </div>

            {/* Store flags */}
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>STORES → WEBSITE={website}</label>
              <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                {[['TT', storeTT, setStoreTT], ['HP', storeHP, setStoreHP], ['PO', storePO, setStorePO]].map(([lbl, val, setter]) => (
                  <label key={lbl as string} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: (val as boolean) ? purple : '#9b8ec4', cursor: 'pointer' }}>
                    <input type="checkbox" checked={val as boolean} onChange={e => (setter as (v: boolean) => void)(e.target.checked)}
                      style={{ accentColor: purple }} />
                    {lbl as string}
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: usePu4 ? purple : '#9b8ec4', cursor: 'pointer', marginLeft: 8 }}>
                  <input type="checkbox" checked={usePu4} onChange={e => setUsePu4(e.target.checked)}
                    style={{ accentColor: purple }} />
                  Pu4
                </label>
              </div>
            </div>
          </div>

          {/* Item entry */}
          <div style={{ background: '#fff', border: `1.5px solid ${editIdx !== null ? purple : border}`, borderRadius: 12, padding: 16, boxShadow: editIdx !== null ? '0 0 0 2px #ede9fe' : '0 2px 12px rgba(124,58,237,0.07)' }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: editIdx !== null ? purple : '#9b8ec4', letterSpacing: '0.07em', marginBottom: 12 }}>
              {editIdx !== null ? '✏️ EDIT ROW' : '➕ ADD ITEM'}
            </p>

            {FIELDS.map((field, idx) => {
              const LABELS: Record<keyof EntryRow, string> = {
                upc: 'UPC', vendorid: 'VENDOR ID', brand: 'BRAND',
                productid: 'PRODUCT ID', pcode: 'P-CODE',
                description: 'DESCRIPTION', color: 'COLOR(S)', size: 'SIZE(S)', unitcost: 'UNIT COST',
              }
              return (
                <div key={field} style={{ marginBottom: 9 }}>
                  <label style={labelStyle}>{LABELS[field]}</label>
                  <input
                    ref={el => { fieldRefs.current[idx] = el }}
                    value={entry[field]}
                    onChange={e => setField(field, e.target.value)}
                    onKeyDown={e => handleKeyDown(e, idx)}
                    placeholder={field === 'color' || field === 'size' ? 'comma-sep to expand' : ''}
                    style={{
                      ...inputStyle,
                      textTransform: field === 'vendorid' ? 'uppercase' : 'none',
                    }}
                  />
                </div>
              )
            })}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={addRow}
                style={{ flex: 1, background: purple, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {editIdx !== null ? 'Update Row' : '＋ Add Row'}
              </button>
              {editIdx !== null && (
                <button onClick={() => { setEntry(emptyEntry); setEditIdx(null) }}
                  style={{ background: '#fff', color: '#9b8ec4', border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
              )}
            </div>
            <p style={{ fontSize: 10, color: '#c4b5fd', marginTop: 8, textAlign: 'center' }}>
              Press Enter to advance fields · Enter on last field adds row
            </p>
          </div>
        </div>

        {/* ── RIGHT PANEL: Results table ─────────────────────────────── */}
        <div>
          {rows.length === 0 ? (
            <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, padding: 48, textAlign: 'center', color: '#c4b5fd' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>No rows yet</p>
              <p style={{ fontSize: 12 }}>Fill in the form on the left and click <strong>Add Row</strong></p>
            </div>
          ) : (
            <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'auto', boxShadow: '0 2px 16px rgba(124,58,237,0.07)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                    <th style={{ ...thStyle, width: 36 }}>#</th>
                    <th style={thStyle}>UPC</th>
                    <th style={thStyle}>Vendor</th>
                    <th style={thStyle}>Brand</th>
                    <th style={thStyle}>Prod ID</th>
                    <th style={thStyle}>Description</th>
                    <th style={thStyle}>Color</th>
                    <th style={thStyle}>Size</th>
                    <th style={thStyle}>MG</th>
                    <th style={thStyle}>SG</th>
                    <th style={thStyle}>SSG</th>
                    <th style={thStyle}>Cost</th>
                    <th style={thStyle}>Sale</th>
                    <th style={thStyle}>Season</th>
                    <th style={thStyle}>Web</th>
                    <th style={{ ...thStyle, textAlign: 'right', paddingRight: 16 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: i === 0 ? 'none' : `1px solid #f0ebff`, background: i % 2 === 0 ? '#fff' : '#faf8ff' }}>
                      <td style={{ ...tdStyle, color: '#c4b5fd', fontSize: 11, fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ ...tdStyle, color: '#9b8ec4', fontFamily: 'monospace', fontSize: 11 }}>{r.Upc || '—'}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#5b21b6' }}>{r.Vendorid}</td>
                      <td style={tdStyle}>{r.Brand}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.Productid}</td>
                      <td style={{ ...tdStyle, maxWidth: 180 }}>
                        <span title={r.Description} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.Description}
                        </span>
                      </td>
                      <td style={tdStyle}>{r.Color}</td>
                      <td style={tdStyle}>
                        <span style={{ background: '#ede9fe', color: '#6d28d9', borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>
                          {r.Size}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11, color: '#6b7280' }}>{r.Mg}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: '#6b7280' }}>{r.Sg}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: '#6b7280' }}>{r.Ssg}</td>
                      <td style={{ ...tdStyle, color: '#374151' }}>${r.Unitcost}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#166534' }}>
                        {r.Saleprice ? `$${r.Saleprice}` : '—'}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11 }}>{r.Season}</td>
                      <td style={{ ...tdStyle, fontSize: 11 }}>{r.Website}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', paddingRight: 12 }}>
                        <div style={{ display: 'inline-flex', gap: 5 }}>
                          <button onClick={() => editRow(i)}
                            style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            Edit
                          </button>
                          <button onClick={() => deleteRow(i)}
                            style={{ background: '#fff5f5', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.startsWith('⚠') || toast.startsWith('❌') ? '#7f1d1d' : '#3b1f8c',
          color: '#fff', padding: '12px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'
import { BRAND_LIST } from '@/lib/brands'
import { VENDOR_DATA } from '@/lib/vendors'

// ── Data model ────────────────────────────────────────────────────────────────
// season_ledger table columns:
//   id, season, brand, drop_num (int), store (TTC|TTP),
//   units (int), initial_total (numeric), deposit (numeric), duties (numeric),
//   balance_due (numeric), payment_date (date|null), comment (text|null),
//   logged_by, created_at, updated_at

type Currency = 'USD' | 'EUR'

const PASTE_HEADERS = ['Brand','Vendor ID','Drop #','Drop Name','Store','Units','Total','Deposit','Duties','Currency','Invoice #','Order #','Comment']

interface SmartPasteRow {
  raw: string[]
  brand: string
  vendor_id: string
  drop_num: string
  drop_name: string
  store: string
  units: string
  total: string
  deposit: string
  duties: string
  currency: string
  invoice_num: string
  order_num: string
  comment: string
  // validation
  brandMatch: string | null    // null = not found
  vendorMatch: string | null
  warning: string | null
  skip: boolean
  // user overrides
  brandOverride: string | null   // user picked a different brand
  vendorOverride: string | null  // user picked a different vendor id
  brandCreateNew: boolean        // user wants to create new vendor entry
  vendorCreateNew: boolean
}

interface LedgerRow {
  id: string
  season: string
  brand: string
  drop_num: number
  store: string
  units: number | null
  initial_total: number | null
  deposit: number | null
  duties: number | null
  shipping: number | null
  cc_fee: number | null
  balance_due: number | null
  payment_date: string | null
  comment: string | null
  currency: Currency
  invoice_num: string | null
  order_num: string | null
  drop_name: string | null
  is_cancelled: boolean | null
  vendor_id: string | null
  logged_by: string
  created_at: string
  updated_at: string
  invoice_file_url: string | null
  invoice_files: { url: string; name: string; invoice_num?: string }[] | null
  packing_slips: { url: string; name: string; uploaded_at: string; invoice_num?: string }[] | null
  drop_label: string | null
}

// ── Seasons ───────────────────────────────────────────────────────────────────
const BASE_SEASONS = ['SS24','SS25','SS26','SS27','SS28','AW24','AW25','AW26','AW27','AW28']

function buildSeasons(extra: string[]): string[] {
  const all = [...BASE_SEASONS, ...extra.filter(s => !BASE_SEASONS.includes(s))]
  return all.sort((a, b) => {
    const yr = (s: string) => parseInt(s.slice(2))
    const half = (s: string) => s.slice(0,2) === 'SS' ? 0 : 1
    if (yr(a) !== yr(b)) return yr(a) - yr(b)
    return half(a) - half(b)
  })
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const purple      = '#7c3aed'
const purpleD     = '#5b21b6'
const purpleLight = '#f5f3ff'
const border      = '#d4c8f0'
const gray        = '#6b7280'

const inp: React.CSSProperties = {
  background: '#fff', border: '1.5px solid #d1d5db', borderRadius: 6,
  padding: '5px 8px', fontSize: 13, color: '#111', outline: 'none',
  fontFamily: 'Inter, sans-serif', width: '100%',
}
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: purpleD, marginBottom: 3, display: 'block',
}

const STORES = ['TTC', 'TTP']

const CURRENCY_SYMBOLS: Record<Currency, string> = { USD: '$', EUR: '€' }

function fmtMoney(n: number | null | undefined, currency: Currency = 'USD') {
  if (n == null) return '—'
  const sym = CURRENCY_SYMBOLS[currency]
  return sym + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Keep backwards compat alias
function fmt$(n: number | null | undefined, currency?: Currency) { return fmtMoney(n, currency) }
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const s = iso.slice(0, 10) // YYYY-MM-DD, no timezone shift
  const [y, m, d] = s.split('-')
  return `${m}-${d}-${String(y).slice(2)}`
}

// ── Blank store entry for the form ───────────────────────────────────────────
interface StoreEntry {
  store: string
  units: string
  initial_total: string
  deposit: string
  duties: string
  shipping: string
  cc_fee: string
  payment_date: string
  comment: string
  currency: Currency
  invoice_num: string
  order_num: string
  drop_name: string
  drop_label: string
}

function blankEntry(store: string): StoreEntry {
  return { store, units: '', initial_total: '', deposit: '', duties: '', shipping: '', cc_fee: '', payment_date: '', comment: '', currency: 'USD', invoice_num: '', order_num: '', drop_name: '', drop_label: '' }
}
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
// Ensure a YYYY-MM-DD date string survives a timestamptz round-trip by
// appending noon local time before writing so UTC never flips the day.
function safeDate(d: string) {
  if (!d) return d
  return d.slice(0, 10) + 'T12:00:00'
}

// ── Order PDF attachment (formerly Invoice attachment) ────────────────────
function InvoiceAttachment({ row, onUpdated }: { row: LedgerRow; onUpdated: () => void }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [delTarget, setDelTarget] = useState<string | null>(null)
  const [delPw, setDelPw] = useState('')
  const [delErr, setDelErr] = useState(false)
  const border = '#e5e7eb'

  // Merge legacy invoice_file_url — treat as { url, name, invoice_num: '' }
  const files: { url: string; name: string; invoice_num?: string }[] = [
    ...(row.invoice_files ?? []),
    ...(row.invoice_file_url && !(row.invoice_files ?? []).some(f => f.url === row.invoice_file_url)
      ? [{ url: row.invoice_file_url, name: 'Order PDF', invoice_num: '' }]
      : []),
  ]

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${row.id}_${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('invoices').upload(path, file, { upsert: true })
    if (upErr) { setUploading(false); return }
    const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path)
    const url = `${urlData.publicUrl}?v=${Date.now()}`
    const displayName = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Order PDF'
    const updated = [...files, { url, name: displayName, invoice_num: '' }]
    const { error: dbErr } = await supabase.from('season_ledger').update({ invoice_files: updated }).eq('id', row.id)
    if (dbErr) { setUploading(false); return }
    setUploading(false)
    onUpdated()
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleRemove(url: string) {
    const pathRaw = url.split('/invoices/').pop()?.split('?')[0]
    if (pathRaw) await supabase.storage.from('invoices').remove([pathRaw])
    const updated = files.filter(f => f.url !== url)
    const patch: Record<string, unknown> = { invoice_files: updated.length ? updated : null }
    if (row.invoice_file_url === url) patch.invoice_file_url = null
    await supabase.from('season_ledger').update(patch).eq('id', row.id)
    setDelTarget(null); setDelPw('')
    onUpdated()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {files.map((f, fi) => (
        <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href={f.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 8px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {/\.(xlsx?|csv|ods)(\?|$)/i.test(f.url) ? '📊' : '📄'} {f.name || `File ${fi + 1}`}
            </a>
            <button onClick={() => { setDelTarget(f.url); setDelPw(''); setDelErr(false) }}
              title="Remove this file"
              style={{ fontSize: 10, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
          {delTarget === f.url && (
            <div onMouseDown={e => e.stopPropagation()} style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', border: '1.5px solid #fca5a5', borderRadius: 8, padding: '10px 12px', zIndex: 999, minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>🗑 Delete "{f.name}"?</div>
              <input autoFocus type="password" placeholder="Type password"
                value={delPw} onChange={e => { setDelPw(e.target.value); setDelErr(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { if (delPw.toLowerCase() === 'delete') handleRemove(f.url); else setDelErr(true) } }}
                style={{ width: '100%', border: `1px solid ${delErr ? '#fca5a5' : border}`, borderRadius: 5, padding: '4px 7px', fontSize: 11, marginBottom: 6, outline: 'none', boxSizing: 'border-box' }} />
              {delErr && <div style={{ fontSize: 10, color: '#dc2626', marginBottom: 4 }}>Incorrect password</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { if (delPw.toLowerCase() === 'delete') handleRemove(f.url); else setDelErr(true) }}
                  style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>Delete</button>
                <button onClick={() => { setDelTarget(null); setDelPw('') }}
                  style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {/* Upload button */}
      <div>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.ods" onChange={handleUpload}
          style={{ display: 'none' }} id={`inv-file-${row.id}`} />
        <label htmlFor={`inv-file-${row.id}`}
          style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f9fafb', border: `1px dashed ${border}`, borderRadius: 5, padding: '2px 8px', cursor: uploading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {uploading ? '⏳ Uploading…' : files.length > 0 ? '📎 Add Order PDF' : '📎 Attach Order PDF'}
        </label>
      </div>
    </div>
  )
}

// ── Packing slip / Invoice attachment (side panel) ────────────────────────
function PackingSlipAttachment({ row, onUpdated }: { row: LedgerRow; onUpdated: () => void }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [delTarget, setDelTarget] = useState<string | null>(null)
  const [delPw, setDelPw] = useState('')
  const [delErr, setDelErr] = useState(false)
  const border = '#e5e7eb'
  const slips: { url: string; name: string; uploaded_at: string; invoice_num?: string }[] = row.packing_slips ?? []

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `ps_${row.id}_${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('invoices').upload(path, file, { upsert: true })
    if (upErr) { setUploading(false); return }
    const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path)
    const url = `${urlData.publicUrl}?v=${Date.now()}`
    const displayName = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Packing Slip'
    const updated = [...slips, { url, name: displayName, uploaded_at: new Date().toISOString(), invoice_num: '' }]
    await supabase.from('season_ledger').update({ packing_slips: updated }).eq('id', row.id)
    setUploading(false)
    onUpdated()
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleInvoiceNumChange(url: string, invoice_num: string) {
    const updated = slips.map(s => s.url === url ? { ...s, invoice_num } : s)
    await supabase.from('season_ledger').update({ packing_slips: updated }).eq('id', row.id)
    onUpdated()
  }

  async function handleRemove(url: string) {
    const pathRaw = url.split('/invoices/').pop()?.split('?')[0]
    if (pathRaw) await supabase.storage.from('invoices').remove([pathRaw])
    const updated = slips.filter(s => s.url !== url)
    await supabase.from('season_ledger').update({ packing_slips: updated.length ? updated : null }).eq('id', row.id)
    setDelTarget(null); setDelPw('')
    onUpdated()
  }

  function fmtDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {slips.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', background: '#f0f9ff', border: `1px solid #bae6fd`, borderRadius: 7, padding: '6px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href={s.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', background: '#e0f2fe', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 8px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {/\.(xlsx?|csv|ods)(\?|$)/i.test(s.url) ? '📊' : '📦'} {s.name || `Slip ${i + 1}`}
            </a>
            <button onClick={() => { setDelTarget(s.url); setDelPw(''); setDelErr(false) }}
              title="Remove this slip"
              style={{ fontSize: 10, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
          {/* Invoice # per slip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>Invoice #</span>
            <input
              defaultValue={s.invoice_num ?? ''}
              placeholder="e.g. INV-001"
              onBlur={e => handleInvoiceNumChange(s.url, e.target.value)}
              style={{ flex: 1, border: `1px solid ${border}`, borderRadius: 4, padding: '3px 6px', fontSize: 10, outline: 'none', background: '#fff' }}
            />
          </div>
          <span style={{ fontSize: 9, color: '#94a3b8' }}>Added {fmtDate(s.uploaded_at)}</span>
          {delTarget === s.url && (
            <div onMouseDown={e => e.stopPropagation()} style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', border: '1.5px solid #fca5a5', borderRadius: 8, padding: '10px 12px', zIndex: 999, minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>🗑 Delete "{s.name}"?</div>
              <input autoFocus type="password" placeholder="Type password"
                value={delPw} onChange={e => { setDelPw(e.target.value); setDelErr(false) }}
                onKeyDown={ev => { if (ev.key === 'Enter') { if (delPw.toLowerCase() === 'delete') handleRemove(s.url); else setDelErr(true) } }}
                style={{ width: '100%', border: `1px solid ${delErr ? '#fca5a5' : border}`, borderRadius: 5, padding: '4px 7px', fontSize: 11, marginBottom: 6, outline: 'none', boxSizing: 'border-box' }} />
              {delErr && <div style={{ fontSize: 10, color: '#dc2626', marginBottom: 4 }}>Incorrect password</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { if (delPw.toLowerCase() === 'delete') handleRemove(s.url); else setDelErr(true) }}
                  style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>Delete</button>
                <button onClick={() => { setDelTarget(null); setDelPw('') }}
                  style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.ods" onChange={handleUpload}
          style={{ display: 'none' }} id={`ps-file-${row.id}`} />
        <label htmlFor={`ps-file-${row.id}`}
          style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', background: '#f0f9ff', border: `1px dashed #bae6fd`, borderRadius: 5, padding: '2px 8px', cursor: uploading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {uploading ? '⏳ Uploading…' : slips.length > 0 ? '📦 Add Slip' : '📦 Attach Packing Slip'}
        </label>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SeasonBookPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok'|'err'>('ok')

  // Season picker
  const [season, setSeason] = useState('SS27')
  const [extraSeasons, setExtraSeasons] = useState<string[]>([])
  const [showNewSeason, setShowNewSeason] = useState(false)
  const [newSeasonInput, setNewSeasonInput] = useState('')
  const [showSeasonPanel, setShowSeasonPanel] = useState(false)

  // Header search
  const [headerSearch, setHeaderSearch] = useState('')
  const [showHeaderDrop, setShowHeaderDrop] = useState(false)
  const headerSearchRef = useRef<HTMLDivElement>(null)

  // Data
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(false)

  // Active brand being viewed/edited
  const [activeBrand, setActiveBrand] = useState<string | null>(null)

  // Modal: new log entry
  const [modal, setModal] = useState<'none'|'new-entry'|'edit-entry'|'add-payment'|'quick-pay'|'invoice'|'pay-history'|'smart-paste'>('none')
  const [pasteText, setPasteText] = useState('')
  const [pasteRows, setPasteRows] = useState<SmartPasteRow[]>([])
  const [pasteParsed, setPasteParsed] = useState(false)
  const [pasteSaving, setPasteSaving] = useState(false)
  const [editRow, setEditRow] = useState<LedgerRow | null>(null)
  const [rowCtxMenu, setRowCtxMenu] = useState<{ x: number; y: number; rows: LedgerRow[] } | null>(null)
  const [rowCtxDelPw, setRowCtxDelPw] = useState('')
  const [rowCtxDelMode, setRowCtxDelMode] = useState(false)
  const [rowCtxDelErr, setRowCtxDelErr] = useState(false)
  const rowCtxRef = useRef<HTMLDivElement>(null)
  const [brandCtxMenu, setBrandCtxMenu] = useState<{ x: number; y: number; brand: string; vendorId: string; editMode: boolean } | null>(null)
  const [brandCtxEditBrand, setBrandCtxEditBrand] = useState('')
  const [brandCtxEditVendor, setBrandCtxEditVendor] = useState('')
  const [brandCtxSaving, setBrandCtxSaving] = useState(false)
  const brandCtxRef = useRef<HTMLDivElement>(null)
  const [quickPayBrand, setQuickPayBrand] = useState<string | null>(null)
  const [quickPayAmt, setQuickPayAmt] = useState('')
  const [quickPayDate, setQuickPayDate] = useState(today())
  // Per-row override amounts when using 30% or manual per-row entry; keyed by row id
  const [perRowAmts, setPerRowAmts] = useState<Map<string, string>>(new Map())
  const [usePerRow, setUsePerRow] = useState(false)
  // Which rows are selected for payment (by id); null = all with balance
  const [paySelectedIds, setPaySelectedIds] = useState<Set<string>>(new Set())
  // Payment modal brand/vendor search
  const [payBrandSearch, setPayBrandSearch] = useState('')
  const [quickPayVendorId, setQuickPayVendorId] = useState<string | null>(null)
  // Invoice modal
  const [invoiceBrand, setInvoiceBrand] = useState<string | null>(null)
  const [invoiceVendorBrands, setInvoiceVendorBrands] = useState<string[] | null>(null) // multi-brand vendor invoice
  const [invoiceStoreFilter, setInvoiceStoreFilter] = useState<string | null>(null) // null = both stores
  const [invoicePayments, setInvoicePayments] = useState<Map<string, PaymentRecord[]>>(new Map())

  // Brand search inside new-entry modal
  const [modalBrandQ, setModalBrandQ] = useState('')
  const [modalBrandSuggs, setModalBrandSuggs] = useState<string[]>([])
  const [showModalBrandDrop, setShowModalBrandDrop] = useState(false)
  const modalBrandRef = useRef<HTMLDivElement>(null)
  // Inline brand/vendor dropdowns on the new-entry form (after brand chosen)
  const [showFormBrandDrop, setShowFormBrandDrop] = useState(false)
  const [showFormVendorDrop, setShowFormVendorDrop] = useState(false)
  const [formBrandHi, setFormBrandHi] = useState(-1)
  const [formVendorHi, setFormVendorHi] = useState(-1)
  const formBrandRef = useRef<HTMLDivElement>(null)
  const formVendorRef = useRef<HTMLDivElement>(null)
  // Inline brand/vendor dropdowns on the edit-entry form
  const [showEditBrandDrop, setShowEditBrandDrop] = useState(false)
  const [showEditVendorDrop, setShowEditVendorDrop] = useState(false)
  const [editBrandHi, setEditBrandHi] = useState(-1)
  const [editVendorHi, setEditVendorHi] = useState(-1)
  const editBrandRef = useRef<HTMLDivElement>(null)
  const editVendorRef = useRef<HTMLDivElement>(null)

  // Form state: drop number + per-store entries (TTC + TTP simultaneously)
  const [formDrop, setFormDrop] = useState(1)
  const [formStores, setFormStores] = useState<StoreEntry[]>(STORES.map(blankEntry))
  const [formVendorId, setFormVendorId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editDelMode, setEditDelMode] = useState(false)
  const [editDelPw, setEditDelPw] = useState('')
  const [editDelErr, setEditDelErr] = useState(false)

  // Filter/view
  const [viewFilter, setViewFilter] = useState('')
  // Drop name filter
  const [activeDropName, setActiveDropName] = useState<string | null>(null)
  // Drop name management (new name input)
  const [showDropNameMgr, setShowDropNameMgr] = useState(false)
  const [newDropNameInput, setNewDropNameInput] = useState('')

  // Vendor filter
  const [activeVendorId, setActiveVendorId] = useState<string | null>(null)

  // Vendor picker modal (when brand maps to multiple vendors)
  const [vendorPickerBrand, setVendorPickerBrand] = useState<string | null>(null)
  const [vendorPickerCandidates, setVendorPickerCandidates] = useState<string[]>([])
  const [vendorPickerOnSelect, setVendorPickerOnSelect] = useState<((vid: string) => void) | null>(null)

  // Payment history modal
  const [payHistRow, setPayHistRow] = useState<LedgerRow | null>(null)
  interface PaymentRecord { id: string; ledger_id: string; amount: number; payment_date: string; note: string | null; created_at: string }
  const [payHistRecords, setPayHistRecords] = useState<PaymentRecord[]>([])
  const [payHistLoading, setPayHistLoading] = useState(false)
  const [payHistEditId, setPayHistEditId] = useState<string | null>(null)
  const [payHistEditAmt, setPayHistEditAmt] = useState('')
  const [payHistEditDate, setPayHistEditDate] = useState('')
  const [payHistEditNote, setPayHistEditNote] = useState('')
  const [payHistSearch, setPayHistSearch] = useState('')

  // ── Season activation (STAR only) ────────────────────────────────────────
  // Stored in app_settings: key = 'season_active_{season}', value = 'true'/'false'
  const [seasonActive, setSeasonActive] = useState(false)
  const [activating, setActivating] = useState(false)
  // Map: ledger row id → module status string
  const [moduleStatusMap, setModuleStatusMap] = useState<Map<string, string>>(new Map())
  const [moduleAdjMap, setModuleAdjMap] = useState<Map<string, { qty: number | null; amount: number | null }>>(new Map())
  const [modulePOMap, setModulePOMap] = useState<Map<string, string>>(new Map())

  // ── Cut-off date ──────────────────────────────────────────────────────────
  // Stored in app_settings: key = 'cutoff_SS' / 'cutoff_AW', value = 'YYYY-MM-DD|active' or 'YYYY-MM-DD|inactive'
  const [cutoffDate, setCutoffDate] = useState<string>('')       // 'YYYY-MM-DD' or ''
  const [cutoffActive, setCutoffActive] = useState(false)
  const [showCutoffPopover, setShowCutoffPopover] = useState(false)
  const [cutoffInput, setCutoffInput] = useState('')
  const [cutoffSaving, setCutoffSaving] = useState(false)

  // Which half is the active season? SS or AW
  const seasonHalf = season.startsWith('SS') ? 'SS' : 'AW'

  // Is cutoff currently in effect? (date set, active flag on, today >= cutoff)
  const cutoffInEffect = cutoffActive && !!cutoffDate && today() >= cutoffDate

  function lsKey(half: string) { return `sb_cutoff_${half}` }

  async function loadCutoff(half: string) {
    // Try Supabase first, fall back to localStorage
    try {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', `cutoff_${half}`).maybeSingle()
      if (!error && data?.value) {
        const [d, flag] = data.value.split('|')
        setCutoffDate(d ?? ''); setCutoffActive(flag === 'active'); setCutoffInput(d ?? '')
        return
      }
    } catch { /* table may not exist yet */ }
    // localStorage fallback
    try {
      const stored = localStorage.getItem(lsKey(half))
      if (stored) {
        const [d, flag] = stored.split('|')
        setCutoffDate(d ?? ''); setCutoffActive(flag === 'active'); setCutoffInput(d ?? '')
        return
      }
    } catch { /* ignore */ }
    setCutoffDate(''); setCutoffActive(false); setCutoffInput('')
  }

  async function saveCutoff(half: string, date: string, active: boolean) {
    setCutoffSaving(true)
    const value = `${date}|${active ? 'active' : 'inactive'}`
    // Try Supabase; if it fails, localStorage keeps it working
    let savedToDb = false
    try {
      const { error } = await supabase.from('app_settings').upsert({ key: `cutoff_${half}`, value }, { onConflict: 'key' })
      if (!error) savedToDb = true
    } catch { /* table may not exist */ }
    // Always persist to localStorage as reliable fallback
    try { localStorage.setItem(lsKey(half), value) } catch { /* ignore */ }
    setCutoffSaving(false)
    setCutoffDate(date); setCutoffActive(active)
    showToast(savedToDb ? '✅ Cut-off date saved' : '✅ Cut-off date saved (local)')
    setShowCutoffPopover(false)
  }

  // ── Season activation helpers ─────────────────────────────────────────────
  async function loadSeasonActive(s: string) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', `season_active_${s}`).maybeSingle()
      const active = data?.value === 'true'
      setSeasonActive(active)
      if (active) loadModuleStatus(s)
    } catch { setSeasonActive(false) }
  }

  async function loadModuleStatus(s: string) {
    const half = s.startsWith('SS') ? 'season_ss' : 'season_aw'
    try {
      const { data } = await supabase.from(half).select('season_book_id, status, adj_qty, adj_amount, po_no').not('season_book_id', 'is', null)
      if (!data) return
      const statusMap = new Map<string, string>()
      const adjMap = new Map<string, { qty: number | null; amount: number | null }>()
      const poMap = new Map<string, string>()
      for (const r of data as { season_book_id: string; status: string | null; adj_qty: number | null; adj_amount: number | null; po_no: string | null }[]) {
        if (!r.season_book_id) continue
        let st = r.status || (r.po_no ? 'Pending' : 'Not Created')
        if (r.adj_qty != null || r.adj_amount != null) st = 'Adjusted'
        statusMap.set(r.season_book_id, st)
        if (r.adj_qty != null || r.adj_amount != null) {
          adjMap.set(r.season_book_id, { qty: r.adj_qty, amount: r.adj_amount })
        }
        if (r.po_no) poMap.set(r.season_book_id, r.po_no)
      }
      setModuleStatusMap(statusMap)
      setModuleAdjMap(adjMap)
      setModulePOMap(poMap)
    } catch { /* columns may not exist yet */ }
  }

  // Sync one ledger row to SS or AW table
  async function syncLedgerRowToModule(row: LedgerRow): Promise<string | null> {
    const half = row.season?.startsWith('SS') ? 'season_ss' : 'season_aw'
    // Check if already linked (this will fail if migration hasn't been run)
    const { data: existing, error: chkErr } = await supabase.from(half).select('id').eq('season_book_id', row.id).maybeSingle()
    if (chkErr) {
      // Column doesn't exist — migration hasn't been run yet
      return `Column 'season_book_id' missing from ${half} — run the SQL migration in Supabase first`
    }
    if (existing) {
      // Already linked — update order_num (invoice_no) and qty in case they changed
      const { error: updErr } = await supabase.from(half).update({
        invoice_no: row.order_num || null,
        qty: row.units,
      }).eq('id', existing.id)
      return updErr ? updErr.message : null
    }
    const status = row.order_num ? 'Pending' : 'Not Created'
    const { error } = await supabase.from(half).insert({
      store: row.store,
      brand: row.brand,
      invoice_no: row.order_num || null,
      po_no: null,
      qty: row.units,
      logged: false,
      logged_by: null,
      logged_at: null,
      note: `Auto-linked from Season Book drop ${row.drop_num}${row.drop_name ? ` · ${row.drop_name}` : ''}`,
      flagged: false,
      season_book_id: row.id,
      status,
    })
    return error ? error.message : null
  }

  async function activateSeason(s: string) {
    setActivating(true)
    try {
      // Save activation flag
      await supabase.from('app_settings').upsert({ key: `season_active_${s}`, value: 'true' }, { onConflict: 'key' })
      setSeasonActive(true)
      // Sync all existing ledger rows for this season
      const { data: allRows } = await supabase.from('season_ledger').select('*').eq('season', s)
      if (allRows && allRows.length > 0) {
        let synced = 0; let firstErr: string | null = null
        for (const row of allRows as LedgerRow[]) {
          const err = await syncLedgerRowToModule(row)
          if (err) { firstErr = firstErr ?? err }
          else synced++
        }
        if (firstErr) {
          showToast(`❌ Sync failed: ${firstErr} — have you run the SQL migration in Supabase?`, 'err')
          // Roll back active flag since sync failed
          await supabase.from('app_settings').upsert({ key: `season_active_${s}`, value: 'false' }, { onConflict: 'key' })
          setSeasonActive(false)
        } else {
          showToast(`✅ Season ${s} activated — ${synced} row${synced !== 1 ? 's' : ''} synced to ${s.startsWith('SS') ? 'SS' : 'AW'} module`)
        }
      } else {
        showToast(`✅ Season ${s} activated — new drops will auto-sync`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast('❌ ' + msg, 'err')
    }
    setActivating(false)
  }

  async function deactivateSeason(s: string) {
    setActivating(true)
    try {
      await supabase.from('app_settings').upsert({ key: `season_active_${s}`, value: 'false' }, { onConflict: 'key' })
      setSeasonActive(false)
      showToast(`⏸ Season ${s} deactivated — existing data in ${s.startsWith('SS') ? 'SS' : 'AW'} module stays until you Clear Season there. No new drops will sync.`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast('❌ ' + msg, 'err')
    }
    setActivating(false)
  }

  function downloadSeasonCSV() {
    const headers = [
      'Brand','Vendor ID','Drop #','Drop Name','Drop Label','Store',
      'Units','Total','Deposit','Duties','Shipping','CC Fee','Balance Due',
      'Currency','Order #','Invoice #','Payment Date','Comment',
      'Cancelled','Logged By','Created At','Updated At',
      'Order PDF Files','Invoice # Files (packing slips)',
    ]
    const csvRows = [headers.join(',')]
    for (const r of rows) {
      const orderPDFs = (r.invoice_files ?? []).map(f => f.name || f.url).join(' | ')
      const slipNums = (r.packing_slips ?? []).map(s => s.invoice_num ? `${s.name || 'slip'}: ${s.invoice_num}` : (s.name || 'slip')).join(' | ')
      csvRows.push([
        r.brand, r.vendor_id ?? '', r.drop_num, r.drop_name ?? '', r.drop_label ?? '',
        r.store, r.units ?? '', r.initial_total ?? '', r.deposit ?? '',
        r.duties ?? '', r.shipping ?? '', r.cc_fee ?? '', r.balance_due ?? '',
        r.currency ?? 'USD', r.order_num ?? '', r.invoice_num ?? '',
        r.payment_date ?? '', (r.comment ?? '').replace(/,/g, ';'),
        r.is_cancelled ? 'Yes' : 'No',
        r.logged_by ?? '', r.created_at ?? '', r.updated_at ?? '',
        orderPDFs, slipNums,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${season}_season_book.csv`; a.click()
    URL.revokeObjectURL(url)
    showToast(`✅ Downloaded ${season} season book (${rows.length} rows)`)
  }

  async function openPayHistory(row: LedgerRow) {
    setPayHistRow(row)
    setPayHistLoading(true)
    setModal('pay-history')
    const { data, error } = await supabase
      .from('season_payments')
      .select('*')
      .eq('ledger_id', row.id)
      .order('payment_date', { ascending: false })
    setPayHistLoading(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    // If no history records but deposit exists, synthesize one from ledger data
    const records = data ?? []
    if (records.length === 0 && (row.deposit ?? 0) > 0) {
      setPayHistRecords([{
        id: `__legacy__${row.id}`,
        ledger_id: row.id,
        amount: row.deposit ?? 0,
        payment_date: row.payment_date ?? row.created_at.slice(0, 10),
        note: 'Recorded before history tracking',
        created_at: row.created_at,
      }])
    } else {
      setPayHistRecords(records)
    }
  }

  async function confirmRowDelete() {
    console.log('[confirmRowDelete]', { rowCtxMenu, rowCtxDelPw })
    if (!rowCtxMenu) { console.warn('no rowCtxMenu'); return }
    if (rowCtxDelPw.toLowerCase() !== 'delete') { setRowCtxDelErr(true); return }
    const ids = rowCtxMenu.rows.map(r => r.id)
    console.log('[confirmRowDelete] deleting ids', ids)
    const { error } = await supabase.from('season_ledger').delete().in('id', ids)
    console.log('[confirmRowDelete] result', error)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    setRowCtxMenu(null); setRowCtxDelMode(false); setRowCtxDelPw(''); setRowCtxDelErr(false)
    showToast(`🗑 ${ids.length} row${ids.length !== 1 ? 's' : ''} deleted`)
    if (user) fetchRows(season, user)
  }

  async function deletePayment(payId: string, row: LedgerRow, amount: number) {
    if (!user) return
    if (payId.startsWith('__legacy__')) {
      showToast('⚠️ This payment was recorded before history tracking — edit the deposit directly on the entry.', 'err'); return
    }
    const { error } = await supabase.from('season_payments').delete().eq('id', payId)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    // Re-fetch only payments for THIS ledger row to get accurate total
    const { data: rowPayments } = await supabase.from('season_payments').select('amount').eq('ledger_id', row.id)
    const newDep = (rowPayments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0)
    const newBal = (row.initial_total ?? 0) - newDep + (row.duties ?? 0) + (row.shipping ?? 0) + (row.cc_fee ?? 0)
    await supabase.from('season_ledger').update({ deposit: newDep, balance_due: newBal }).eq('id', row.id)
    setPayHistRecords(prev => prev.filter(p => p.id !== payId))
    if (user) fetchRows(season, user)
    showToast('🗑 Payment deleted')
  }

  async function savePayHistEdit(payId: string, row: LedgerRow) {
    if (!user) return
    if (payId.startsWith('__legacy__')) {
      showToast('⚠️ This payment was recorded before history tracking — edit the deposit directly on the entry.', 'err'); return
    }
    const newAmt = parseFloat(payHistEditAmt)
    if (!newAmt) return
    const { error } = await supabase.from('season_payments').update({
      amount: newAmt, payment_date: safeDate(payHistEditDate), note: payHistEditNote || null
    }).eq('id', payId)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    // Re-fetch only payments for THIS ledger row to get accurate total
    const { data: rowPayments } = await supabase.from('season_payments').select('amount').eq('ledger_id', row.id)
    const newDep = (rowPayments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0)
    const newBal = (row.initial_total ?? 0) - newDep + (row.duties ?? 0) + (row.shipping ?? 0) + (row.cc_fee ?? 0)
    await supabase.from('season_ledger').update({ deposit: newDep, balance_due: newBal }).eq('id', row.id)
    setPayHistRecords(prev => prev.map(p => p.id === payId ? { ...p, amount: newAmt, payment_date: payHistEditDate, note: payHistEditNote || null } : p))
    setPayHistEditId(null)
    fetchRows(season, user)
    showToast('✅ Payment updated')
  }

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3000)
  }

  const isAdmin = user?.store === 'ALL'
  // Payment/history/deposit access: STAR (admin) and MG only
  const canPay = ['STAR', 'MG'].includes(user?.userid?.toUpperCase() ?? '')
  const canSmartPaste = user?.userid?.toUpperCase() === 'STAR'

  // Fuzzy brand/vendor matcher — strips punctuation & spaces for comparison
  function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }

  function parsePaste(text: string, vendors: typeof VENDOR_DATA): SmartPasteRow[] {
    const lines = text.trim().split('\n').filter(l => l.trim())
    // skip header row if first cell matches first header
    const startIdx = normalize(lines[0]?.split('\t')[0] ?? '') === normalize(PASTE_HEADERS[0]) ? 1 : 0
    const allBrands = Array.from(new Set(vendors.map(v => v.brand)))
    const allVendorIds = Array.from(new Set(vendors.map(v => v.vendor_id)))

    return lines.slice(startIdx).map(line => {
      const cols = line.split('\t').map(c => c.trim())
      const [brand='', vendor_id='', drop_num='', drop_name='', store='', units='', total='', deposit='', duties='', currency='USD', invoice_num='', order_num='', comment=''] = cols

      // Fuzzy brand match
      const normBrand = normalize(brand)
      let brandMatch: string | null = allBrands.find(b => normalize(b) === normBrand) ?? null
      if (!brandMatch && normBrand) {
        // partial match fallback
        brandMatch = allBrands.find(b => normalize(b).includes(normBrand) || normBrand.includes(normalize(b))) ?? null
      }

      // Fuzzy vendor match
      const normVendor = normalize(vendor_id)
      let vendorMatch: string | null = allVendorIds.find(v => normalize(v) === normVendor) ?? null
      if (!vendorMatch && normVendor) {
        vendorMatch = allVendorIds.find(v => normalize(v).includes(normVendor) || normVendor.includes(normalize(v))) ?? null
      }

      let warning: string | null = null
      if (brand && !brandMatch) warning = `Brand "${brand}" not found in vendors list`
      else if (brandMatch && brandMatch !== brand) warning = `Brand matched as "${brandMatch}" (you entered "${brand}")`
      if (vendor_id && !vendorMatch) warning = (warning ? warning + '; ' : '') + `Vendor ID "${vendor_id}" not found`
      else if (vendorMatch && vendorMatch !== vendor_id) warning = (warning ? warning + '; ' : '') + `Vendor matched as "${vendorMatch}" (you entered "${vendor_id}")`

      return {
        raw: cols, brand, vendor_id, drop_num, drop_name, store, units, total,
        deposit, duties, currency, invoice_num, order_num, comment,
        brandMatch, vendorMatch, warning, skip: false,
        brandOverride: null, vendorOverride: null, brandCreateNew: false, vendorCreateNew: false,
      }
    })
  }

  const [liveVendors, setLiveVendors] = useState(VENDOR_DATA)

  // ── Vendor lookup map: brand → vendor_id[] (blank vendor_ids excluded) ────
  const brandToVendors = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const v of liveVendors) {
      if (!v.vendor_id || !v.vendor_id.trim()) continue   // skip blank vendor IDs
      const existing = map.get(v.brand) ?? []
      if (!existing.includes(v.vendor_id)) {
        map.set(v.brand, [...existing, v.vendor_id])
      }
    }
    return map
  }, [liveVendors])

  // ── Actual assigned vendor IDs per brand (from live row data) ──────────────
  // Used for sidebar/table badges — reflects what was actually saved, not static VENDOR_DATA
  const brandAssignedVendors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!r.vendor_id || !r.vendor_id.trim()) continue
      const s = map.get(r.brand) ?? new Set<string>()
      s.add(r.vendor_id)
      map.set(r.brand, s)
    }
    return map
  }, [rows])

  // Helper: get vendor_id for a brand (returns null if 0 or 2+ vendors)
  function getUniqueVendorId(brand: string): string | null {
    const vids = brandToVendors.get(brand)
    if (!vids || vids.length !== 1) return null
    return vids[0]
  }

  // ── Fetch rows for current season ─────────────────────────────────────────
  const [pendingErrorBrands, setPendingErrorBrands] = useState<Set<string>>(new Set())

  const fetchRows = useCallback(async (s: string, u: User) => {
    setLoading(true)
    let q = supabase.from('season_ledger').select('*').eq('season', s).order('brand').order('drop_num').order('store')
    if (u.store !== 'ALL') {
      const viewStores = [u.store, ...(u.admin_stores ?? [])].filter(Boolean)
      q = q.in('store', viewStores)
    }
    const { data, error } = await q
    if (error) { showToast('❌ ' + error.message, 'err') }
    else setRows((data as unknown as LedgerRow[]) || [])
    // Fetch ALL open error forms across all seasons (no final_date) so badge persists across seasons
    const { data: ef } = await supabase.from('error_forms').select('brand').is('final_date', null)
    setPendingErrorBrands(new Set((ef ?? []).map((r: { brand: string }) => r.brand)))
    setLoading(false)
  }, [])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchRows(season, u)
    loadCutoff(season.startsWith('SS') ? 'SS' : 'AW')
    loadSeasonActive(season)
    // Load live vendors from Supabase, fall back to static VENDOR_DATA
    supabase.from('vendors').select('vendor_id, brand, active').order('vendor_id').then(({ data, error }) => {
      if (!error && data && data.length > 0) setLiveVendors((data as typeof VENDOR_DATA).filter(v => v.active !== false))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, fetchRows, season])

  // Modal brand autocomplete
  useEffect(() => {
    if (!modalBrandQ.trim()) { setModalBrandSuggs([]); return }
    const q = modalBrandQ.toLowerCase()
    const inSeason = Array.from(new Set(rows.map(r => r.brand)))
    const all = Array.from(new Set([...BRAND_LIST, ...inSeason]))
    setModalBrandSuggs(all.filter(b => b.toLowerCase().includes(q)).slice(0, 10))
  }, [modalBrandQ, rows])

  // Load payment records when invoice modal opens
  useEffect(() => {
    if (modal !== 'invoice') { setInvoicePayments(new Map()); return }
    const activeBrands = invoiceVendorBrands ?? (invoiceBrand ? [invoiceBrand] : [])
    const rowIds = rows.filter(r => activeBrands.includes(r.brand)).map(r => r.id)
    if (rowIds.length === 0) return
    supabase.from('season_payments').select('*').in('ledger_id', rowIds).order('payment_date', { ascending: true })
      .then(({ data }) => {
        const map = new Map<string, PaymentRecord[]>()
        for (const p of (data ?? []) as PaymentRecord[]) {
          const list = map.get(p.ledger_id) ?? []
          list.push(p)
          map.set(p.ledger_id, list)
        }
        setInvoicePayments(map)
      })
  }, [modal, invoiceBrand, invoiceVendorBrands, rows])

  const cutoffPopoverRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (headerSearchRef.current && !headerSearchRef.current.contains(e.target as Node)) {
        setShowHeaderDrop(false)
      }
      if (modalBrandRef.current && !modalBrandRef.current.contains(e.target as Node)) {
        setShowModalBrandDrop(false)
      }
      if (formBrandRef.current && !formBrandRef.current.contains(e.target as Node)) {
        setShowFormBrandDrop(false)
      }
      if (formVendorRef.current && !formVendorRef.current.contains(e.target as Node)) {
        setShowFormVendorDrop(false)
      }
      if (editBrandRef.current && !editBrandRef.current.contains(e.target as Node)) {
        setShowEditBrandDrop(false)
      }
      if (editVendorRef.current && !editVendorRef.current.contains(e.target as Node)) {
        setShowEditVendorDrop(false)
      }
      if (cutoffPopoverRef.current && !cutoffPopoverRef.current.contains(e.target as Node)) {
        setShowCutoffPopover(false)
      }
      if (rowCtxRef.current && !rowCtxRef.current.contains(e.target as Node)) {
        setRowCtxMenu(null); setRowCtxDelMode(false); setRowCtxDelPw(''); setRowCtxDelErr(false)
      }
      if (brandCtxRef.current && !brandCtxRef.current.contains(e.target as Node)) {
        setBrandCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Computed: brands in this season ───────────────────────────────────────
  const brandsInSeason = Array.from(new Set(rows.map(r => r.brand))).sort()

  // All distinct drop names used in this season's rows (from the DB)
  const dropNamesInSeason = Array.from(new Set(
    rows.map(r => r.drop_name).filter((n): n is string => !!n)
  )).sort()

  const filteredBrands = (() => {
    let list = viewFilter
      ? brandsInSeason.filter(b => b.toLowerCase().includes(viewFilter.toLowerCase()))
      : brandsInSeason
    // Filter by active drop name
    if (activeDropName) {
      list = list.filter(b => rows.some(r => r.brand === b && r.drop_name === activeDropName))
    }
    // Filter by active vendor_id
    if (activeVendorId) {
      const vendorBrands = new Set(liveVendors.filter(v => v.vendor_id === activeVendorId).map(v => v.brand))
      list = list.filter(b => vendorBrands.has(b))
    }
    return list
  })()

  // Header search: brand name OR invoice # OR vendor_id match
  const allBrandOptions = Array.from(new Set([...BRAND_LIST, ...brandsInSeason]))
  const headerSearchResults: Array<{ type: 'brand' | 'invoice' | 'vendor'; label: string; brand: string; invoiceNum?: string; vendorId?: string }> = headerSearch.trim()
    ? [
        // Vendor ID matches — only vendors with a vendor_id
        ...Array.from(new Set(liveVendors.filter(v => v.vendor_id && v.vendor_id.trim()).map(v => v.vendor_id)))
          .filter(vid => vid.toLowerCase().includes(headerSearch.toLowerCase()))
          .slice(0, 4)
          .map(vid => ({ type: 'vendor' as const, label: vid, brand: '', vendorId: vid })),
        // Brand name matches
        ...allBrandOptions
          .filter(b => b.toLowerCase().includes(headerSearch.toLowerCase()))
          .slice(0, 6)
          .map(b => ({ type: 'brand' as const, label: b, brand: b })),
        // Invoice # matches — dedupe by brand+invoice
        ...rows
          .filter(r => r.invoice_num && r.invoice_num.toLowerCase().includes(headerSearch.toLowerCase()))
          .reduce<Array<{ type: 'invoice'; label: string; brand: string; invoiceNum: string }>>((acc, r) => {
            const key = r.brand + '|' + r.invoice_num
            if (!acc.find(x => x.brand + '|' + x.invoiceNum === key)) {
              acc.push({ type: 'invoice', label: `${r.brand} — INV ${r.invoice_num}`, brand: r.brand, invoiceNum: r.invoice_num! })
            }
            return acc
          }, [])
          .slice(0, 6),
      ]
    : []

  // Rows for active brand
  const brandRows = activeBrand ? rows.filter(r => r.brand === activeBrand) : []

  // Group by drop for active brand
  const drops = Array.from(new Set(brandRows.map(r => r.drop_num))).sort((a,b) => a-b)

  // ── Vendor picker helper ──────────────────────────────────────────────────
  function maybePickVendor(brand: string, onConfirm: (vid: string | null) => void) {
    const vids = brandToVendors.get(brand)
    if (!vids || vids.length <= 1) {
      onConfirm(vids?.[0] ?? null)
      return
    }
    // Multiple vendors — show picker
    setVendorPickerBrand(brand)
    setVendorPickerCandidates(vids)
    setVendorPickerOnSelect(() => (vid: string) => {
      setVendorPickerBrand(null)
      onConfirm(vid)
    })
  }

  // ── Open new entry modal ───────────────────────────────────────────────────
  function openNewEntry(brand: string) {
    setActiveBrand(brand)
    setModalBrandQ('')
    setShowModalBrandDrop(false)
    // Determine next drop number for this brand
    const existing = rows.filter(r => r.brand === brand)
    const maxDrop = existing.length > 0 ? Math.max(...existing.map(r => r.drop_num)) : 0
    setFormDrop(maxDrop + 1)
    setFormStores(STORES.map(blankEntry))
    // Auto-set vendor or prompt picker
    const vids = brandToVendors.get(brand)
    if (vids && vids.length > 1) {
      setVendorPickerBrand(brand)
      setVendorPickerCandidates(vids)
      setVendorPickerOnSelect(() => (vid: string) => {
        setFormVendorId(vid)
        setVendorPickerBrand(null)
      })
      setFormVendorId(null)
    } else {
      setFormVendorId(vids?.[0] ?? null)
    }
    setModal('new-entry')
  }

  function openNewEntryBlank() {
    setModalBrandQ('')
    setShowModalBrandDrop(false)
    setFormDrop(1)
    setFormStores(STORES.map(blankEntry))
    setFormVendorId(null)
    setModal('new-entry')
  }

  // ── Open edit modal ────────────────────────────────────────────────────────
  function openEdit(row: LedgerRow) {
    setEditRow(row)
    setFormStores([{
      store: row.store,
      units: row.units?.toString() ?? '',
      initial_total: row.initial_total?.toString() ?? '',
      deposit: row.deposit?.toString() ?? '',
      duties: row.duties?.toString() ?? '',
      shipping: row.shipping?.toString() ?? '',
      cc_fee: row.cc_fee?.toString() ?? '',
      payment_date: row.payment_date ?? '',
      comment: row.comment ?? '',
      currency: (row.currency as Currency) ?? 'USD',
      invoice_num: row.invoice_num ?? '',
      order_num: row.order_num ?? '',
      drop_name: row.drop_name ?? '',
      drop_label: row.drop_label ?? '',
    }])
    setModal('edit-entry')
  }

  // ── Save new log entry ─────────────────────────────────────────────────────
  // Auto-add brand+vendor to vendors table if not already there
  async function ensureVendorExists(brand: string, vendorId: string | null) {
    if (!brand?.trim()) return
    const normalBrand = brand.trim()
    const normalVendor = vendorId?.trim() || null
    // Check if this brand already exists in liveVendors
    const alreadyExists = liveVendors.some(v =>
      v.brand.toLowerCase() === normalBrand.toLowerCase() &&
      (normalVendor ? v.vendor_id?.toLowerCase() === normalVendor.toLowerCase() : true)
    )
    if (alreadyExists) return
    // Insert new vendor entry
    const { data } = await supabase.from('vendors').upsert(
      { brand: normalBrand, vendor_id: normalVendor, active: true },
      { onConflict: 'brand,vendor_id', ignoreDuplicates: true }
    ).select()
    // Refresh liveVendors — only active
    const { data: fresh } = await supabase.from('vendors').select('vendor_id, brand, active').order('vendor_id')
    if (fresh && fresh.length > 0) setLiveVendors((fresh as typeof VENDOR_DATA).filter(v => v.active !== false))
  }

  async function saveNewEntry() {
    if (!user || !activeBrand) return
    if (cutoffInEffect && !isAdmin) {
      showToast('⚠️ Cut-off is in effect. Please reach out to Manager to approve logging this invoice.', 'err')
      return
    }
    setSaving(true)
    const inserts = formStores
      .filter(e => e.units || e.initial_total || e.deposit || e.duties || e.shipping || e.cc_fee)
      .map(e => {
        const init = parseFloat(e.initial_total) || null
        const dep  = parseFloat(e.deposit) || null
        const dut  = parseFloat(e.duties) || null
        const shp  = parseFloat(e.shipping) || null
        const ccf  = parseFloat(e.cc_fee) || null
        const bal  = init != null ? (init - (dep ?? 0) + (dut ?? 0) + (shp ?? 0) + (ccf ?? 0)) : null
        return {
          season, brand: activeBrand, drop_num: formDrop, store: e.store,
          units: parseInt(e.units) || null,
          initial_total: init, deposit: dep, duties: dut, shipping: shp, cc_fee: ccf, balance_due: bal,
          payment_date: (e.deposit && e.payment_date) ? safeDate(e.payment_date) : null,
          comment: e.comment || null,
          currency: e.currency,
          invoice_num: e.invoice_num || null,
          order_num: e.order_num || null,
          drop_name: (e.drop_name && e.drop_name !== '\0') ? e.drop_name : null,
          drop_label: e.drop_label || null,
          vendor_id: formVendorId ?? null,
          logged_by: user.userid,
        }
      })
    if (inserts.length === 0) { showToast('⚠️ Enter at least one store row', 'err'); setSaving(false); return }

    // Check no duplicate drop+store
    const existing = rows.filter(r => r.brand === activeBrand && r.drop_num === formDrop)
    const existStores = existing.map(r => r.store)
    const dupe = inserts.find(i => existStores.includes(i.store))
    if (dupe) { showToast(`❌ Log #${formDrop} already has a ${dupe.store} entry`, 'err'); setSaving(false); return }

    const { data: inserted, error } = await supabase.from('season_ledger').insert(inserts).select()
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
    // If season is active, auto-sync new rows to SS/AW module
    if (seasonActive && inserted) {
      let syncErr: string | null = null
      for (const row of inserted as LedgerRow[]) {
        const err = await syncLedgerRowToModule(row)
        if (err) syncErr = err
      }
      if (syncErr) {
        showToast(`⚠️ Saved but sync failed: ${syncErr}`, 'err')
        setSaving(false); return
      }
    }
    // Auto-add to vendors if new brand/vendor combo
    await ensureVendorExists(activeBrand, formVendorId ?? null)
    showToast(`✅ Log #${formDrop} saved for ${activeBrand}${seasonActive ? ' · synced to module' : ''}`)
    setModal('none')
    fetchRows(season, user)
    setSaving(false)
  }

  // ── Delete row from edit modal ────────────────────────────────────────────
  async function deleteEditRow() {
    if (!editRow) return
    if (editDelPw.toLowerCase() !== 'delete') { setEditDelErr(true); return }
    setSaving(true)
    const { error, count } = await supabase.from('season_ledger').delete({ count: 'exact' }).eq('id', editRow.id)
    setSaving(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    if (count === 0) { showToast('❌ Delete blocked — check Supabase RLS policy for season_ledger', 'err'); return }
    setRows(prev => prev.filter(r => r.id !== editRow.id))
    setModal('none')
    setEditRow(null)
    setEditDelMode(false)
    setEditDelPw('')
    showToast('🗑 Log deleted')
  }

  // ── Save edit ─────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!user || !editRow) return
    setSaving(true)
    const e = formStores[0]
    const init = parseFloat(e.initial_total) || null
    const dep  = parseFloat(e.deposit) || null
    const dut  = parseFloat(e.duties) || null
    const shp  = parseFloat(e.shipping) || null
    const ccf  = parseFloat(e.cc_fee) || null
    const bal  = init != null ? (init - (dep ?? 0) + (dut ?? 0) + (shp ?? 0) + (ccf ?? 0)) : null
    const { error } = await supabase.from('season_ledger').update({
      units: parseInt(e.units) || null,
      initial_total: init, deposit: dep, duties: dut, shipping: shp, cc_fee: ccf, balance_due: bal,
      payment_date: (dep && e.payment_date) ? safeDate(e.payment_date) : null,
      comment: e.comment || null,
      currency: e.currency,
      invoice_num: e.invoice_num || null,
      order_num: e.order_num || null,
      drop_name: (e.drop_name && e.drop_name !== '\0') ? e.drop_name : null,
      drop_label: e.drop_label || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editRow.id)
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
    // Auto-add to vendors if new brand/vendor combo
    await ensureVendorExists(editRow.brand, editRow.vendor_id ?? null)
    // Sync order_num (and qty) to linked SS/AW row if season is active
    if (seasonActive) {
      const updatedRow: LedgerRow = { ...editRow, order_num: e.order_num || null, units: parseInt(e.units) || null }
      await syncLedgerRowToModule(updatedRow)
    }
    showToast('✅ Entry updated')
    setModal('none')
    fetchRows(season, user)
    setSaving(false)
  }

  // ── Toggle cancelled flag ─────────────────────────────────────────────────
  async function toggleCancelled(row: LedgerRow) {
    if (!user) return
    const newVal = !row.is_cancelled
    const { error } = await supabase.from('season_ledger').update({
      is_cancelled: newVal,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast(newVal ? '🚫 Marked as cancelled' : '✅ Cancellation removed')
    fetchRows(season, user)
  }

  // ── Add payment to existing row ───────────────────────────────────────────
  async function addPayment(row: LedgerRow, amount: string, date: string) {
    if (!user) return
    const addDep = parseFloat(amount)
    if (!addDep) return
    const newDep = (row.deposit ?? 0) + addDep
    const init   = row.initial_total ?? 0
    const dut    = row.duties ?? 0
    const shp    = row.shipping ?? 0
    const ccf    = row.cc_fee ?? 0
    const newBal = init - newDep + dut + shp + ccf
    const { error } = await supabase.from('season_ledger').update({
      deposit: newDep, balance_due: newBal,
      payment_date: safeDate(date || row.payment_date || today()),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    // Also log to season_payments for history (non-fatal if table doesn't exist yet)
    await supabase.from('season_payments').insert({ ledger_id: row.id, amount: addDep, payment_date: safeDate(date || today()) })
    showToast('✅ Payment recorded')
    await fetchRows(season, user)
  }

  // ── Create new season ─────────────────────────────────────────────────────
  function createSeason() {
    const s = newSeasonInput.trim().toUpperCase()
    if (!s.match(/^(SS|AW)\d{2}$/)) { showToast('⚠️ Format: SS28 or AW28', 'err'); return }
    if (buildSeasons(extraSeasons).includes(s)) { showToast('Season already exists'); return }
    setExtraSeasons(prev => [...prev, s])
    setSeason(s)
    setShowNewSeason(false)
    setNewSeasonInput('')
  }

  const allSeasons = buildSeasons(extraSeasons)

  if (!user) return null

  // ── Payment sub-row component ─────────────────────────────────────────────
  function PaymentRow({ row }: { row: LedgerRow }) {
    const [adding, setAdding] = useState(false)
    const [amt, setAmt] = useState('')
    const [payDate, setPayDate] = useState(today())
    return (
      <div>
        {adding ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <button
              onClick={() => setAmt(((row.initial_total ?? 0) * 0.3).toFixed(2))}
              style={{ background: '#ede9fe', color: purpleD, border: `1px solid ${purpleD}`, borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
              30%
            </button>
            <input value={amt} onChange={e => setAmt(e.target.value)} placeholder="Amount $" type="number"
              style={{ ...inp, width: 100 }} />
            <input value={payDate} onChange={e => setPayDate(e.target.value)} type="date"
              style={{ ...inp, width: 140 }} />
            <button onClick={async () => { await addPayment(row, amt, payDate); setAdding(false); setAmt('') }}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Save
            </button>
            <button onClick={() => setAdding(false)}
              style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            style={{ background: '#ede9fe', color: purpleD, border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', marginTop: 2 }}>
            + Payment
          </button>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        .sb-header { padding: 10px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid ${border}; background: ${purpleD}; position: sticky; top: 0; z-index: 100; }
        @keyframes cutoff-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(202,138,4,0.5); } 50% { box-shadow: 0 0 0 5px rgba(202,138,4,0); } }
        .sb-subbar { padding: 6px 0 6px 16px; background: #f5f3ff; border-bottom: 1px solid ${border}; display: flex; align-items: center; gap: 8px; position: sticky; top: 54px; z-index: 99; }
        .sb-layout { display: flex; flex: 1; position: relative; }
        .sb-sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid ${border}; background: rgba(255,255,255,0.7); overflow-y: auto; position: sticky; top: 97px; height: calc(100vh - 97px); /* subbar ~43px + header 54px */ }
        .sb-main { flex: 1; padding: 16px; }
        .sb-brand-row { padding: 8px 14px; cursor: pointer; border-bottom: 1px solid #ede9fe; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 13px; font-weight: 600; color: #374151; transition: background 0.1s; }
        .sb-brand-row:hover, .sb-brand-row.active { background: #ede9fe; color: ${purpleD}; }
        .sb-brand-row.active { font-weight: 600; }
        .drop-card { background: #fff; border: 1.5px solid ${border}; border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
        .drop-head { background: #ede9fe; padding: 7px 14px; display: flex; align-items: center; gap: 10px; }
        .store-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .store-table th { padding: 5px 10px; text-align: left; font-size: 11px; font-weight: 700; color: #1e3a8a; background: #dbeafe; border-bottom: 1.5px solid #93c5fd; white-space: nowrap; }
        .store-table td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
        .store-table tbody tr { cursor: pointer; transition: background 0.1s; }
        .store-table tbody tr:hover { background: #f5f3ff; }
        .store-table tr:last-child td { border-bottom: none; }
        .bal-green { color: #15803d; font-weight: 700; }
        .bal-red   { color: #dc2626; font-weight: 700; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; }
        .modal-box { background: #fff; border-radius: 14px; width: 100%; max-width: 680px; box-shadow: 0 8px 48px rgba(0,0,0,0.22); display: flex; flex-direction: column; max-height: 92vh; }
        .modal-body { overflow-y: auto; flex: 1; }
        .modal-head { padding: 14px 18px; border-bottom: 1px solid #ede9fe; display: flex; align-items: center; justify-content: space-between; }
        .modal-body { padding: 16px 18px 20px; }
        .store-block { border: 1.5px solid #e0e7ff; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
        .store-block-head { font-size: 12px; font-weight: 800; color: ${purpleD}; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        /* Season slide panel */
        .season-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 200; }
        .season-panel { position: fixed; top: 0; left: 0; bottom: 0; width: 240px; background: #fff; z-index: 201; display: flex; flex-direction: column; box-shadow: 4px 0 24px rgba(0,0,0,0.18); transform: translateX(-100%); transition: transform 0.22s cubic-bezier(.4,0,.2,1); }
        .season-panel.open { transform: translateX(0); }
        .sp-head { padding: 14px 16px; background: ${purpleD}; display: flex; align-items: center; justify-content: space-between; }
        .sp-season-row { padding: 10px 16px; cursor: pointer; border-bottom: 1px solid #ede9fe; display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 700; color: #374151; transition: background 0.1s; }
        .sp-season-row:hover { background: #ede9fe; }
        .sp-season-row.active { background: #ede9fe; color: ${purpleD}; }
        .sp-season-row.active::after { content: '✓'; font-size: 12px; color: ${purpleD}; }
        /* Mobile drop cards */
        .sb-drop-card { display: none; }
        .sb-drop-table { display: block; }
        @media (max-width: 600px), (pointer: coarse) and (max-width: 900px) {
          .sb-layout { flex-direction: column; }
          .sb-sidebar { display: none !important; }
          .sb-main { padding: 10px; width: 100%; }
          .form-grid { grid-template-columns: 1fr; }
          .sb-financials { grid-template-columns: 1fr !important; }
          .store-table th, .store-table td { font-size: 11px; padding: 4px 6px; }
          .sb-new-btn { display: none !important; }
          .sb-drop-new { display: none !important; }
          .sb-click-hint { display: none !important; }
          .sb-header-title { position: static !important; transform: none !important; flex: 1; justify-content: flex-end; }
          .sb-header-left { flex: 0 !important; }
          .sb-header-right { display: none !important; }
          .sb-subbar { gap: 6px; padding: 6px 8px; }
          .sb-subbar-drop { order: 99; flex-shrink: 0; display: flex; align-items: center; gap: 4px; margin-left: auto; }
          .sb-subbar-search { order: 1; flex: 1; min-width: 0; max-width: none !important; }
          .sb-drop-label { display: none !important; }
          .sb-drop-select { font-size: 10px !important; padding: 3px 4px !important; max-width: 70px; }
          .sb-subbar-divider { display: none !important; }
          .sb-drop-table { display: none !important; }
          .sb-drop-card { display: block !important; }
          /* Edit modal mobile — bottom sheet */
          .modal-bg { padding: 0; align-items: flex-end; overflow-y: hidden; }
          .modal-box { border-radius: 18px 18px 0 0 !important; max-width: 100% !important; max-height: 92vh; display: flex; flex-direction: column; }
          .modal-head { flex-shrink: 0; }
          .modal-body { overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }
          .sb-edit-flex { flex-direction: column !important; }
          .sb-edit-form { border-right: none !important; border-bottom: 2px solid #ede9fe; }
          .sb-edit-panel { width: 100% !important; min-width: 0 !important; border-radius: 0 !important; }
          .sb-edit-grid-3 { grid-template-columns: 1fr 1fr !important; }
          .sb-edit-grid-4 { grid-template-columns: 1fr 1fr !important; }
          .sb-financials-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* Season slide-out panel */}
      {showSeasonPanel && <div className="season-overlay" onClick={() => setShowSeasonPanel(false)} />}
      <div className={`season-panel${showSeasonPanel ? ' open' : ''}`}>
        <div className="sp-head">
          <span style={{ fontSize: 14, fontWeight: 900, color: '#fff', letterSpacing: '0.06em' }}>📅 Seasons</span>
          <button onClick={() => setShowSeasonPanel(false)}
            style={{ background: 'none', border: 'none', color: '#e9d5ff', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {allSeasons.map(s => (
            <div key={s} className={`sp-season-row${season === s ? ' active' : ''}`}
              onClick={() => { setSeason(s); setActiveBrand(null); setActiveDropName(null); setShowSeasonPanel(false) }}>
              {s}
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${border}` }}>
          {showNewSeason ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input value={newSeasonInput} onChange={e => setNewSeasonInput(e.target.value.toUpperCase())}
                placeholder="SS28" maxLength={5} autoFocus
                onKeyDown={e => e.key === 'Enter' && createSeason()}
                style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: `1.5px solid ${border}`, fontSize: 13, fontWeight: 700 }} />
              <button onClick={createSeason}
                style={{ background: purple, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>✓</button>
              <button onClick={() => setShowNewSeason(false)}
                style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 5, padding: '5px 8px', fontSize: 13, cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <button onClick={() => setShowNewSeason(true)}
              style={{ width: '100%', background: '#ede9fe', color: purpleD, border: `1.5px dashed ${border}`, borderRadius: 7, padding: '7px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New Season
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="sb-header">
        {/* Left: hamburger + home */}
        <div className="sb-header-left" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <button onClick={() => setShowSeasonPanel(true)} title="Switch season"
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 6, padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'center', width: 34, height: 34, flexShrink: 0 }}>
            <span style={{ display: 'block', width: 16, height: 2, background: '#fff', borderRadius: 1 }} />
            <span style={{ display: 'block', width: 16, height: 2, background: '#fff', borderRadius: 1 }} />
            <span style={{ display: 'block', width: 16, height: 2, background: '#fff', borderRadius: 1 }} />
          </button>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#e9d5ff', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '4px 10px' }}>
            ← Home
          </button>
        </div>

        {/* Center: title + season badge */}
        <div className="sb-header-title" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>📒 SEASON BOOK</span>
          <span style={{ background: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 12, padding: '3px 10px', border: '1.5px solid rgba(255,255,255,0.4)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            onClick={() => setShowSeasonPanel(true)}>
            {season}
          </span>
        </div>

        {/* Right: action buttons */}
        <div className="sb-header-right" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>

          {/* Cut-off date alert/admin control */}
          <div ref={cutoffPopoverRef} style={{ position: 'relative' }}>
            {/* Alert badge — always visible when in effect */}
            {cutoffInEffect && (
              <button
                onClick={() => { if (isAdmin) setShowCutoffPopover(v => !v) }}
                style={{ background: '#fef08a', color: '#713f12', border: '1.5px solid #ca8a04', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 800, cursor: isAdmin ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', animation: 'cutoff-pulse 2s ease-in-out infinite' }}>
                ⚠️ {seasonHalf} Cut-Off In Effect
              </button>
            )}
            {/* Admin-only dashed button when NOT in effect */}
            {!cutoffInEffect && isAdmin && (
              <button
                onClick={() => setShowCutoffPopover(v => !v)}
                style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', border: '1px dashed rgba(255,255,255,0.3)', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ✂️ Cut-Off
              </button>
            )}

            {/* Admin popover */}
            {showCutoffPopover && isAdmin && (
              <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 10, padding: '14px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 300, minWidth: 240 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: purpleD, marginBottom: 10 }}>✂️ {seasonHalf} Cut-Off Date</div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>Date</label>
                <input type="date" value={cutoffInput} onChange={e => setCutoffInput(e.target.value)}
                  style={{ ...inp, fontSize: 12, marginBottom: 10 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={cutoffActive} onChange={e => { setCutoffActive(e.target.checked) }} />
                    Active
                  </label>
                  {cutoffActive && cutoffInput && (
                    <span style={{ fontSize: 10, color: today() >= cutoffInput ? '#dc2626' : '#6b7280' }}>
                      {today() >= cutoffInput ? '🔴 In effect now' : `⏳ Starts ${cutoffInput}`}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setShowCutoffPopover(false)}
                    style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, padding: '6px 0', fontSize: 12, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      // Read active state directly from DOM to avoid stale closure
                      const cb = cutoffPopoverRef.current?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
                      const isActive = cb ? cb.checked : cutoffActive
                      saveCutoff(seasonHalf, cutoffInput, isActive)
                    }}
                    disabled={!cutoffInput || cutoffSaving}
                    style={{ flex: 1, background: purpleD, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !cutoffInput || cutoffSaving ? 0.6 : 1 }}>
                    {cutoffSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Admin-only buttons — STAR only */}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={downloadSeasonCSV}
                style={{
                  background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)',
                  border: '1px solid rgba(255,255,255,0.3)', borderRadius: 7,
                  padding: '5px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                ⬇ Download
              </button>
              <button
                onClick={() => {
                  if (seasonActive) {
                    if (!window.confirm(`Deactivate ${season}?\n\nExisting data in the ${seasonHalf} module stays — no rows will be deleted. New drops just won't sync until you reactivate.`)) return
                    deactivateSeason(season)
                  } else {
                    if (!window.confirm(`Activate ${season}?\n\nThis will sync all current drops to the ${seasonHalf} module and auto-sync any new ones going forward.`)) return
                    activateSeason(season)
                  }
                }}
                disabled={activating}
                style={{
                  background: seasonActive ? '#d1fae5' : 'rgba(255,255,255,0.15)',
                  color: seasonActive ? '#065f46' : 'rgba(255,255,255,0.85)',
                  border: seasonActive ? '1.5px solid #6ee7b7' : '1px dashed rgba(255,255,255,0.4)',
                  borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 800,
                  cursor: activating ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                  opacity: activating ? 0.6 : 1,
                }}>
                {activating ? '⏳ Working…' : seasonActive ? `✅ ${seasonHalf} Active` : `▶ Activate ${seasonHalf}`}
              </button>
            </div>
          )}

          <button className="sb-new-btn" onClick={() => {
              if (cutoffInEffect && !isAdmin) {
                alert('⚠️ Cut-Off is in effect.\n\nPlease reach out to Manager to approve logging this invoice.')
                return
              }
              activeBrand ? openNewEntry(activeBrand) : openNewEntryBlank()
            }}
            style={{ background: '#fff', color: purpleD, border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            + New
          </button>
          {canSmartPaste && <button onClick={() => { setPasteText(''); setPasteRows([]); setPasteParsed(false); setModal('smart-paste') }}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            📋 Smart Paste
          </button>}
          {canPay && <button onClick={async () => {
            setPayHistRow(null)
            setPayHistLoading(true)
            setModal('pay-history')
            const ledgerIds = rows.map(r => r.id)
            if (ledgerIds.length === 0) { setPayHistLoading(false); setPayHistRecords([]); return }
            const { data, error } = await supabase
              .from('season_payments').select('*')
              .in('ledger_id', ledgerIds)
              .order('payment_date', { ascending: false })
            setPayHistLoading(false)
            if (error) { showToast('❌ ' + error.message, 'err'); return }
            const realRecords = data ?? []
            // Synthesize legacy records for rows with a deposit but no payment history entry
            const coveredIds = new Set(realRecords.map((r: {ledger_id: string}) => r.ledger_id))
            const legacyRecords = rows
              .filter(r => !coveredIds.has(r.id) && (r.deposit ?? 0) > 0)
              .map(r => ({
                id: `__legacy__${r.id}`,
                ledger_id: r.id,
                amount: r.deposit ?? 0,
                payment_date: r.payment_date ?? r.created_at.slice(0, 10),
                note: 'Recorded before history tracking',
                created_at: r.created_at,
              }))
            const all = [...realRecords, ...legacyRecords].sort((a, b) => b.payment_date.localeCompare(a.payment_date))
            setPayHistRecords(all)
          }}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            🕐 History
          </button>}
          {canPay && <button onClick={() => {
            setQuickPayBrand(activeBrand ?? null)
            setQuickPayVendorId(null)
            setQuickPayAmt(''); setQuickPayDate(today())
            setPaySelectedIds(new Set())
            setPayBrandSearch('')
            setPerRowAmts(new Map()); setUsePerRow(false)
            setModal('quick-pay')
          }}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            💳 Payment
          </button>}
        </div>
      </div>

      {/* Combined sub-bar: Drop | search | active filters */}
      <div className="sb-subbar">
        {/* Drop dropdown — left edge, no sidebar spacer needed here */}
        <div className="sb-subbar-drop" style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, paddingRight: 4 }}>
          <span className="sb-drop-label" style={{ fontSize: 11, fontWeight: 800, color: gray }}>Drop:</span>
          <select className="sb-drop-select"
            value={activeDropName ?? ''}
            onChange={e => setActiveDropName(e.target.value === '' ? null : e.target.value)}
            style={{ fontSize: 11, fontWeight: 700, border: `1.5px solid ${border}`, borderRadius: 7, padding: '4px 8px', background: '#fff', color: purpleD, cursor: 'pointer', outline: 'none' }}>
            <option value="">All</option>
            {dropNamesInSeason.map(dn => <option key={dn} value={dn}>{dn}</option>)}
          </select>
          {showDropNameMgr ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <input autoFocus value={newDropNameInput} onChange={e => setNewDropNameInput(e.target.value)}
                placeholder="New name…" maxLength={40}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newDropNameInput.trim()) { setActiveDropName(newDropNameInput.trim()); setNewDropNameInput(''); setShowDropNameMgr(false) }
                  if (e.key === 'Escape') { setShowDropNameMgr(false); setNewDropNameInput('') }
                }}
                style={{ fontSize: 11, border: `1.5px solid ${border}`, borderRadius: 6, padding: '3px 6px', outline: 'none', width: 110 }} />
              <button onClick={() => { if (newDropNameInput.trim()) { setActiveDropName(newDropNameInput.trim()); setNewDropNameInput('') } setShowDropNameMgr(false) }}
                style={{ fontSize: 11, background: purpleD, color: '#fff', border: 'none', borderRadius: 5, padding: '3px 6px', cursor: 'pointer' }}>✓</button>
              <button onClick={() => { setShowDropNameMgr(false); setNewDropNameInput('') }}
                style={{ fontSize: 11, background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 5, padding: '3px 6px', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <button className="sb-drop-new" onClick={() => setShowDropNameMgr(true)}
              style={{ fontSize: 11, fontWeight: 700, background: 'none', border: `1.5px dashed ${border}`, borderRadius: 7, padding: '3px 8px', cursor: 'pointer', color: gray }}>
              + New
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="sb-subbar-divider" style={{ width: 1, height: 20, background: border, flexShrink: 0 }} />

        {/* Search — aligns with grand total box */}
        <div className="sb-subbar-search" ref={headerSearchRef} style={{ position: 'relative', flex: 1, maxWidth: 500 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 7, border: `1.5px solid ${border}`, overflow: 'hidden' }}>
            <span style={{ padding: '0 8px', color: gray, fontSize: 14 }}>🔍</span>
            <input
              value={headerSearch}
              onChange={e => { setHeaderSearch(e.target.value); setShowHeaderDrop(true) }}
              onFocus={() => setShowHeaderDrop(true)}
              placeholder="Search brand or vendor…"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#111', fontSize: 13, fontWeight: 500, padding: '5px 8px 5px 0', flex: 1, minWidth: 0 }}
            />
            {headerSearch && (
              <button onClick={() => { setHeaderSearch(''); setShowHeaderDrop(false) }}
                style={{ background: 'none', border: 'none', color: gray, cursor: 'pointer', padding: '0 8px', fontSize: 14 }}>✕</button>
            )}
          </div>
          {showHeaderDrop && headerSearchResults.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 8, zIndex: 300, maxHeight: 300, overflowY: 'auto', boxShadow: '0 6px 24px rgba(0,0,0,0.14)' }}>
              {headerSearchResults.map((item, i) => (
                <div key={i}
                  onClick={() => {
                    if (item.type === 'vendor') { setActiveVendorId(item.vendorId!); setActiveBrand(null) }
                    else { setActiveBrand(item.brand) }
                    setHeaderSearch(''); setShowHeaderDrop(false)
                  }}
                  style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#ede9fe')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.type === 'invoice' ? (
                      <><span style={{ color: gray, fontWeight: 400, marginRight: 4 }}>INV</span>{item.brand}</>
                    ) : item.type === 'vendor' ? (
                      <><span style={{ color: '#065f46', fontWeight: 800, marginRight: 4 }}>VID</span>{item.label}</>
                    ) : item.label}
                  </span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {item.type === 'vendor' && <span style={{ fontSize: 10, color: '#065f46', fontWeight: 700, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 4, padding: '1px 5px' }}>Vendor ID</span>}
                    {item.type === 'invoice' && <span style={{ fontSize: 10, color: '#1e40af', fontWeight: 700, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 5px' }}>INV {item.invoiceNum}</span>}
                    {item.type === 'brand' && brandsInSeason.includes(item.brand) && <span style={{ fontSize: 10, color: purpleD, fontWeight: 700, background: '#ede9fe', borderRadius: 6, padding: '1px 6px' }}>in {season}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active filters */}
        {activeBrand && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: purpleD, background: '#ede9fe', borderRadius: 20, padding: '3px 10px', border: `1px solid ${border}` }}>
            {activeBrand}
            <button onClick={() => setActiveBrand(null)} style={{ background: 'none', border: 'none', color: gray, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
          </div>
        )}
        {activeVendorId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 20, padding: '3px 10px' }}>
            {activeVendorId}
            <button onClick={() => setActiveVendorId(null)} style={{ background: 'none', border: 'none', color: '#065f46', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />
      </div>

      {/* Body */}
      <div className="sb-layout">

        {/* Sidebar — vendor list */}
        <div className="sb-sidebar">
          {/* Filter vendors */}
          {brandsInSeason.length > 0 && (
            <div style={{ padding: '6px 12px', borderBottom: `1px solid ${border}` }}>
              <input value={viewFilter} onChange={e => setViewFilter(e.target.value)}
                placeholder="Filter vendors…"
                style={{ ...inp, fontSize: 11 }} />
            </div>
          )}

          {/* Vendor list — one entry per vendor ID */}
          {loading ? (
            <p style={{ padding: 16, fontSize: 12, color: gray }}>Loading…</p>
          ) : brandsInSeason.length === 0 ? (
            <p style={{ padding: 16, fontSize: 12, color: gray, textAlign: 'center' }}>No vendors logged for {season} yet.</p>
          ) : (() => {
            // Build unique vendor list from filteredBrands
            const seen = new Set<string>()
            const vendorItems: { vid: string; brands: string[] }[] = []
            for (const b of filteredBrands) {
              const assigned = brandAssignedVendors.get(b)
              const vids = assigned && assigned.size > 0 ? Array.from(assigned) : (brandToVendors.get(b) ?? [])
              const vid = vids[0] ?? '—'
              if (!seen.has(vid)) {
                seen.add(vid)
                vendorItems.push({ vid, brands: [] })
              }
              vendorItems.find(x => x.vid === vid)!.brands.push(b)
            }
            return vendorItems.map(({ vid, brands }) => {
              const vRows = brands.flatMap(b => activeDropName
                ? rows.filter(r => r.brand === b && r.drop_name === activeDropName)
                : rows.filter(r => r.brand === b))
              const totalBal = vRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
              const hasOwing = totalBal > 0.001
              const isActive = brands.some(b => activeBrand === b)
              return (
                <div key={vid} className={`sb-brand-row${isActive ? ' active' : ''}`}
                  onClick={() => {
                    // scroll to this vendor card
                    setTimeout(() => {
                      document.getElementById(`vendor-${vid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 50)
                  }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: 'inherit' }}>
                    {vid}
                  </span>
                  {hasOwing && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1px 5px', flexShrink: 0 }}>
                      {fmt$(totalBal)}
                    </span>
                  )}
                </div>
              )
            })
          })()}
        </div>

        {/* Main panel */}
        <div className="sb-main">
          {loading ? (
            <div style={{ textAlign: 'center', paddingTop: 60, color: gray, fontSize: 13 }}>Loading…</div>
          ) : brandsInSeason.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 60, color: gray }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📒</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: purpleD, marginBottom: 6 }}>{season} Season Book</div>
              <div style={{ fontSize: 13, color: gray }}>No entries yet — click &ldquo;+ New&rdquo; to log a brand drop</div>
            </div>
          ) : (
            <>
              {/* Season summary — scoped to active drop name filter if set */}
              {(() => {
                // Scope base rows to active drop + vendor filters
                let baseRows = activeDropName
                  ? rows.filter(r => r.drop_name === activeDropName)
                  : rows
                if (activeVendorId) {
                  const vendorBrands = new Set(liveVendors.filter(v => v.vendor_id === activeVendorId).map(v => v.brand))
                  baseRows = baseRows.filter(r => vendorBrands.has(r.brand))
                }
                const storeIds = STORES.filter(s => baseRows.some(r => r.store === s))
                const dataRows = ['Grand Total', ...storeIds]
                const statsFor = (storeFilter: string | null) => {
                  const r = storeFilter ? baseRows.filter(x => x.store === storeFilter) : baseRows
                  return {
                    units: r.reduce((s, x) => s + (x.units ?? 0), 0),
                    init:  r.reduce((s, x) => s + (x.initial_total ?? 0), 0),
                    dep:   r.reduce((s, x) => s + (x.deposit ?? 0), 0),
                    dut:   r.reduce((s, x) => s + (x.duties ?? 0), 0),
                    bal:   r.reduce((s, x) => s + (x.balance_due ?? 0), 0),
                  }
                }
                const metrics = [
                  { label: 'Units',         key: 'units' as const, fmt: (v: number) => String(v || '—') },
                  { label: 'Initial Total',  key: 'init'  as const, fmt: (v: number) => fmt$(v) },
                  { label: 'Deposits Paid',  key: 'dep'   as const, fmt: (v: number) => fmt$(v) },
                  { label: 'Duties',         key: 'dut'   as const, fmt: (v: number) => fmt$(v) },
                  { label: 'Balance Due',    key: 'bal'   as const, fmt: (v: number) => fmt$(v) },
                ]
                const tableLabel = activeVendorId ? `Vendor: ${activeVendorId}` : activeDropName ? activeDropName : season
                return (
                  <div style={{ marginBottom: 20, background: '#fff', border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: purpleD }}>
                          <th style={{ padding: '7px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#e9d5ff', whiteSpace: 'nowrap', minWidth: 100 }}>
                            {tableLabel}
                            {activeDropName && <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.75, marginLeft: 6 }}>({season})</span>}
                          </th>
                          {metrics.map(m => (
                            <th key={m.key} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#e9d5ff', borderLeft: `1px solid rgba(255,255,255,0.15)`, whiteSpace: 'nowrap' }}>
                              {m.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.map((rowLabel, ri) => {
                          const isTotal = rowLabel === 'Grand Total'
                          const stats = statsFor(isTotal ? null : rowLabel)
                          return (
                            <tr key={rowLabel} style={{ background: isTotal ? '#f5f3ff' : ri % 2 === 0 ? '#fff' : '#faf9ff' }}>
                              <td style={{ padding: '6px 12px', fontSize: 12, fontWeight: isTotal ? 800 : 700, color: isTotal ? purpleD : gray, borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap', textAlign: 'left' }}>
                                {rowLabel}
                              </td>
                              {metrics.map(m => {
                                const v = stats[m.key]
                                const isBal = m.key === 'bal'
                                const color = isBal ? (v > 0.001 ? '#dc2626' : '#166534') : (isTotal ? purpleD : '#374151')
                                return (
                                  <td key={m.key} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: isTotal ? 800 : 600, fontSize: isTotal ? 13 : 12, color, borderLeft: `1px solid ${border}`, borderBottom: `1px solid ${border}` }}>
                                    {m.fmt(v)}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()}

              {/* All brands — grouped by Vendor ID, Brand as first column */}
              {(() => {
                // Build vendor-grouped cards
                const brandsToShow = filteredBrands.filter(b => !activeBrand || b === activeBrand)

                // Group brands by their vendor ID
                const vendorGroups = new Map<string, string[]>()
                for (const brand of brandsToShow) {
                  const assigned = brandAssignedVendors.get(brand)
                  const vids = assigned && assigned.size > 0 ? Array.from(assigned) : (brandToVendors.get(brand) ?? [])
                  const vid = vids[0] ?? '—'
                  if (!vendorGroups.has(vid)) vendorGroups.set(vid, [])
                  vendorGroups.get(vid)!.push(brand)
                }

                return Array.from(vendorGroups.entries()).map(([vid, brands]) => {
                  // All rows for this vendor group
                  const vRows = brands.flatMap(brand => {
                    const allBRows = rows.filter(r => r.brand === brand)
                    return activeDropName ? allBRows.filter(r => r.drop_name === activeDropName) : allBRows
                  })
                  if (vRows.length === 0) return null

                  const totBal  = vRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                  const totInit = vRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                  const totalDrops = Array.from(new Set(vRows.map(r => `${r.brand}|${r.drop_num}`))).length
                  const isHighlighted = brands.some(b => activeBrand === b)

                  return (
                    <div key={vid} id={`vendor-${vid}`}
                      style={{ marginBottom: 16, border: `2px solid ${isHighlighted ? purple : border}`, borderRadius: 10, background: '#fff', overflow: 'hidden' }}>

                      {/* Vendor ID header */}
                      <div
                        onClick={() => {
                          setInvoiceVendorBrands(brands)
                          setInvoiceBrand(null)
                          setInvoiceStoreFilter(null)
                          setModal('invoice')
                        }}
                        onContextMenu={e => {
                          e.preventDefault()
                          if (brands.length === 1) {
                            setBrandCtxMenu({ x: e.clientX, y: e.clientY, brand: brands[0], vendorId: vid === '—' ? '' : vid, editMode: false })
                            setBrandCtxEditBrand(brands[0])
                            setBrandCtxEditVendor(vid === '—' ? '' : vid)
                          }
                        }}
                        title="Click to view invoices · Right-click to edit vendor / brand"
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: isHighlighted ? '#ede9fe' : '#f5f3ff', borderBottom: `1px solid ${border}`, flexWrap: 'wrap', cursor: 'pointer' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: purpleD }}>{vid}</span>
                        <span style={{ fontSize: 11, color: gray, background: '#ede9fe', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>{season}</span>
                        <span style={{ fontSize: 11, color: gray }}>{totalDrops} drop{totalDrops !== 1 ? 's' : ''}</span>
                        {totBal <= 0.001 && totInit > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#166534', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1px 7px' }}>✓ Paid</span>
                        )}
                        {brands.some(b => pendingErrorBrands.has(b)) && (
                          <span title="Open error form(s) — not yet resolved" style={{ fontSize: 11, fontWeight: 800, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '1px 8px', whiteSpace: 'nowrap' }}>⚠️ Error Form</span>
                        )}
                        <span className="sb-click-hint" style={{ fontSize: 10, color: gray, marginLeft: 'auto' }}>click row to open invoice</span>
                      </div>

                      {/* Rows table — Brand is first column */}
                      <div className="sb-drop-table">
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '18%' }} />{/* Brand */}
                          <col style={{ width: '14%' }} />{/* Log # */}
                          <col style={{ width: '8%' }} />{/* Store */}
                          <col style={{ width: '12%' }} />{/* Order # */}
                          <col style={{ width: '5%' }} />{/* PDF */}
                          <col style={{ width: '7%' }} />{/* Units */}
                          <col style={{ width: '11%' }} />{/* Total */}
                          <col style={{ width: '11%' }} />{/* Deposits */}
                          <col style={{ width: seasonActive ? '7%' : '11%' }} />{/* Balance Due */}
                          {seasonActive && <col style={{ width: '7%' }} />}{/* Adj Qty */}
                          {seasonActive && <col style={{ width: '8%' }} />}{/* Adj Amt */}
                        </colgroup>
                        <thead>
                          <tr style={{ background: '#f8f7ff' }}>
                            <th style={{ padding: '5px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Brand</th>
                            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Log #</th>
                            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Store</th>
                            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Order #</th>
                            <th style={{ padding: '5px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>PDF</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Units</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Total</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Deposits</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Balance Due</th>
                            {seasonActive && <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#dc2626', borderBottom: `1px solid ${border}` }}>Adj Qty</th>}
                            {seasonActive && <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#dc2626', borderBottom: `1px solid ${border}` }}>Adj Amt</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {brands.flatMap(brand => {
                            const allBRows = rows.filter(r => r.brand === brand)
                            const bRows = activeDropName ? allBRows.filter(r => r.drop_name === activeDropName) : allBRows
                            const dropStoreRows: { dropNum: number; dropName: string | null; store: string; dropRows: LedgerRow[] }[] = []
                            const seenKeys = new Set<string>()
                            for (const r of bRows) {
                              const key = `${r.drop_num}|${r.store}`
                              if (!seenKeys.has(key)) {
                                seenKeys.add(key)
                                dropStoreRows.push({ dropNum: r.drop_num, dropName: r.drop_name, store: r.store, dropRows: bRows.filter(x => x.drop_num === r.drop_num && x.store === r.store) })
                              }
                            }
                            return dropStoreRows.map(({ dropNum, dropName, store, dropRows }, rowIdx) => {
                              const activeRows = dropRows.filter(r => !r.is_cancelled)
                              const sUnits = activeRows.reduce((s, r) => s + (r.units ?? 0), 0)
                              const sInit  = activeRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                              const sDep   = activeRows.reduce((s, r) => s + (r.deposit ?? 0), 0)
                              const sBal   = activeRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                              const hasCancelled = dropRows.some(r => r.is_cancelled)
                              const rowCurrency = (activeRows[0]?.currency as Currency) ?? 'USD'
                              const invoiceNums = Array.from(new Set(activeRows.map(r => r.invoice_num).filter((n): n is string => !!n)))
                              const poNums = Array.from(new Set(activeRows.map(r => r.order_num).filter((n): n is string => !!n)))
                              const invoiceFileUrls = Array.from(new Set(activeRows.map(r => r.invoice_file_url).filter((u): u is string => !!u)))
                              const allInvFiles = Array.from(new Map([
                                ...activeRows.flatMap(r => (r.invoice_files ?? []).map(f => [f.url, f] as [string, {url:string;name:string}])),
                                ...invoiceFileUrls.map(u => [u, {url:u, name:'Invoice'}] as [string, {url:string;name:string}])
                              ]).values())
                              const allPackingSlips = activeRows.flatMap(r => r.packing_slips ?? [])
                              return (
                                <tr key={`${brand}|${dropNum}|${store}`}
                                  onClick={() => { setInvoiceBrand(brand); setInvoiceStoreFilter(store); setModal('invoice') }}
                                  title="Click to view invoice · Right-click to delete"
                                  style={{ cursor: 'pointer', borderBottom: `1px solid #f3f4f6` }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#faf8ff')}
                                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                                  onContextMenu={e => { e.preventDefault(); setRowCtxMenu({ x: e.clientX, y: e.clientY, rows: dropRows }); setRowCtxDelMode(false); setRowCtxDelPw(''); setRowCtxDelErr(false) }}>
                                  <td style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: purpleD, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {brand}
                                  </td>
                                  <td style={{ padding: '8px 10px', fontSize: 11, color: gray, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {`Log #${dropNum}`}{dropRows[0]?.drop_label ? ` · Drop ${dropRows[0].drop_label}` : ''}{dropName ? ` · ${dropName}` : ''}
                                  </td>
                                  <td style={{ padding: '8px 10px', fontWeight: 800, color: purpleD, whiteSpace: 'nowrap' }}>
                                    {store}{hasCancelled && <span style={{ fontSize: 9, fontWeight: 700, color: '#dc2626', marginLeft: 4 }}>🚫</span>}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                                    {poNums.length > 0 ? poNums.map(o => (
                                      <span key={o} style={{ fontSize: 10, color: '#6b21a8', fontWeight: 700, background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: 4, padding: '1px 5px', marginRight: 3, whiteSpace: 'nowrap' }}>{o}</span>
                                    )) : <span style={{ color: gray }}>—</span>}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                    {(allInvFiles.length === 0 && allPackingSlips.length === 0) && <span style={{ fontSize: 11, color: '#d1d5db' }}>—</span>}
                                    {allInvFiles.map((f, i) => (
                                      <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                                        style={{ color: purpleD, fontWeight: 700, fontSize: 13, textDecoration: 'none', display: 'inline-block', marginLeft: i > 0 ? 3 : 0 }}
                                        title={`Invoice: ${f.name}`}>📄</a>
                                    ))}
                                    {allPackingSlips.map((s, i) => (
                                      <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                                        style={{ color: '#0369a1', fontWeight: 700, fontSize: 13, textDecoration: 'none', display: 'inline-block', marginLeft: 3 }}
                                        title={`Packing Slip: ${s.name}`}>📦</a>
                                    ))}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{sUnits || '—'}</td>
                                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{fmt$(sInit, rowCurrency)}</td>
                                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#166534' }}>{fmt$(sDep, rowCurrency)}</td>
                                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: sBal > 0.001 ? '#dc2626' : '#166534' }}>{fmt$(sBal, rowCurrency)}</td>
                                  {seasonActive && (() => {
                                    const adj = activeRows.map(r => moduleAdjMap.get(r.id)).find(a => a != null) ?? null
                                    return (<>
                                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: adj?.qty != null ? '#dc2626' : '#9ca3af', fontSize: 12 }}>
                                        {adj?.qty != null ? adj.qty : '—'}
                                      </td>
                                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: adj?.amount != null ? '#dc2626' : '#9ca3af', fontSize: 12 }}>
                                        {adj?.amount != null ? fmt$(adj.amount, (activeRows[0]?.currency as Currency) ?? 'USD') : '—'}
                                      </td>
                                    </>)
                                  })()}
                                </tr>
                              )
                            })
                          })}
                        </tbody>
                        {/* Total Owed footer */}
                        {vRows.length > 1 && (
                          <tfoot>
                            <tr style={{ background: totBal > 0.001 ? '#fef2f2' : '#f0fdf4', borderTop: `2px solid ${border}` }}>
                              <td colSpan={seasonActive ? 9 : 9} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 800, color: totBal > 0.001 ? '#dc2626' : '#166534', textAlign: 'right' }}>
                                Total Owed
                              </td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 13, fontWeight: 900, color: totBal > 0.001 ? '#dc2626' : '#166534' }}>
                                {fmt$(totBal, (vRows[0]?.currency as Currency) ?? 'USD')}
                              </td>
                              {seasonActive && <td colSpan={2} />}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                      </div>{/* end sb-drop-table */}

                      {/* ── MOBILE CARDS ── */}
                      <div className="sb-drop-card">
                        {brands.flatMap(brand => {
                          const allBRows = rows.filter(r => r.brand === brand)
                          const bRows = activeDropName ? allBRows.filter(r => r.drop_name === activeDropName) : allBRows
                          const dropStoreKeys = new Set<string>()
                          const dropStoreList: { dropNum: number; dropName: string | null; store: string; dropRows: LedgerRow[] }[] = []
                          for (const r of bRows) {
                            const key = `${r.drop_num}|${r.store}`
                            if (!dropStoreKeys.has(key)) {
                              dropStoreKeys.add(key)
                              dropStoreList.push({ dropNum: r.drop_num, dropName: r.drop_name, store: r.store, dropRows: bRows.filter(x => x.drop_num === r.drop_num && x.store === r.store) })
                            }
                          }
                          return dropStoreList.map(({ dropNum, dropName, store, dropRows }) => {
                            const activeRows = dropRows.filter(r => !r.is_cancelled)
                            const sUnits = activeRows.reduce((s, r) => s + (r.units ?? 0), 0)
                            const sInit  = activeRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                            const sDep   = activeRows.reduce((s, r) => s + (r.deposit ?? 0), 0)
                            const sBal   = activeRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                            const rowCurrency = (activeRows[0]?.currency as Currency) ?? 'USD'
                            const invoiceNums = Array.from(new Set(activeRows.map(r => r.invoice_num).filter((n): n is string => !!n)))
                            const poNums = Array.from(new Set(activeRows.map(r => r.order_num).filter((n): n is string => !!n)))
                            const invoiceFileUrls = Array.from(new Set(activeRows.map(r => r.invoice_file_url).filter((u): u is string => !!u)))
                            const mSt = seasonActive ? (activeRows.map(r => moduleStatusMap.get(r.id)).find(s => s != null) ?? null) : null
                            return (
                              <div key={`m-${brand}|${dropNum}|${store}`}
                                onClick={() => { setInvoiceBrand(brand); setInvoiceStoreFilter(store); setModal('invoice') }}
                                style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                {/* Top row: brand + store + status */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontWeight: 800, fontSize: 13, color: purpleD }}>{brand}</span>
                                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: purpleD, background: '#ede9fe', borderRadius: 6, padding: '1px 7px' }}>{store}</span>
                                    {(() => {
                                      const mAdj = seasonActive ? (activeRows.map(r => moduleAdjMap.get(r.id)).find(a => a != null) ?? null) : null
                                      if (mAdj) return <span style={{ fontSize: 10, fontWeight: 800, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, padding: '1px 6px' }}>⚠️ Adj</span>
                                      return null
                                    })()}
                                  </div>
                                </div>
                                {/* Log # + Drop # + name */}
                                <div style={{ fontSize: 11, color: gray, marginBottom: 6 }}>
                                  Log #{dropNum}{dropRows[0]?.drop_label ? ` · Drop ${dropRows[0].drop_label}` : ''}{dropName ? ` · ${dropName}` : ''}
                                </div>
                                {/* Invoice + Order chips */}
                                {(invoiceNums.length > 0 || poNums.length > 0) && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                                    {invoiceNums.map(inv => (
                                      <span key={inv} style={{ fontSize: 10, color: '#1e40af', fontWeight: 700, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 5px' }}>{inv}</span>
                                    ))}
                                    {poNums.map(o => (
                                      <span key={o} style={{ fontSize: 10, color: '#6b21a8', fontWeight: 700, background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: 4, padding: '1px 5px' }}>{o}</span>
                                    ))}
                                    {invoiceFileUrls.map((url, i) => (
                                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                        style={{ fontSize: 10, fontWeight: 700, color: purpleD, background: '#faf5ff', border: `1px solid ${border}`, borderRadius: 4, padding: '1px 5px', textDecoration: 'none' }}>📄 PDF</a>
                                    ))}
                                  </div>
                                )}
                                {/* Financials row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
                                  {[
                                    { label: 'Units', value: sUnits || '—' },
                                    { label: 'Total', value: fmt$(sInit, rowCurrency) },
                                    { label: 'Deposit', value: fmt$(sDep, rowCurrency) },
                                    { label: 'Balance', value: fmt$(sBal, rowCurrency), red: sBal > 0.001 },
                                  ].map(({ label, value, red }) => (
                                    <div key={label} style={{ background: '#f8f7ff', borderRadius: 6, padding: '4px 6px', textAlign: 'center' }}>
                                      <div style={{ fontSize: 9, color: gray, fontWeight: 600 }}>{label}</div>
                                      <div style={{ fontSize: 11, fontWeight: 800, color: red ? '#dc2626' : '#1f2937' }}>{value}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })
                        })}
                        {/* Total footer on mobile */}
                        {vRows.length > 1 && (
                          <div style={{ background: totBal > 0.001 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${totBal > 0.001 ? '#fca5a5' : '#86efac'}`, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: totBal > 0.001 ? '#dc2626' : '#166534' }}>Total Owed</span>
                            <span style={{ fontSize: 14, fontWeight: 900, color: totBal > 0.001 ? '#dc2626' : '#166534' }}>{fmt$(totBal, (vRows[0]?.currency as Currency) ?? 'USD')}</span>
                          </div>
                        )}
                      </div>{/* end sb-drop-card */}

                    </div>
                  )
                })
              })()}

              {/* Show "clear filter" hint when a brand is selected */}
              {activeBrand && (
                <div style={{ textAlign: 'center', paddingBottom: 20 }}>
                  <button onClick={() => setActiveBrand('')}
                    style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '6px 16px', fontSize: 12, color: gray, cursor: 'pointer' }}>
                    ✕ Clear filter — show all brands
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── New Entry Modal ──────────────────────────────────────────────────── */}
      {modal === 'new-entry' && (
        <div className="modal-bg">
          <div className="modal-box" style={{ maxWidth: 820 }}>
            <div className="modal-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: purpleD }}>
                    {activeBrand ?? 'New Drop'}
                  </span>
                  {activeBrand && formVendorId && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 20, padding: '2px 8px' }}>
                      {formVendorId}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: gray }}>{activeBrand ? `New Drop — ${season}` : `Select a brand for ${season}`}</div>
              </div>
              <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">

              {/* Brand picker — shown when no brand selected yet */}
              {!activeBrand && (
                <div style={{ marginBottom: 16 }}>
                  <label style={lbl}>Brand</label>
                  <div ref={modalBrandRef} style={{ position: 'relative' }}>
                    <input
                      value={modalBrandQ}
                      onChange={e => { setModalBrandQ(e.target.value); setShowModalBrandDrop(true) }}
                      onFocus={() => setShowModalBrandDrop(true)}
                      placeholder="Search or type a brand name…"
                      autoFocus
                      style={{ ...inp, fontSize: 13 }}
                    />
                    {showModalBrandDrop && modalBrandQ.trim() && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 50, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                        {modalBrandSuggs.length > 0 ? modalBrandSuggs.map(b => (
                          <div key={b}
                            onClick={() => {
                              const existing = rows.filter(r => r.brand === b)
                              const maxDrop = existing.length > 0 ? Math.max(...existing.map(r => r.drop_num)) : 0
                              setActiveBrand(b); setFormDrop(maxDrop + 1)
                              setModalBrandQ(''); setShowModalBrandDrop(false)
                              // Auto-set vendor or prompt picker
                              const vids = brandToVendors.get(b)
                              if (vids && vids.length > 1) {
                                setVendorPickerBrand(b)
                                setVendorPickerCandidates(vids)
                                setVendorPickerOnSelect(() => (vid: string) => { setFormVendorId(vid); setVendorPickerBrand(null) })
                                setFormVendorId(null)
                              } else {
                                setFormVendorId(vids?.[0] ?? null)
                              }
                            }}
                            style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#ede9fe')}
                            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                            <span>{b}</span>
                            {brandsInSeason.includes(b) && (
                              <span style={{ fontSize: 10, color: purpleD, fontWeight: 700, background: '#ede9fe', borderRadius: 6, padding: '1px 6px' }}>in {season}</span>
                            )}
                          </div>
                        )) : (
                          <div style={{ padding: '8px 12px' }}>
                            <div style={{ fontSize: 11, color: gray, marginBottom: 6 }}>No match — create new?</div>
                            <button
                              onClick={() => {
                                const b = modalBrandQ.trim()
                                setActiveBrand(b); setFormDrop(1); setModalBrandQ(''); setShowModalBrandDrop(false)
                                const vids = brandToVendors.get(b)
                                if (vids && vids.length > 1) {
                                  setVendorPickerBrand(b); setVendorPickerCandidates(vids)
                                  setVendorPickerOnSelect(() => (vid: string) => { setFormVendorId(vid); setVendorPickerBrand(null) })
                                  setFormVendorId(null)
                                } else { setFormVendorId(vids?.[0] ?? null) }
                              }}
                              style={{ background: purple, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              + &ldquo;{modalBrandQ.trim()}&rdquo;
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Only show form once brand is chosen */}
              {activeBrand && <>

              {/* Brand + Vendor ID + Drop row */}
              <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
                {/* Brand with autocomplete */}
                <div ref={formBrandRef} style={{ position: 'relative' }}>
                  <label style={lbl}>Brand</label>
                  <input
                    value={activeBrand}
                    onChange={e => { setActiveBrand(e.target.value); setShowFormBrandDrop(true); setFormBrandHi(-1) }}
                    onFocus={() => { setShowFormBrandDrop(true); setFormBrandHi(-1) }}
                    placeholder="Brand name"
                    style={{ ...inp, fontSize: 13 }}
                    onKeyDown={e => {
                      const q = activeBrand.toLowerCase()
                      const allB = Array.from(new Set(liveVendors.map(v => v.brand))).sort()
                      const suggs = [...allB.filter(b => b.toLowerCase().startsWith(q) && b !== activeBrand), ...allB.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q) && b !== activeBrand)].slice(0, 8)
                      if (!showFormBrandDrop || suggs.length === 0) return
                      if (e.key === 'ArrowDown') { e.preventDefault(); setFormBrandHi(h => Math.min(h + 1, suggs.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setFormBrandHi(h => Math.max(h - 1, 0)) }
                      else if (e.key === 'Enter' && formBrandHi >= 0) {
                        e.preventDefault(); const b = suggs[formBrandHi]; setActiveBrand(b); setShowFormBrandDrop(false); setFormBrandHi(-1)
                        const vids = brandToVendors.get(b); if (vids && vids.length === 1) setFormVendorId(vids[0])
                      } else if (e.key === 'Escape') { setShowFormBrandDrop(false); setFormBrandHi(-1) }
                    }}
                  />
                  {showFormBrandDrop && (() => {
                    const q = activeBrand.toLowerCase()
                    const allB = Array.from(new Set(liveVendors.map(v => v.brand))).sort()
                    const suggs = [...allB.filter(b => b.toLowerCase().startsWith(q) && b !== activeBrand), ...allB.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q) && b !== activeBrand)].slice(0, 8)
                    return suggs.length > 0 ? (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 60, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                        {suggs.map((b, bi) => (
                          <div key={b}
                            onMouseDown={e => { e.preventDefault(); setActiveBrand(b); setShowFormBrandDrop(false); setFormBrandHi(-1)
                              const vids = brandToVendors.get(b)
                              if (vids && vids.length === 1) setFormVendorId(vids[0])
                            }}
                            onMouseEnter={() => setFormBrandHi(bi)}
                            style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6', background: bi === formBrandHi ? '#ede9fe' : '#fff' }}>
                            {b}
                          </div>
                        ))}
                      </div>
                    ) : null
                  })()}
                </div>
                {/* Vendor ID with autocomplete */}
                <div ref={formVendorRef} style={{ position: 'relative' }}>
                  <label style={lbl}>Vendor ID</label>
                  <input
                    value={formVendorId ?? ''}
                    onChange={e => { setFormVendorId(e.target.value || null); setShowFormVendorDrop(true); setFormVendorHi(-1) }}
                    onFocus={() => { setShowFormVendorDrop(true); setFormVendorHi(-1) }}
                    placeholder="e.g. 1984 by Ladida"
                    style={{ ...inp, fontSize: 13 }}
                    onKeyDown={e => {
                      const q = (formVendorId ?? '').toLowerCase()
                      const allV = Array.from(new Set(liveVendors.map(v => v.vendor_id).filter(Boolean))).sort() as string[]
                      const suggs = allV.filter(v => v.toLowerCase().includes(q) && v !== formVendorId).slice(0, 8)
                      if (!showFormVendorDrop || suggs.length === 0) return
                      if (e.key === 'ArrowDown') { e.preventDefault(); setFormVendorHi(h => Math.min(h + 1, suggs.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setFormVendorHi(h => Math.max(h - 1, 0)) }
                      else if (e.key === 'Enter' && formVendorHi >= 0) {
                        e.preventDefault(); setFormVendorId(suggs[formVendorHi]); setShowFormVendorDrop(false); setFormVendorHi(-1)
                      } else if (e.key === 'Escape') { setShowFormVendorDrop(false); setFormVendorHi(-1) }
                    }}
                  />
                  {showFormVendorDrop && (() => {
                    const q = (formVendorId ?? '').toLowerCase()
                    const allV = Array.from(new Set(liveVendors.map(v => v.vendor_id).filter(Boolean))).sort() as string[]
                    const suggs = allV.filter(v => v.toLowerCase().includes(q) && v !== formVendorId).slice(0, 8)
                    return suggs.length > 0 ? (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 60, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                        {suggs.map((v, vi) => (
                          <div key={v}
                            onMouseDown={e => { e.preventDefault(); setFormVendorId(v); setShowFormVendorDrop(false); setFormVendorHi(-1) }}
                            onMouseEnter={() => setFormVendorHi(vi)}
                            style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6', background: vi === formVendorHi ? '#ede9fe' : '#fff' }}>
                            {v}
                          </div>
                        ))}
                      </div>
                    ) : null
                  })()}
                </div>
                {/* Log # (auto-incrementing internal number) */}
                <div>
                  <label style={lbl}>Log #</label>
                  <input type="number" min={1} value={formDrop}
                    onChange={e => setFormDrop(parseInt(e.target.value) || 1)}
                    style={{ ...inp, width: 70 }} />
                </div>
                {/* Drop # (user-defined label e.g. "Drop 1", "RTW Drop 2") */}
                <div>
                  <label style={lbl}>Drop #</label>
                  <input type="text" value={formStores[0]?.drop_label ?? ''}
                    placeholder="e.g. Drop 1"
                    onChange={e => setFormStores(prev => prev.map(p => ({ ...p, drop_label: e.target.value })))}
                    style={{ ...inp, width: 110 }} />
                </div>
              </div>

              {/* Per-store blocks */}
              {formStores.map((entry, idx) => {
                const sym = CURRENCY_SYMBOLS[entry.currency]
                const upd = (patch: Partial<StoreEntry>) =>
                  setFormStores(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p))
                return (
                  <div key={entry.store} style={{ border: `2px solid ${border}`, borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                    {/* Store header bar */}
                    <div style={{ background: `linear-gradient(90deg, ${purpleD} 0%, ${purple} 100%)`, padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 900, fontSize: 13, color: '#fff', letterSpacing: '0.08em' }}>{entry.store}</span>
                      <select value={entry.currency} onChange={e => upd({ currency: e.target.value as Currency })}
                        style={{ fontSize: 11, fontWeight: 800, border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 5, padding: '3px 6px', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', width: 58 }}>
                        <option value="USD" style={{ color: purpleD, background: '#fff' }}>USD</option>
                        <option value="EUR" style={{ color: purpleD, background: '#fff' }}>EUR</option>
                      </select>
                    </div>
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Row 1: Order # + Drop # + Drop Name */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lbl}>Order #</label>
                          <input value={entry.order_num} placeholder="ORD-001"
                            onChange={e => upd({ order_num: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Drop #</label>
                          <input value={entry.drop_label} placeholder="e.g. Drop 1"
                            onChange={e => upd({ drop_label: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Drop Name</label>
                          {(entry.drop_name && !dropNamesInSeason.includes(entry.drop_name)) ? (
                            /* Custom (typed) value — show text input + back-to-list button */
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input value={entry.drop_name}
                                onChange={e => upd({ drop_name: e.target.value })} style={{ ...inp, flex: 1 }} />
                              <button type="button" title="Pick from list"
                                onClick={() => upd({ drop_name: '' })}
                                style={{ background: '#ede9fe', border: `1px solid ${border}`, borderRadius: 5, padding: '0 7px', cursor: 'pointer', fontSize: 11, color: purpleD, fontWeight: 700 }}>↩</button>
                            </div>
                          ) : (
                            <>
                              <select value={entry.drop_name}
                                onChange={e => {
                                  if (e.target.value === '__new__') upd({ drop_name: '\0' })
                                  else upd({ drop_name: e.target.value })
                                }}
                                style={{ ...inp, cursor: 'pointer' }}>
                                <option value="">— None —</option>
                                {dropNamesInSeason.map(dn => <option key={dn} value={dn}>{dn}</option>)}
                                <option value="__new__">+ New name…</option>
                              </select>
                              {entry.drop_name === '\0' && (
                                <input autoFocus placeholder="Type new drop name…"
                                  onChange={e => upd({ drop_name: e.target.value })}
                                  style={{ ...inp, marginTop: 4 }} />
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {/* Row 2: Units + Initial Total */}
                      <div className="sb-financials" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lbl}>Units</label>
                          <input type="number" value={entry.units} placeholder="0"
                            onChange={e => upd({ units: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Initial Total ({sym})</label>
                          <input type="number" value={entry.initial_total} placeholder="0.00" step="0.01"
                            onChange={e => upd({ initial_total: e.target.value })} style={inp} />
                        </div>
                      </div>
                      {/* Row 3: Deposit + Duties + Shipping + Payment Date */}
                      <div className="sb-financials" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lbl}>Deposit ({sym})</label>
                          <input type="number" value={entry.deposit} placeholder="0.00" step="0.01"
                            onChange={e => upd({ deposit: e.target.value })} style={inp}
                            disabled={!canPay} title={!canPay ? 'Payment access restricted' : undefined} />
                        </div>
                        <div>
                          <label style={lbl}>Duties ({sym})</label>
                          <input type="number" value={entry.duties} placeholder="0.00" step="0.01"
                            onChange={e => upd({ duties: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Shipping ({sym})</label>
                          <input type="number" value={entry.shipping} placeholder="0.00" step="0.01"
                            onChange={e => upd({ shipping: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>CC Fee ({sym})</label>
                          <input type="number" value={entry.cc_fee} placeholder="0.00" step="0.01"
                            onChange={e => upd({ cc_fee: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Payment Date</label>
                          <input type="date" value={entry.payment_date}
                            onChange={e => upd({ payment_date: e.target.value })} style={inp}
                            disabled={!canPay} title={!canPay ? 'Payment access restricted' : undefined} />
                        </div>
                      </div>
                      {/* Row 4: Comment */}
                      <div>
                        <label style={lbl}>Comment</label>
                        <input value={entry.comment} placeholder="Optional note"
                          onChange={e => upd({ comment: e.target.value })} style={inp} />
                      </div>
                      {/* Live balance preview */}
                      {(entry.initial_total || entry.deposit || entry.duties) && (() => {
                        const init = parseFloat(entry.initial_total) || 0
                        const dep  = parseFloat(entry.deposit) || 0
                        const dut  = parseFloat(entry.duties) || 0
                        const shp  = parseFloat(entry.shipping) || 0
                        const ccf  = parseFloat(entry.cc_fee) || 0
                        const bal  = init - dep + dut + shp + ccf
                        return (
                          <div style={{ fontSize: 12, color: bal > 0.001 ? '#dc2626' : '#166534', fontWeight: 700 }}>
                            Balance Due: {sym}{bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setModal('none')} disabled={saving}
                  style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={saveNewEntry} disabled={saving}
                  style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Drop'}
                </button>
              </div>
              </>}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Entry Modal ─────────────────────────────────────────────────── */}
      {modal === 'edit-entry' && editRow && (() => {
        const siblingStore = STORES.find(s => s !== editRow.store)
        const siblingExists = siblingStore
          ? rows.some(r => r.brand === editRow.brand && r.drop_num === editRow.drop_num && r.store === siblingStore)
          : true
        const existingDrops = rows.filter(r => r.brand === editRow.brand)
        const maxDrop = existingDrops.length > 0 ? Math.max(...existingDrops.map(r => r.drop_num)) : 0
        const entry = formStores[0]
        const sym = CURRENCY_SYMBOLS[entry.currency]
        const upd = (patch: Partial<StoreEntry>) =>
          setFormStores(prev => prev.map((p, i) => i === 0 ? { ...p, ...patch } : p))
        const init = parseFloat(entry.initial_total) || 0
        const dep  = parseFloat(entry.deposit) || 0
        const dut  = parseFloat(entry.duties) || 0
        const shpLive = parseFloat(entry.shipping) || 0
        const ccfLive = parseFloat(entry.cc_fee) || 0
        const liveBal = init - dep + dut + shpLive + ccfLive
        const isCancelled = editRow.is_cancelled ?? false

        return (
          <div className="modal-bg">
            <div className="modal-box" style={{ maxWidth: 820 }}>

              {/* Header */}
              <div className="modal-head" style={{ background: isCancelled ? '#fef2f2' : '#fff' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: isCancelled ? '#dc2626' : purpleD }}>
                      {editRow.brand}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: purpleD, borderRadius: 20, padding: '2px 8px' }}>{editRow.store}</span>
                    {isCancelled && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 20, padding: '2px 8px' }}>🚫 Cancelled</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: gray, marginTop: 2 }}>
                    Log #{editRow.drop_num}{editRow.drop_label ? ` · Drop ${editRow.drop_label}` : ''}{editRow.drop_name ? ` · ${editRow.drop_name}` : ''} · {season}
                  </div>
                </div>
                <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
              </div>

              <div className="modal-body sb-edit-flex" style={{ opacity: isCancelled ? 0.7 : 1, display: 'flex', gap: 0, padding: 0 }}>
              {/* ── LEFT: edit form ── */}
              <div className="sb-edit-form" style={{ flex: 1, minWidth: 0, padding: '16px 18px', borderRight: `2px solid #ede9fe` }}>

                {/* Section 1: Reference fields */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: gray, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Reference</div>
                  <div className="sb-edit-grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={lbl}>Order #</label>
                      <input value={entry.order_num} placeholder="ORD-001"
                        onChange={e => upd({ order_num: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Drop Name</label>
                      {(entry.drop_name && entry.drop_name !== '\0' && !dropNamesInSeason.includes(entry.drop_name)) ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input value={entry.drop_name}
                            onChange={e => upd({ drop_name: e.target.value })} style={{ ...inp, flex: 1 }} />
                          <button type="button" title="Pick from list" onClick={() => upd({ drop_name: '' })}
                            style={{ background: '#ede9fe', border: `1px solid ${border}`, borderRadius: 5, padding: '0 7px', cursor: 'pointer', fontSize: 11, color: purpleD, fontWeight: 700 }}>↩</button>
                        </div>
                      ) : (
                        <>
                          <select value={entry.drop_name}
                            onChange={e => {
                              if (e.target.value === '__new__') upd({ drop_name: '\0' })
                              else upd({ drop_name: e.target.value })
                            }}
                            style={{ ...inp, cursor: 'pointer' }}>
                            <option value="">— None —</option>
                            {dropNamesInSeason.map(dn => <option key={dn} value={dn}>{dn}</option>)}
                            <option value="__new__">+ New name…</option>
                          </select>
                          {entry.drop_name === '\0' && (
                            <input autoFocus placeholder="Type new drop name…"
                              onChange={e => upd({ drop_name: e.target.value })}
                              style={{ ...inp, marginTop: 4 }} />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Vendor ID + Brand editable row */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div ref={editVendorRef} style={{ position: 'relative' }}>
                      <label style={lbl}>Vendor ID</label>
                      <input
                        value={editRow.vendor_id ?? ''}
                        placeholder="e.g. 1984 by Ladida"
                        onFocus={() => { setShowEditVendorDrop(true); setEditVendorHi(-1) }}
                        onChange={async e => {
                          const newVid = e.target.value
                          setEditRow({ ...editRow, vendor_id: newVid || null })
                          setShowEditVendorDrop(true); setEditVendorHi(-1)
                          await supabase.from('season_ledger').update({ vendor_id: newVid || null }).eq('id', editRow.id)
                        }}
                        onKeyDown={e => {
                          const q = (editRow.vendor_id ?? '').toLowerCase()
                          const allV = Array.from(new Set(liveVendors.map(v => v.vendor_id).filter(Boolean))).sort() as string[]
                          const suggs = allV.filter(v => v.toLowerCase().includes(q) && v !== editRow.vendor_id).slice(0, 8)
                          if (!showEditVendorDrop || suggs.length === 0) return
                          if (e.key === 'ArrowDown') { e.preventDefault(); setEditVendorHi(h => Math.min(h + 1, suggs.length - 1)) }
                          else if (e.key === 'ArrowUp') { e.preventDefault(); setEditVendorHi(h => Math.max(h - 1, 0)) }
                          else if (e.key === 'Enter' && editVendorHi >= 0) {
                            e.preventDefault(); const v = suggs[editVendorHi]
                            setEditRow({ ...editRow, vendor_id: v }); setShowEditVendorDrop(false); setEditVendorHi(-1)
                            supabase.from('season_ledger').update({ vendor_id: v }).eq('id', editRow.id)
                          } else if (e.key === 'Escape') { setShowEditVendorDrop(false); setEditVendorHi(-1) }
                        }}
                        style={inp} />
                      {showEditVendorDrop && (() => {
                        const q = (editRow.vendor_id ?? '').toLowerCase()
                        const allV = Array.from(new Set(liveVendors.map(v => v.vendor_id).filter(Boolean))).sort() as string[]
                        const suggs = allV.filter(v => v.toLowerCase().includes(q) && v !== editRow.vendor_id).slice(0, 8)
                        return suggs.length > 0 ? (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 60, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                            {suggs.map((v, vi) => (
                              <div key={v}
                                onMouseDown={async e => {
                                  e.preventDefault()
                                  setEditRow({ ...editRow, vendor_id: v }); setShowEditVendorDrop(false); setEditVendorHi(-1)
                                  await supabase.from('season_ledger').update({ vendor_id: v }).eq('id', editRow.id)
                                }}
                                onMouseEnter={() => setEditVendorHi(vi)}
                                style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, borderBottom: '1px solid #f3f4f6', background: vi === editVendorHi ? '#ede9fe' : '#fff' }}>
                                {v}
                              </div>
                            ))}
                          </div>
                        ) : null
                      })()}
                    </div>
                    <div ref={editBrandRef} style={{ position: 'relative' }}>
                      <label style={lbl}>Brand</label>
                      <input
                        value={editRow.brand}
                        placeholder="Brand name"
                        onFocus={() => { setShowEditBrandDrop(true); setEditBrandHi(-1) }}
                        onChange={async e => {
                          const newBrand = e.target.value
                          setEditRow({ ...editRow, brand: newBrand })
                          setShowEditBrandDrop(true); setEditBrandHi(-1)
                          await supabase.from('season_ledger').update({ brand: newBrand }).eq('id', editRow.id)
                        }}
                        onKeyDown={e => {
                          const q = editRow.brand.toLowerCase()
                          const allB = Array.from(new Set(liveVendors.map(v => v.brand))).sort()
                          const suggs = [...allB.filter(b => b.toLowerCase().startsWith(q) && b !== editRow.brand), ...allB.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q) && b !== editRow.brand)].slice(0, 8)
                          if (!showEditBrandDrop || suggs.length === 0) return
                          if (e.key === 'ArrowDown') { e.preventDefault(); setEditBrandHi(h => Math.min(h + 1, suggs.length - 1)) }
                          else if (e.key === 'ArrowUp') { e.preventDefault(); setEditBrandHi(h => Math.max(h - 1, 0)) }
                          else if (e.key === 'Enter' && editBrandHi >= 0) {
                            e.preventDefault(); const b = suggs[editBrandHi]
                            setEditRow({ ...editRow, brand: b }); setShowEditBrandDrop(false); setEditBrandHi(-1)
                            supabase.from('season_ledger').update({ brand: b }).eq('id', editRow.id)
                          } else if (e.key === 'Escape') { setShowEditBrandDrop(false); setEditBrandHi(-1) }
                        }}
                        style={inp} />
                      {showEditBrandDrop && (() => {
                        const q = editRow.brand.toLowerCase()
                        const allB = Array.from(new Set(liveVendors.map(v => v.brand))).sort()
                        const suggs = [...allB.filter(b => b.toLowerCase().startsWith(q) && b !== editRow.brand), ...allB.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q) && b !== editRow.brand)].slice(0, 8)
                        return suggs.length > 0 ? (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 60, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                            {suggs.map((b, bi) => (
                              <div key={b}
                                onMouseDown={async e => {
                                  e.preventDefault()
                                  setEditRow({ ...editRow, brand: b }); setShowEditBrandDrop(false); setEditBrandHi(-1)
                                  await supabase.from('season_ledger').update({ brand: b }).eq('id', editRow.id)
                                }}
                                onMouseEnter={() => setEditBrandHi(bi)}
                                style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, borderBottom: '1px solid #f3f4f6', background: bi === editBrandHi ? '#ede9fe' : '#fff' }}>
                                {b}
                              </div>
                            ))}
                          </div>
                        ) : null
                      })()}
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: border, marginBottom: 14 }} />

                {/* Section 2: Financials — 2 column layout */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: gray, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Financials</div>
                  <div className="sb-financials-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {/* Left column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 6 }}>
                        <div>
                          <label style={lbl}>Cur</label>
                          <select value={entry.currency} onChange={e => upd({ currency: e.target.value as Currency })}
                            style={{ fontSize: 12, fontWeight: 700, border: '1.5px solid #d1d5db', borderRadius: 6, padding: '5px 4px', background: '#f5f3ff', color: purpleD, cursor: 'pointer', width: '100%' }}>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </div>
                        <div>
                          <label style={lbl}>Units</label>
                          <input type="number" value={entry.units} placeholder="0"
                            onChange={e => upd({ units: e.target.value })} style={inp} />
                        </div>
                      </div>
                      <div>
                        <label style={lbl}>Initial Total ({sym})</label>
                        <input type="number" value={entry.initial_total} step="0.01" placeholder="0.00"
                          onChange={e => upd({ initial_total: e.target.value })} style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Deposit ({sym})</label>
                        <input type="number" value={entry.deposit} step="0.01" placeholder="0.00"
                          onChange={e => upd({ deposit: e.target.value })} style={inp}
                          disabled={!canPay} title={!canPay ? 'Payment access restricted' : undefined} />
                      </div>
                    </div>
                    {/* Right column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lbl}>Duties ({sym})</label>
                          <input type="number" value={entry.duties} step="0.01" placeholder="0.00"
                            onChange={e => upd({ duties: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Shipping ({sym})</label>
                          <input type="number" value={entry.shipping} step="0.01" placeholder="0.00"
                            onChange={e => upd({ shipping: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>CC Fee ({sym})</label>
                          <input type="number" value={entry.cc_fee} step="0.01" placeholder="0.00"
                            onChange={e => upd({ cc_fee: e.target.value })} style={inp} />
                        </div>
                      </div>
                      <div>
                        <label style={lbl}>Payment Date</label>
                        <input type="date" value={entry.payment_date}
                          onChange={e => upd({ payment_date: e.target.value })} style={inp}
                          disabled={!canPay} title={!canPay ? 'Payment access restricted' : undefined} />
                      </div>
                      {/* Live balance — right column bottom */}
                      <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                        <label style={{ ...lbl, color: liveBal > 0.001 ? '#dc2626' : '#166534' }}>Balance Due</label>
                        <div style={{ fontSize: 15, fontWeight: 900, color: liveBal > 0.001 ? '#dc2626' : '#166534', padding: '7px 0' }}>
                          {sym}{liveBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Comment — full width */}
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Comment</label>
                  <input value={entry.comment} placeholder="Optional note"
                    onChange={e => upd({ comment: e.target.value })} style={inp} />
                </div>

                {/* Order PDF attachment */}
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Order PDF</label>
                  <InvoiceAttachment row={editRow} onUpdated={async () => {
                    await fetchRows(season, user!)
                    const { data } = await supabase.from('season_ledger').select('*').eq('id', editRow.id).single()
                    if (data) setEditRow(data as LedgerRow)
                  }} />
                </div>

                {/* Invoice PDF(s) only — packing slips moved to side panel */}

              </div>{/* end left col */}

              {/* ── RIGHT: side panel ── */}
              {(() => {
                const adj = moduleAdjMap.get(editRow.id) ?? null
                const createdAt = editRow.created_at ? new Date(editRow.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
                const updatedAt = editRow.updated_at ? new Date(editRow.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
                const slips = editRow.packing_slips ?? []
                const panelLbl: React.CSSProperties = { fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: gray, display: 'block', marginBottom: 2 }
                const sectionHead = (color: string, borderColor: string): React.CSSProperties => ({
                  fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em',
                  color, borderBottom: `1.5px solid ${borderColor}`, paddingBottom: 4, marginBottom: 7, marginTop: 14,
                })
                return (
                  <div className="sb-edit-panel" style={{ width: 200, minWidth: 200, background: '#faf8ff', padding: '14px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', borderRadius: '0 0 12px 0' }}>

                    {/* Invoice # / Packing Slips */}
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#0369a1', borderBottom: '1.5px solid #bae6fd', paddingBottom: 4, marginBottom: 7 }}>📦 Invoice #</div>
                    <PackingSlipAttachment row={editRow} onUpdated={async () => {
                      await fetchRows(season, user!)
                      const { data } = await supabase.from('season_ledger').select('*').eq('id', editRow.id).single()
                      if (data) setEditRow(data as LedgerRow)
                    }} />

                    {/* PO # from active season module */}
                    {(() => {
                      const po = seasonActive ? modulePOMap.get(editRow.id) : null
                      if (!po) return null
                      return (
                        <>
                          <div style={sectionHead('#92400e', '#fcd34d')}>🔗 PO #</div>
                          <span style={{ fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 4, padding: '3px 8px', display: 'inline-block' }}>{po}</span>
                        </>
                      )
                    })()}

                    {/* Adjustments */}
                    {seasonActive && adj && (adj.qty != null || adj.amount != null) && (
                      <>
                        <div style={sectionHead('#dc2626', '#fca5a5')}>⚠️ Adjustments</div>
                        {adj.qty != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0' }}>
                            <span style={{ color: gray, fontSize: 10 }}>Qty Adj</span>
                            <span style={{ fontWeight: 700, color: '#dc2626' }}>{adj.qty > 0 ? '+' : ''}{adj.qty} units</span>
                          </div>
                        )}
                        {adj.amount != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0' }}>
                            <span style={{ color: gray, fontSize: 10 }}>Amt Adj</span>
                            <span style={{ fontWeight: 700, color: '#dc2626' }}>{adj.amount > 0 ? '+' : ''}{fmt$(Math.abs(adj.amount), editRow.currency as Currency)}</span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Activity Log */}
                    <div style={sectionHead(gray, border)}>📋 Activity</div>
                    {createdAt && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: gray, padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <span>Created</span><span>{createdAt}</span>
                      </div>
                    )}
                    {editRow.deposit && (editRow.payment_date || editRow.deposit) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: gray, padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <span>Deposit saved</span><span>{editRow.payment_date ? new Date(editRow.payment_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</span>
                      </div>
                    )}
                    {slips.map((s, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: gray, padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <span>Slip added</span>
                        <span>{new Date(s.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    ))}
                    {updatedAt && updatedAt !== createdAt && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: gray, padding: '3px 0' }}>
                        <span>Last updated</span><span>{updatedAt}</span>
                      </div>
                    )}

                  </div>
                )
              })()}
              </div>{/* end modal-body flex row */}

              {/* ── Sticky footer ── */}
              <div style={{ flexShrink: 0, borderTop: `1px solid #ede9fe`, padding: '10px 16px', background: '#fff', display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', borderRadius: '0 0 12px 12px' }}>
                {/* Left: quick-add + cancel */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!siblingExists && siblingStore && (
                    <button
                      onClick={() => {
                        if (cutoffInEffect && !isAdmin) { alert('⚠️ Cut-Off is in effect.\n\nPlease reach out to Manager to approve logging this invoice.'); return }
                        setModal('none'); setActiveBrand(editRow.brand)
                        setFormDrop(editRow.drop_num); setFormStores([blankEntry(siblingStore)]); setModal('new-entry')
                      }}
                      style={{ background: '#ede9fe', color: purpleD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      + Log {siblingStore}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (cutoffInEffect && !isAdmin) { alert('⚠️ Cut-Off is in effect.\n\nPlease reach out to Manager to approve logging this invoice.'); return }
                      setModal('none'); setActiveBrand(editRow.brand)
                      setFormDrop(maxDrop + 1); setFormStores(STORES.map(blankEntry)); setModal('new-entry')
                    }}
                    style={{ background: '#ede9fe', color: purpleD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    + Drop {maxDrop + 1}
                  </button>
                  <button
                    onClick={async () => { await toggleCancelled(editRow); setModal('none') }}
                    style={{ background: isCancelled ? '#f0fdf4' : '#fff5f5', color: isCancelled ? '#166534' : '#dc2626', border: `1.5px solid ${isCancelled ? '#86efac' : '#fca5a5'}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {isCancelled ? '✓ Uncancel' : '🚫 Cancel Drop'}
                  </button>
                </div>
                {/* Right: delete + dismiss + save */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {!editDelMode ? (
                    <button onClick={() => { setEditDelMode(true); setEditDelPw(''); setEditDelErr(false) }} disabled={saving}
                      style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      🗑 Delete
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder="type 'delete'"
                        value={editDelPw}
                        onChange={e => { setEditDelPw(e.target.value); setEditDelErr(false) }}
                        onKeyDown={e => { if (e.key === 'Enter') deleteEditRow(); if (e.key === 'Escape') { setEditDelMode(false); setEditDelPw('') } }}
                        autoFocus
                        style={{ border: `1.5px solid ${editDelErr ? '#ef4444' : '#fca5a5'}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, width: 120, outline: 'none', background: '#fff5f5', color: '#b91c1c', fontWeight: 600 }}
                      />
                      <button onClick={deleteEditRow} disabled={saving}
                        style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Confirm
                      </button>
                      <button onClick={() => { setEditDelMode(false); setEditDelPw(''); setEditDelErr(false) }}
                        style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#9ca3af', padding: '2px 4px' }}>✕</button>
                    </div>
                  )}
                  <button onClick={() => { setModal('none'); setEditDelMode(false); setEditDelPw('') }} disabled={saving}
                    style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Dismiss
                  </button>
                  <button onClick={saveEdit} disabled={saving}
                    style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '7px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>

            </div>
          </div>
        )
      })()}

      {/* ── Invoice Modal ───────────────────────────────────────────────────── */}
      {modal === 'invoice' && (invoiceBrand || invoiceVendorBrands) && (() => {
        const activeBrands = invoiceVendorBrands ?? (invoiceBrand ? [invoiceBrand] : [])
        const iRows = rows.filter(r => activeBrands.includes(r.brand))
        const storesToShow = invoiceStoreFilter
          ? [invoiceStoreFilter]
          : STORES.filter(s => iRows.some(r => r.store === s))
        const iDrops = Array.from(new Set(iRows.map(r => r.drop_num))).sort((a, b) => a - b)
        const sideBySide = !invoiceStoreFilter && storesToShow.length > 1
        const invoiceTitle = invoiceVendorBrands
          ? (invoiceVendorBrands.length === 1 ? invoiceVendorBrands[0] : `${invoiceVendorBrands[0]} +${invoiceVendorBrands.length - 1}`)
          : (invoiceBrand ?? '')

        return (
          <div className="modal-bg">
            <div className="modal-box" style={{ maxWidth: sideBySide ? 860 : 520 }}>
              <div className="modal-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: purpleD }}>📄 {invoiceTitle}</div>
                  <div style={{ fontSize: 12, color: gray }}>{season}</div>
                  {/* Store tabs */}
                  <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                    <button
                      onClick={() => setInvoiceStoreFilter(null)}
                      style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${invoiceStoreFilter === null ? purpleD : border}`, background: invoiceStoreFilter === null ? purpleD : '#fff', color: invoiceStoreFilter === null ? '#fff' : gray, cursor: 'pointer' }}>
                      Both
                    </button>
                    {STORES.filter(s => iRows.some(r => r.store === s)).map(s => (
                      <button key={s}
                        onClick={() => setInvoiceStoreFilter(s)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${invoiceStoreFilter === s ? purpleD : border}`, background: invoiceStoreFilter === s ? purpleD : '#fff', color: invoiceStoreFilter === s ? '#fff' : gray, cursor: 'pointer' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {canPay && <button onClick={() => { setQuickPayBrand(activeBrands[0] ?? null); setQuickPayVendorId(null); setQuickPayAmt(''); setQuickPayDate(today()); setPaySelectedIds(new Set()); setPayBrandSearch(''); setPerRowAmts(new Map()); setUsePerRow(false); setModal('quick-pay') }}
                    style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    💳 Pay
                  </button>}
                  <button onClick={() => {
                      if (cutoffInEffect && !isAdmin) { alert('⚠️ Cut-Off is in effect.\n\nPlease reach out to Manager to approve logging this invoice.'); return }
                      setModal('none'); openNewEntry(activeBrands[0] ?? '')
                    }}
                    style={{ background: '#ede9fe', color: purpleD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    + Drop
                  </button>
                  <button onClick={() => { setModal('none'); setInvoiceVendorBrands(null) }} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
              <div className="modal-body" style={{ padding: '12px 14px 18px' }}>

                {/* Side-by-side or single store */}
                <div style={{ display: 'grid', gridTemplateColumns: sideBySide ? '1fr 1fr' : '1fr', gap: 14 }}>
                  {storesToShow.map(store => {
                    const sRows = iRows.filter(r => r.store === store)
                    const sDrops = Array.from(new Set(sRows.map(r => r.drop_num))).sort((a, b) => a - b)
                    const storeTotInit  = sRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                    const storeDeposit = sRows.reduce((s, r) => s + (r.deposit ?? 0), 0)
                    const storeDuties  = sRows.reduce((s, r) => s + (r.duties ?? 0), 0)
                    const storeShipping = sRows.reduce((s, r) => s + (r.shipping ?? 0), 0)
                    const storeCcFee   = sRows.reduce((s, r) => s + (r.cc_fee ?? 0), 0)
                    const storeBal     = sRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)

                    return (
                      <div key={store}>
                        {/* Store header */}
                        <div style={{ background: purpleD, color: '#fff', borderRadius: '8px 8px 0 0', padding: '7px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 800, fontSize: 13 }}>{store}</span>
                          <span style={{ fontSize: 11, opacity: 0.85 }}>{sDrops.length} drop{sDrops.length !== 1 ? 's' : ''}</span>
                        </div>

                        {/* Drops */}
                        {sDrops.length === 0 ? (
                          <div style={{ padding: '20px 12px', textAlign: 'center', color: gray, fontSize: 12, background: '#fafafa', border: `1px solid ${border}`, borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                            No drops logged for {store}
                          </div>
                        ) : (
                          <div style={{ border: `1px solid ${border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                            {sRows.map((dRow, di) => {
                              const dropNum = dRow.drop_num
                              const bal = dRow.balance_due ?? 0
                              const isLast = di === sRows.length - 1
                              const isRowCancelled = dRow.is_cancelled ?? false
                              return (
                                <div key={dRow.id}
                                  style={{ borderBottom: isLast ? 'none' : `1px solid #f3f4f6`, padding: '10px 12px', background: isRowCancelled ? '#fafafa' : undefined, opacity: isRowCancelled ? 0.7 : 1 }}>
                                  {/* Drop header row */}
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      {activeBrands.length > 1 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: purpleD, background: '#ede9fe', borderRadius: 4, padding: '1px 6px' }}>{dRow.brand}</span>
                                      )}
                                      <span style={{ fontWeight: 800, fontSize: 12, color: isRowCancelled ? gray : purpleD, textDecoration: isRowCancelled ? 'line-through' : undefined }}>Log #{dropNum}{dRow.drop_label ? ` · Drop ${dRow.drop_label}` : ''}{dRow.drop_name ? ` · ${dRow.drop_name}` : ''}</span>
                                      {isRowCancelled && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 5px' }}>Cancelled</span>
                                      )}
                                      {dRow.invoice_num && (
                                        <span style={{ fontSize: 10, color: '#1e40af', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                                          INV {dRow.invoice_num}
                                        </span>
                                      )}
                                      {dRow.order_num && (
                                        <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                                          ORD {dRow.order_num}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 5 }}>
                                      <button
                                        onClick={() => { setModal('none'); openEdit(dRow) }}
                                        style={{ fontSize: 10, color: gray, background: '#f3f4f6', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>
                                        Edit
                                      </button>
                                    </div>
                                  </div>

                                  {/* Drop detail grid */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px', fontSize: 11 }}>
                                    {dRow.units != null && (
                                      <div style={{ color: gray }}>Units: <span style={{ color: '#374151', fontWeight: 600 }}>{dRow.units}</span></div>
                                    )}
                                    <div style={{ color: gray }}>Total: <span style={{ color: '#374151', fontWeight: 600 }}>{fmt$(dRow.initial_total, dRow.currency)}</span></div>
                                    {(dRow.duties ?? 0) > 0 && (
                                      <div style={{ color: gray }}>Duties: <span style={{ color: '#92400e', fontWeight: 600 }}>{fmt$(dRow.duties, dRow.currency)}</span></div>
                                    )}
                                    {(dRow.shipping ?? 0) > 0 && (
                                      <div style={{ color: gray }}>Shipping: <span style={{ color: '#1d4ed8', fontWeight: 600 }}>{fmt$(dRow.shipping, dRow.currency)}</span></div>
                                    )}
                                    {(dRow.cc_fee ?? 0) > 0 && (
                                      <div style={{ color: gray }}>CC Fee: <span style={{ color: '#059669', fontWeight: 600 }}>{fmt$(dRow.cc_fee, dRow.currency)}</span></div>
                                    )}
                                    {/* Payment history lines */}
                                    {(() => {
                                      const pmts = invoicePayments.get(dRow.id)
                                      if (pmts && pmts.length > 0) {
                                        return (
                                          <div style={{ gridColumn: 'span 2', marginTop: 2 }}>
                                            {pmts.map((p, pi) => (
                                              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '2px 0', borderTop: pi === 0 ? `1px solid #f3f4f6` : 'none' }}>
                                                <span style={{ color: gray }}>Payment {pi + 1} · <span style={{ color: '#374151' }}>{fmtDate(p.payment_date)}</span>{p.note ? <span style={{ color: '#9ca3af' }}> · {p.note}</span> : ''}</span>
                                                <span style={{ fontWeight: 700, color: '#166534' }}>{fmt$(p.amount, dRow.currency)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      }
                                      // Fallback to legacy single deposit line
                                      return (dRow.deposit ?? 0) > 0 ? (
                                        <div style={{ color: gray }}>Deposits: <span style={{ color: '#166534', fontWeight: 600 }}>{fmt$(dRow.deposit, dRow.currency)}{dRow.payment_date ? ` · ${fmtDate(dRow.payment_date)}` : ''}</span></div>
                                      ) : null
                                    })()}
                                    {dRow.comment && (
                                      <div style={{ color: gray, gridColumn: 'span 2' }}>Note: <span style={{ color: '#374151' }}>{dRow.comment}</span></div>
                                    )}
                                  </div>

                                  {/* Balance — flat text, no bubble */}
                                  <div style={{ marginTop: 7 }}>
                                    <span style={{ fontSize: 12, fontWeight: 800, color: bal > 0.001 ? '#dc2626' : '#166534' }}>
                                      {bal > 0.001 ? `Balance: ${fmt$(bal, dRow.currency)}` : '✓ Paid'}
                                    </span>
                                  </div>

                                  {/* Invoice file attachment */}
                                  <InvoiceAttachment row={dRow} onUpdated={() => fetchRows(season, user!)} />
                                </div>
                              )
                            })}

                            {/* Store total footer */}
                            {(() => {
                              const storeCurrency = (sRows[0]?.currency as Currency) ?? 'USD'
                              return (
                                <div style={{ background: '#f5f3ff', borderTop: `1.5px solid ${border}`, padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                  <div style={{ fontSize: 11, color: gray, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    <span>Total: <strong style={{ color: purpleD }}>{fmt$(storeTotInit, storeCurrency)}</strong></span>
                                    <span>Deposit: <strong style={{ color: '#166534' }}>{fmt$(storeDeposit, storeCurrency)}</strong></span>
                                    {storeDuties > 0 && <span>Duties: <strong style={{ color: '#92400e' }}>{fmt$(storeDuties, storeCurrency)}</strong></span>}
                                    {storeShipping > 0 && <span>Shipping: <strong style={{ color: '#1d4ed8' }}>{fmt$(storeShipping, storeCurrency)}</strong></span>}
                                    {storeCcFee > 0 && <span>CC Fee: <strong style={{ color: '#059669' }}>{fmt$(storeCcFee, storeCurrency)}</strong></span>}
                                  </div>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: storeBal > 0.001 ? '#dc2626' : '#166534' }}>
                                    {storeBal > 0.001 ? `Owe ${fmt$(storeBal, storeCurrency)}` : '✓ Clear'}
                                  </span>
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Grand total footer when both stores shown */}
                {sideBySide && (() => {
                  const grandBal  = iRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                  const grandInit = iRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                  const grandDep  = iRows.reduce((s, r) => s + (r.deposit ?? 0), 0)
                  const grandDuties = iRows.reduce((s, r) => s + (r.duties ?? 0), 0)
                  const grandShipping = iRows.reduce((s, r) => s + (r.shipping ?? 0), 0)
                  const grandCcFee = iRows.reduce((s, r) => s + (r.cc_fee ?? 0), 0)
                  const grandCurrency = (iRows[0]?.currency as Currency) ?? 'USD'
                  return (
                    <div style={{ marginTop: 14, background: purpleD, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#e9d5ff', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span>Grand Total: <strong style={{ color: '#fff' }}>{fmt$(grandInit, grandCurrency)}</strong></span>
                        <span>Deposits: <strong style={{ color: '#a7f3d0' }}>{fmt$(grandDep, grandCurrency)}</strong></span>
                        {grandDuties > 0 && <span>Duties: <strong style={{ color: '#fde68a' }}>{fmt$(grandDuties, grandCurrency)}</strong></span>}
                        {grandShipping > 0 && <span>Shipping: <strong style={{ color: '#bfdbfe' }}>{fmt$(grandShipping, grandCurrency)}</strong></span>}
                        {grandCcFee > 0 && <span>CC Fee: <strong style={{ color: '#6ee7b7' }}>{fmt$(grandCcFee, grandCurrency)}</strong></span>}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 900, color: grandBal > 0.001 ? '#fca5a5' : '#a7f3d0' }}>
                        {grandBal > 0.001 ? `Balance: ${fmt$(grandBal, grandCurrency)}` : '✓ Fully Paid'}
                      </span>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Quick Payment Modal ──────────────────────────────────────────────── */}
      {modal === 'quick-pay' && (() => {
        // All rows with a balance — optionally filtered to pre-selected brand/vendor or search text
        const allBalanceRows = rows.filter(r => (r.balance_due ?? 0) > 0.001)
        const searchQ = payBrandSearch.trim().toLowerCase()
        const filteredRows = quickPayBrand
          ? allBalanceRows.filter(r => r.brand === quickPayBrand)
          : quickPayVendorId
            ? allBalanceRows.filter(r => r.vendor_id === quickPayVendorId)
            : searchQ
              ? allBalanceRows.filter(r => r.brand.toLowerCase().includes(searchQ) || (r.vendor_id ?? '').toLowerCase().includes(searchQ))
              : allBalanceRows

        // Group by brand → drop for display
        const brandGroups = Array.from(new Set(filteredRows.map(r => r.brand))).sort()

        const selectedRows = filteredRows.filter(r => paySelectedIds.has(r.id))
        const allChecked = filteredRows.length > 0 && filteredRows.every(r => paySelectedIds.has(r.id))
        const toggleAll = () => {
          if (allChecked) setPaySelectedIds(new Set())
          else setPaySelectedIds(new Set(filteredRows.map(r => r.id)))
        }
        const toggleRow = (id: string) => {
          const next = new Set(paySelectedIds)
          if (next.has(id)) next.delete(id); else next.add(id)
          setPaySelectedIds(next)
        }

        return (
          <div className="modal-bg">
            <div className="modal-box" style={{ maxWidth: 520 }}>
              <div className="modal-head">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: purpleD }}>💳 Log Payment</div>
                  <div style={{ fontSize: 12, color: gray }}>{season}</div>
                </div>
                <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
              </div>
              <div className="modal-body">

                {/* Brand / vendor search */}
                {(() => {
                  const q = payBrandSearch.trim().toLowerCase()
                  const allBrandsInSeason = Array.from(new Set(rows.map(r => r.brand))).sort()
                  const allVendorIdsInSeason = Array.from(new Set(rows.map(r => r.vendor_id).filter(Boolean))).sort() as string[]
                  const brandResults = q ? allBrandsInSeason.filter(b => b.toLowerCase().includes(q)) : []
                  const vendorResults = q ? allVendorIdsInSeason.filter(v => v.toLowerCase().includes(q)) : []
                  const hasResults = brandResults.length > 0 || vendorResults.length > 0
                  const hasFilter = quickPayBrand || quickPayVendorId
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 7, border: `1.5px solid ${border}`, overflow: 'hidden' }}>
                          <span style={{ padding: '0 8px', color: gray, fontSize: 13 }}>🔍</span>
                          <input
                            value={payBrandSearch}
                            onChange={e => setPayBrandSearch(e.target.value)}
                            placeholder="Search brand or vendor ID…"
                            style={{ background: 'transparent', border: 'none', outline: 'none', color: '#111', fontSize: 12, fontWeight: 500, padding: '6px 8px 6px 0', flex: 1 }}
                          />
                          {payBrandSearch && (
                            <button onClick={() => setPayBrandSearch('')}
                              style={{ background: 'none', border: 'none', color: gray, cursor: 'pointer', padding: '0 8px', fontSize: 13 }}>✕</button>
                          )}
                        </div>
                        {hasFilter && (
                          <button onClick={() => { setQuickPayBrand(null); setQuickPayVendorId(null); setPaySelectedIds(new Set()); setPayBrandSearch('') }}
                            style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7, border: `1.5px solid ${border}`, background: '#f5f3ff', color: gray, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Clear filter
                          </button>
                        )}
                      </div>
                      {/* Results: vendor IDs first, then brands */}
                      {q && hasResults && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', padding: '2px 0' }}>
                          {vendorResults.length > 0 && (
                            <>
                              <div style={{ fontSize: 10, fontWeight: 700, color: gray, padding: '0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vendor ID</div>
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                {vendorResults.map(v => (
                                  <button key={v} onClick={() => { setQuickPayVendorId(v); setQuickPayBrand(null); setPaySelectedIds(new Set()); setPayBrandSearch('') }}
                                    style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${quickPayVendorId === v ? purpleD : border}`, background: quickPayVendorId === v ? purpleD : '#ede9fe', color: quickPayVendorId === v ? '#fff' : purpleD, cursor: 'pointer' }}>
                                    {v}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                          {brandResults.length > 0 && (
                            <>
                              <div style={{ fontSize: 10, fontWeight: 700, color: gray, padding: '0 2px', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: vendorResults.length > 0 ? 4 : 0 }}>Brand</div>
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                {brandResults.map(b => (
                                  <button key={b} onClick={() => { setQuickPayBrand(b); setQuickPayVendorId(null); setPaySelectedIds(new Set()); setPayBrandSearch('') }}
                                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${quickPayBrand === b ? purpleD : border}`, background: quickPayBrand === b ? purpleD : '#fff', color: quickPayBrand === b ? '#fff' : gray, cursor: 'pointer' }}>
                                    {b}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {q && !hasResults && (
                        <div style={{ fontSize: 11, color: gray, padding: '2px 4px' }}>No brands or vendor IDs found</div>
                      )}
                      {/* Active filter chip */}
                      {(quickPayBrand || quickPayVendorId) && (
                        <div style={{ fontSize: 11, color: purpleD, fontWeight: 700, padding: '2px 4px', marginTop: 4 }}>
                          Filtering by {quickPayVendorId
                            ? <><span style={{ background: '#ede9fe', borderRadius: 6, padding: '1px 7px' }}>Vendor {quickPayVendorId}</span></>
                            : <><span style={{ background: '#ede9fe', borderRadius: 6, padding: '1px 7px' }}>{quickPayBrand}</span>{quickPayBrand && pendingErrorBrands.has(quickPayBrand) && <span title="Open error form(s) for this brand — not yet resolved" style={{ fontSize: 10, fontWeight: 800, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '1px 7px', whiteSpace: 'nowrap', marginLeft: 6 }}>⚠️ Error Form</span>}</>}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {filteredRows.length === 0 ? (
                  <p style={{ fontSize: 13, color: gray, textAlign: 'center', padding: '12px 0' }}>No outstanding balances{quickPayBrand ? ` for ${quickPayBrand}` : ''} in {season}.</p>
                ) : (
                  <>
                    {/* Select-all header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '4px 10px', background: '#f5f3ff', borderRadius: 6 }}>
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ accentColor: purpleD, width: 14, height: 14 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>Select All</span>
                      {selectedRows.length > 0 && (
                        <span style={{ fontSize: 11, color: gray, marginLeft: 'auto' }}>
                          {selectedRows.length} row{selectedRows.length > 1 ? 's' : ''} selected
                        </span>
                      )}
                    </div>

                    {/* Rows grouped by brand */}
                    <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
                      {brandGroups.map(brand => {
                        const brandRows = filteredRows.filter(r => r.brand === brand)
                        return (
                          <div key={brand} style={{ marginBottom: 8 }}>
                            {!quickPayBrand && (
                              <div style={{ fontSize: 10, fontWeight: 800, color: purpleD, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, paddingLeft: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {brand}
                                {pendingErrorBrands.has(brand) && (
                                  <span title="Open error form(s) for this brand — not yet resolved" style={{ fontSize: 10, fontWeight: 800, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '1px 7px', whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: 0 }}>
                                    ⚠️ Error Form
                                  </span>
                                )}
                              </div>
                            )}
                            {brandRows.map(r => (
                              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: paySelectedIds.has(r.id) ? '#f5f3ff' : '#fafafa', border: `1px solid ${paySelectedIds.has(r.id) ? purpleD : border}`, borderRadius: 7, padding: '7px 12px', marginBottom: 5, cursor: 'pointer' }}>
                                <input type="checkbox" checked={paySelectedIds.has(r.id)} onChange={() => toggleRow(r.id)}
                                  style={{ accentColor: purpleD, width: 14, height: 14, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontWeight: 700, color: purpleD, fontSize: 13 }}>{r.store}</span>
                                  <span style={{ fontSize: 11, color: gray, marginLeft: 6 }}>Log #{r.drop_num}{r.drop_label ? ` · Drop ${r.drop_label}` : ''}</span>
                                  {!quickPayBrand && <span style={{ fontSize: 11, color: gray, marginLeft: 6 }}>· {r.brand}</span>}
                                </div>
                                <span style={{ fontWeight: 800, color: '#dc2626', fontSize: 13, flexShrink: 0 }}>{fmt$(r.balance_due, r.currency)} due</span>
                              </label>
                            ))}
                          </div>
                        )
                      })}
                    </div>

                    {/* Date row */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={lbl}>Payment Date</label>
                      <input type="date" value={quickPayDate} onChange={e => setQuickPayDate(e.target.value)} style={{ ...inp, maxWidth: 180 }} />
                    </div>

                    {selectedRows.length === 0 && (
                      <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8 }}>⚠ Select at least one row to apply payment to.</div>
                    )}

                    {/* Per-row amount preview */}
                    {selectedRows.length > 0 && (
                      <div style={{ border: `1.5px solid ${border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                        {/* Header */}
                        <div style={{ background: '#f5f3ff', padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: `1px solid ${border}` }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>
                            {selectedRows.length} Drop{selectedRows.length > 1 ? 's' : ''} Selected
                          </span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button"
                              onClick={() => {
                                if (selectedRows.length === 1) {
                                  setUsePerRow(false)
                                  setQuickPayAmt((selectedRows[0].balance_due ?? 0).toFixed(2))
                                } else {
                                  const m = new Map<string, string>()
                                  selectedRows.forEach(r => m.set(r.id, (r.balance_due ?? 0).toFixed(2)))
                                  setPerRowAmts(m); setUsePerRow(true); setQuickPayAmt('')
                                }
                              }}
                              style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 6, border: `1.5px solid #dc2626`, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>
                              Remainder
                            </button>
                            <button type="button"
                              onClick={() => {
                                const m = new Map<string, string>()
                                selectedRows.forEach(r => m.set(r.id, ((r.initial_total ?? 0) * 0.3).toFixed(2)))
                                setPerRowAmts(m); setUsePerRow(true); setQuickPayAmt('')
                              }}
                              style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 6, border: `1.5px solid ${purpleD}`, background: '#ede9fe', color: purpleD, cursor: 'pointer' }}>
                              Fill 30% each
                            </button>
                            <button type="button"
                              onClick={() => { setUsePerRow(false); setPerRowAmts(new Map()) }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, border: `1px solid ${border}`, background: '#f3f4f6', color: gray, cursor: 'pointer' }}>
                              Same amt
                            </button>
                          </div>
                        </div>

                        {/* Per-row table */}
                        <div>
                          {selectedRows.map((r, i) => {
                            const rowAmt = usePerRow ? (perRowAmts.get(r.id) ?? '') : quickPayAmt
                            const isLast = i === selectedRows.length - 1
                            return (
                              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '7px 12px', borderBottom: isLast ? 'none' : `1px solid #f3f4f6`, background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{r.brand} · Log #{r.drop_num}{r.drop_label ? ` · Drop ${r.drop_label}` : ''}</div>
                                  <div style={{ fontSize: 10, color: gray }}>{r.store} · Balance: {fmt$(r.balance_due, r.currency)} · Total: {fmt$(r.initial_total, r.currency)}</div>
                                </div>
                                {usePerRow ? (
                                  <input type="number" step="0.01" placeholder="0.00"
                                    value={perRowAmts.get(r.id) ?? ''}
                                    onChange={e => {
                                      const m = new Map(perRowAmts)
                                      m.set(r.id, e.target.value)
                                      setPerRowAmts(m)
                                    }}
                                    style={{ ...inp, width: 90, textAlign: 'right', fontWeight: 700 }} />
                                ) : (
                                  <input type="number" step="0.01" placeholder="0.00"
                                    value={quickPayAmt}
                                    onChange={e => setQuickPayAmt(e.target.value)}
                                    style={{ ...inp, width: 90, textAlign: 'right', fontWeight: 700 }} />
                                )}
                                <div style={{ fontSize: 10, color: gray, minWidth: 28 }}>{r.currency}</div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Total summary */}
                        {selectedRows.length > 1 && (
                          <div style={{ background: '#f5f3ff', borderTop: `1.5px solid ${border}`, padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: gray }}>Total payment:</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: purpleD }}>
                              {fmt$(selectedRows.reduce((s, r) => {
                                const a = usePerRow ? parseFloat(perRowAmts.get(r.id) ?? '0') : parseFloat(quickPayAmt || '0')
                                return s + (isNaN(a) ? 0 : a)
                              }, 0))}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                      <button onClick={() => setModal('none')}
                        style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button
                        disabled={selectedRows.length === 0 || !user || (usePerRow ? selectedRows.some(r => !perRowAmts.get(r.id)) : !quickPayAmt)}
                        onClick={async () => {
                          if (!user || selectedRows.length === 0) return
                          for (const r of selectedRows) {
                            const amt = usePerRow ? (perRowAmts.get(r.id) ?? '') : quickPayAmt
                            if (!amt) continue
                            // Always fetch fresh row data so deposit is current before adding
                            const { data: fresh } = await supabase.from('season_ledger').select('*').eq('id', r.id).maybeSingle()
                            await addPayment(fresh ?? r, amt, quickPayDate)
                          }
                          // fetchRows already awaited inside addPayment — data is fresh before closing
                          setModal('invoice')
                        }}
                        style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (selectedRows.length === 0 || (usePerRow ? selectedRows.some(r => !perRowAmts.get(r.id)) : !quickPayAmt)) ? 0.5 : 1 }}>
                        Apply to {selectedRows.length > 0 ? `${selectedRows.length} Drop${selectedRows.length > 1 ? 's' : ''}` : 'Selected'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Payment History Modal ────────────────────────────────────────────── */}
      {modal === 'pay-history' && (
        <div className="modal-bg">
          <div className="modal-box" style={{ maxWidth: 540 }}>
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: purpleD }}>🕐 Payment History</div>
                <div style={{ fontSize: 12, color: gray }}>
                  {payHistRow
                    ? `${payHistRow.brand} · ${payHistRow.store} · Drop ${payHistRow.drop_num}${payHistRow.drop_name ? ` · ${payHistRow.drop_name}` : ''}`
                    : `All payments — ${season}`}
                </div>
              </div>
              <button onClick={() => { setModal('none'); setPayHistSearch('') }} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
              {/* Single-row summary */}
              {payHistRow && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 14, padding: '8px 12px', background: '#f5f3ff', borderRadius: 8, fontSize: 12 }}>
                  <span>Total: <strong style={{ color: purpleD }}>{fmt$(payHistRow.initial_total, payHistRow.currency)}</strong></span>
                  <span>Paid: <strong style={{ color: '#166534' }}>{fmt$(payHistRow.deposit, payHistRow.currency)}</strong></span>
                  <span style={{ marginLeft: 'auto' }}>
                    Balance: <strong style={{ color: (payHistRow.balance_due ?? 0) > 0.001 ? '#dc2626' : '#166534' }}>
                      {fmt$(payHistRow.balance_due, payHistRow.currency)}
                    </strong>
                  </span>
                </div>
              )}

              {/* Search */}
              <input
                value={payHistSearch}
                onChange={e => setPayHistSearch(e.target.value)}
                placeholder="Search brand, store, note…"
                style={{ ...inp, fontSize: 12, marginBottom: 10, width: '100%' }}
              />

              {payHistLoading ? (
                <p style={{ textAlign: 'center', color: gray, fontSize: 13, padding: '12px 0' }}>Loading…</p>
              ) : payHistRecords.length === 0 ? (
                <p style={{ textAlign: 'center', color: gray, fontSize: 13, padding: '12px 0' }}>
                  No payment records found.<br />
                  <span style={{ fontSize: 11 }}>Payments made before history tracking was added won&apos;t appear here.</span>
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, maxHeight: 400, overflowY: 'auto' }}>
                  {payHistRecords.filter(p => {
                    if (!payHistSearch.trim()) return true
                    const q = payHistSearch.toLowerCase()
                    const lr = rows.find(r => r.id === p.ledger_id) ?? payHistRow
                    return (
                      (lr?.brand ?? '').toLowerCase().includes(q) ||
                      (lr?.store ?? '').toLowerCase().includes(q) ||
                      (p.note ?? '').toLowerCase().includes(q) ||
                      p.payment_date.includes(q) ||
                      p.amount.toString().includes(q)
                    )
                  }).map(p => {
                    const ledgerRow = rows.find(r => r.id === p.ledger_id) ?? payHistRow
                    return (
                      <div key={p.id} style={{ background: payHistEditId === p.id ? '#f5f3ff' : '#fafafa', border: `1px solid ${payHistEditId === p.id ? purpleD : border}`, borderRadius: 8, padding: '8px 12px' }}>
                        {payHistEditId === p.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <div>
                                <label style={{ fontSize: 10, fontWeight: 700, color: gray, display: 'block', marginBottom: 2 }}>Amount</label>
                                <input type="number" value={payHistEditAmt} onChange={e => setPayHistEditAmt(e.target.value)}
                                  step="0.01" style={{ ...inp, fontSize: 12 }} autoFocus />
                              </div>
                              <div>
                                <label style={{ fontSize: 10, fontWeight: 700, color: gray, display: 'block', marginBottom: 2 }}>Date</label>
                                <input type="date" value={payHistEditDate} onChange={e => setPayHistEditDate(e.target.value)} style={{ ...inp, fontSize: 12 }} />
                              </div>
                            </div>
                            <div>
                              <label style={{ fontSize: 10, fontWeight: 700, color: gray, display: 'block', marginBottom: 2 }}>Note</label>
                              <input value={payHistEditNote} onChange={e => setPayHistEditNote(e.target.value)} placeholder="Optional note" style={{ ...inp, fontSize: 12 }} />
                            </div>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button onClick={() => setPayHistEditId(null)}
                                style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                              {ledgerRow && (
                                <button onClick={() => savePayHistEdit(p.id, ledgerRow)}
                                  style={{ background: purpleD, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 800, color: '#166534', fontSize: 14 }}>{fmt$(p.amount, ledgerRow?.currency)}</span>
                              <span style={{ fontSize: 11, color: gray, marginLeft: 8 }}>{fmtDate(p.payment_date)}</span>
                              {/* Show brand/store context in global view */}
                              {!payHistRow && ledgerRow && (
                                <span style={{ fontSize: 11, color: purpleD, fontWeight: 600, marginLeft: 8 }}>
                                  {ledgerRow.brand} · {ledgerRow.store} · Log #{ledgerRow.drop_num}{ledgerRow.drop_label ? ` · Drop ${ledgerRow.drop_label}` : ''}
                                </span>
                              )}
                              {p.note && <span style={{ fontSize: 11, color: '#374151', marginLeft: 8 }}>{p.note}</span>}
                            </div>
                            <button onClick={() => { setPayHistEditId(p.id); setPayHistEditAmt(p.amount.toString()); setPayHistEditDate((p.payment_date ?? '').slice(0, 10)); setPayHistEditNote(p.note ?? '') }}
                              style={{ fontSize: 10, color: gray, background: '#f3f4f6', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 7px', cursor: 'pointer', flexShrink: 0 }}>Edit</button>
                            {ledgerRow && (
                              <button onClick={() => { if (confirm('Delete this payment?')) deletePayment(p.id, ledgerRow, p.amount) }}
                                style={{ fontSize: 10, color: '#dc2626', background: '#fef2f2', border: `1px solid #fca5a5`, borderRadius: 5, padding: '2px 7px', cursor: 'pointer', flexShrink: 0 }}>Delete</button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => { setModal('none'); setPayHistSearch('') }}
                  style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Vendor Picker Modal ──────────────────────────────────────────────── */}
      {vendorPickerBrand && vendorPickerCandidates.length > 0 && (
        <div className="modal-bg" style={{ zIndex: 1100 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 360, boxShadow: '0 8px 48px rgba(0,0,0,0.22)', padding: '20px 22px' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: purpleD, marginBottom: 4 }}>{vendorPickerBrand}</div>
            <div style={{ fontSize: 12, color: gray, marginBottom: 16 }}>
              This brand maps to multiple vendors. Which one is this order from?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vendorPickerCandidates.map(vid => (
                <button key={vid}
                  onClick={() => vendorPickerOnSelect?.(vid)}
                  style={{ background: '#f5f3ff', border: `2px solid ${border}`, borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 700, color: purpleD, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = purple; (e.currentTarget as HTMLButtonElement).style.background = '#ede9fe' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = border; (e.currentTarget as HTMLButtonElement).style.background = '#f5f3ff' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '2px 8px' }}>{vid}</span>
                  {vid} - {vendorPickerBrand}
                </button>
              ))}
            </div>
            <button onClick={() => { setVendorPickerBrand(null); setVendorPickerOnSelect(null) }}
              style={{ marginTop: 14, background: 'none', border: 'none', color: gray, fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center' }}>
              Skip / Not sure
            </button>
          </div>
        </div>
      )}

      {/* ── Smart Paste Modal ─────────────────────────────────────────────────── */}
      {modal === 'smart-paste' && (
        <div className="modal-bg">
          <div className="modal-box" style={{ maxWidth: 820 }}>
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: purpleD }}>📋 Smart Paste</div>
                <div style={{ fontSize: 12, color: gray }}>Paste rows from Excel / Sheets — {season}</div>
              </div>
              <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
              {!pasteParsed ? (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: purpleD, marginBottom: 6 }}>Step 1 — Copy these headers into row 1 of your spreadsheet</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f5f3ff', border: `1.5px solid ${border}`, borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ fontSize: 11, color: gray, fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>{PASTE_HEADERS.join('\t')}</span>
                      <button onClick={() => { navigator.clipboard.writeText(PASTE_HEADERS.join('\t')); showToast('✅ Headers copied') }}
                        style={{ background: purpleD, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Copy Headers
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: gray, marginTop: 6 }}>
                      Columns: {PASTE_HEADERS.map((h, i) => <span key={h}><b>{h}</b>{i < PASTE_HEADERS.length - 1 ? ' · ' : ''}</span>)}
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: purpleD, marginBottom: 6 }}>Step 2 — Select your data rows (with or without header) and paste below</div>
                    <textarea
                      value={pasteText}
                      onChange={e => setPasteText(e.target.value)}
                      placeholder="Paste from Excel / Google Sheets here…"
                      style={{ width: '100%', minHeight: 160, border: `1.5px solid ${border}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={() => setModal('none')}
                      style={{ background: 'none', border: `1.5px solid ${border}`, borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 700, color: gray, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button disabled={!pasteText.trim()} onClick={() => {
                      const parsed = parsePaste(pasteText, liveVendors)
                      setPasteRows(parsed)
                      setPasteParsed(true)
                    }}
                      style={{ background: purpleD, color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: pasteText.trim() ? 1 : 0.5 }}>
                      Preview →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: purpleD, marginBottom: 8 }}>
                    Review {pasteRows.length} row{pasteRows.length !== 1 ? 's' : ''} — uncheck any you want to skip
                  </div>
                  <div style={{ maxHeight: 380, overflowY: 'auto', border: `1.5px solid ${border}`, borderRadius: 8, marginBottom: 12 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: '#f5f3ff', position: 'sticky', top: 0 }}>
                          <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 800, color: purpleD, width: 32 }}></th>
                          {['Brand','Vendor','Drop','Store','Units','Total','Deposit','Inv #','Ord #','Status'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 800, color: purpleD, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pasteRows.map((r, i) => (
                          <tr key={i} style={{ background: r.skip ? '#fafafa' : r.warning ? '#fffbeb' : '#fff', borderTop: `1px solid ${border}`, opacity: r.skip ? 0.4 : 1 }}>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="checkbox" checked={!r.skip} onChange={() => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, skip: !p.skip } : p))}
                                style={{ accentColor: purpleD }} />
                            </td>
                            <td style={{ padding: '5px 8px', minWidth: 140 }}>
                              {(() => {
                                const resolved = r.brandOverride ?? r.brandMatch
                                const isExact = resolved === r.brand
                                const isMissing = !resolved && !r.brandCreateNew
                                return r.brandCreateNew ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 5, padding: '1px 6px' }}>+ Create new</span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>{r.brand}</span>
                                    <button onClick={() => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, brandCreateNew: false, brandOverride: null } : p))}
                                      style={{ fontSize: 10, color: gray, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>↩ undo</button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontWeight: 700, color: isMissing ? '#dc2626' : isExact ? purpleD : '#92400e', fontSize: 12 }}>
                                      {resolved || <span style={{ color: '#dc2626' }}>Not found</span>}
                                    </span>
                                    {!isExact && (
                                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        <select value={r.brandOverride ?? ''} onChange={e => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, brandOverride: e.target.value || null } : p))}
                                          style={{ fontSize: 10, border: `1px solid ${border}`, borderRadius: 4, padding: '1px 4px', maxWidth: 120 }}>
                                          <option value="">— pick brand —</option>
                                          {Array.from(new Set(liveVendors.map(v => v.brand))).sort().map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                        <button onClick={() => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, brandCreateNew: true, brandOverride: null } : p))}
                                          style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                          + New
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                            </td>
                            <td style={{ padding: '5px 8px', minWidth: 120 }}>
                              {(() => {
                                const resolved = r.vendorOverride ?? r.vendorMatch
                                const isExact = resolved === r.vendor_id
                                const isMissing = !resolved && !r.vendorCreateNew
                                return r.vendorCreateNew ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 5, padding: '1px 6px' }}>+ Create new</span>
                                    <span style={{ fontSize: 11, color: gray }}>{r.vendor_id}</span>
                                    <button onClick={() => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, vendorCreateNew: false, vendorOverride: null } : p))}
                                      style={{ fontSize: 10, color: gray, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>↩ undo</button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ color: isMissing ? '#dc2626' : isExact ? gray : '#92400e', fontSize: 12 }}>
                                      {resolved || (r.vendor_id ? <span style={{ color: '#dc2626' }}>Not found</span> : <span style={{ color: gray }}>—</span>)}
                                    </span>
                                    {!isExact && r.vendor_id && (
                                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        <select value={r.vendorOverride ?? ''} onChange={e => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, vendorOverride: e.target.value || null } : p))}
                                          style={{ fontSize: 10, border: `1px solid ${border}`, borderRadius: 4, padding: '1px 4px', maxWidth: 120 }}>
                                          <option value="">— pick vendor —</option>
                                          {Array.from(new Set(liveVendors.map(v => v.vendor_id))).sort().map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                        <button onClick={() => setPasteRows(prev => prev.map((p, j) => j === i ? { ...p, vendorCreateNew: true, vendorOverride: null } : p))}
                                          style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                          + New
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                            </td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.drop_num}</td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.store}</td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.units}</td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.total}</td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.deposit}</td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.invoice_num}</td>
                            <td style={{ padding: '5px 8px', color: gray }}>{r.order_num}</td>
                            <td style={{ padding: '5px 8px' }}>
                              {r.brandCreateNew || r.vendorCreateNew
                                ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '1px 6px' }}>+ New entry</span>
                                : (r.brandOverride || r.vendorOverride)
                                  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '1px 6px' }}>✓ Overridden</span>
                                  : r.warning
                                    ? <span title={r.warning} style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '1px 6px', cursor: 'help' }}>⚠️ Review</span>
                                    : <span style={{ fontSize: 10, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '1px 6px' }}>✓ OK</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 11, color: gray, marginBottom: 12 }}>
                    <span style={{ fontWeight: 700, color: '#92400e' }}>⚠️ amber rows</span> = fuzzy match applied or value not found — hover the status badge for details. &nbsp;
                    <span style={{ fontWeight: 700, color: '#065f46' }}>✓ green</span> = exact match.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <button onClick={() => setPasteParsed(false)}
                      style={{ background: 'none', border: `1.5px solid ${border}`, borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 700, color: gray, cursor: 'pointer' }}>
                      ← Back
                    </button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setModal('none')}
                        style={{ background: 'none', border: `1.5px solid ${border}`, borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 700, color: gray, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button disabled={pasteSaving || pasteRows.every(r => r.skip)} onClick={async () => {
                        if (!user) return
                        setPasteSaving(true)
                        const activeRows = pasteRows.filter(r => !r.skip)
                        // Create new vendor entries first
                        const newVendorRows = activeRows.filter(r => r.brandCreateNew || r.vendorCreateNew).map(r => ({
                          vendor_id: r.vendorCreateNew ? r.vendor_id : (r.vendorOverride ?? r.vendorMatch ?? r.vendor_id),
                          brand: r.brandCreateNew ? r.brand : (r.brandOverride ?? r.brandMatch ?? r.brand),
                        })).filter(v => v.vendor_id && v.brand)
                        if (newVendorRows.length > 0) {
                          await supabase.from('vendors').insert(newVendorRows)
                        }
                        const toInsert = activeRows.map(r => {
                          const stripCurrency = (s: string) => parseFloat(s.replace(/[$€,\s]/g, '')) || null
                          const init = stripCurrency(r.total)
                          const dep  = stripCurrency(r.deposit)
                          const dut  = stripCurrency(r.duties)
                          const bal  = init != null ? (init - (dep ?? 0) + (dut ?? 0)) : null
                          const cur: Currency = (r.currency?.toUpperCase() === 'EUR') ? 'EUR' : 'USD'
                          const finalBrand = r.brandCreateNew ? r.brand : (r.brandOverride ?? r.brandMatch ?? r.brand)
                          const finalVendor = r.vendorCreateNew ? r.vendor_id : ((r.vendorOverride ?? r.vendorMatch ?? r.vendor_id) || null)
                          return {
                            season,
                            brand: finalBrand,
                            vendor_id: finalVendor,
                            drop_num: parseInt(r.drop_num) || 1,
                            drop_name: r.drop_name || null,
                            store: r.store,
                            units: parseInt(r.units) || null,
                            initial_total: init,
                            deposit: dep,
                            duties: dut,
                            balance_due: bal,
                            currency: cur,
                            invoice_num: r.invoice_num || null,
                            order_num: r.order_num || null,
                            comment: r.comment || null,
                            payment_date: null,
                            logged_by: user.userid,
                          }
                        })
                        const { error } = await supabase.from('season_ledger').insert(toInsert)
                        setPasteSaving(false)
                        if (error) { showToast('❌ ' + error.message, 'err'); return }
                        showToast(`✅ ${toInsert.length} row${toInsert.length !== 1 ? 's' : ''} inserted`)
                        setModal('none')
                        fetchRows(season, user)
                      }}
                        style={{ background: purpleD, color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (pasteSaving || pasteRows.every(r => r.skip)) ? 0.5 : 1 }}>
                        {pasteSaving ? 'Saving…' : `Import ${pasteRows.filter(r => !r.skip).length} row${pasteRows.filter(r => !r.skip).length !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Brand Header Right-Click Edit ─────────────────────────────────────── */}
      {brandCtxMenu && (
        <div ref={brandCtxRef} style={{ position: 'fixed', left: brandCtxMenu.x, top: brandCtxMenu.y, zIndex: 2000, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.18)', minWidth: 220, padding: '6px 0' }}
          onMouseDown={e => e.stopPropagation()}>
          {!brandCtxMenu.editMode ? (
            <>
              <div style={{ padding: '4px 14px 6px', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>
                {brandCtxMenu.brand}{brandCtxMenu.vendorId ? ` · ${brandCtxMenu.vendorId}` : ''}
              </div>
              <div onMouseDown={e => e.stopPropagation()} onClick={() => setBrandCtxMenu(m => m ? { ...m, editMode: true } : m)}
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, color: purpleD, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                ✏️ Edit brand / vendor
              </div>
            </>
          ) : (
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: purpleD, marginBottom: 10 }}>✏️ Edit Brand / Vendor</div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: gray, display: 'block', marginBottom: 3 }}>Brand name</label>
                <input value={brandCtxEditBrand} onChange={e => setBrandCtxEditBrand(e.target.value)}
                  style={{ width: '100%', border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: gray, display: 'block', marginBottom: 3 }}>Vendor ID</label>
                <input value={brandCtxEditVendor} onChange={e => setBrandCtxEditVendor(e.target.value)}
                  style={{ width: '100%', border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onMouseDown={e => e.stopPropagation()} onClick={() => setBrandCtxMenu(null)}
                  style={{ flex: 1, background: 'none', border: `1.5px solid ${border}`, borderRadius: 6, padding: '6px 0', fontSize: 12, fontWeight: 700, color: gray, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button disabled={brandCtxSaving} onMouseDown={e => e.stopPropagation()} onClick={async () => {
              if (!brandCtxMenu) return
              const newBrand = brandCtxEditBrand.trim()
              const newVendor = brandCtxEditVendor.trim()
              if (!newBrand) return
              setBrandCtxSaving(true)
              // Update season_ledger rows
              if (newBrand !== brandCtxMenu.brand) {
                await supabase.from('season_ledger').update({ brand: newBrand }).eq('brand', brandCtxMenu.brand).eq('season', season)
              }
              if (newVendor !== brandCtxMenu.vendorId && brandCtxMenu.vendorId) {
                await supabase.from('season_ledger').update({ vendor_id: newVendor || null }).eq('vendor_id', brandCtxMenu.vendorId).eq('brand', brandCtxMenu.brand).eq('season', season)
              }
              // Update vendors table
              if (newBrand !== brandCtxMenu.brand || newVendor !== brandCtxMenu.vendorId) {
                await supabase.from('vendors').update({ brand: newBrand, vendor_id: newVendor || brandCtxMenu.vendorId }).eq('brand', brandCtxMenu.brand).eq('vendor_id', brandCtxMenu.vendorId)
              }
              setBrandCtxSaving(false)
              setBrandCtxMenu(null)
              showToast('✅ Updated')
              if (user) fetchRows(season, user)
            }}
              style={{ flex: 1, background: purpleD, border: 'none', borderRadius: 6, padding: '6px 0', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', opacity: brandCtxSaving ? 0.6 : 1 }}>
              {brandCtxSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
          )}
        </div>
      )}

      {/* ── Row Right-Click Context Menu ──────────────────────────────────────── */}
      {rowCtxMenu && (
        <div ref={rowCtxRef} style={{ position: 'fixed', left: rowCtxMenu.x, top: rowCtxMenu.y, zIndex: 2000, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.18)', minWidth: 200, padding: '6px 0' }}>
          {!rowCtxDelMode ? (
            <>
              <div style={{ padding: '4px 14px 6px', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>
                {rowCtxMenu.rows[0]?.brand} · {rowCtxMenu.rows[0]?.store} · Log #{rowCtxMenu.rows[0]?.drop_num}{rowCtxMenu.rows[0]?.drop_label ? ` · Drop ${rowCtxMenu.rows[0].drop_label}` : ''}
              </div>
              <div onMouseDown={e => e.stopPropagation()} onClick={() => setRowCtxDelMode(true)}
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                🗑 Delete {rowCtxMenu.rows.length > 1 ? `all ${rowCtxMenu.rows.length} store rows` : 'this row'}
              </div>
            </>
          ) : (
            <div style={{ padding: '12px 16px' }} onMouseDown={e => e.stopPropagation()}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>
                Enter password to delete {rowCtxMenu.rows.length > 1 ? `${rowCtxMenu.rows.length} rows` : 'this row'}
              </div>
              <input
                type="password"
                value={rowCtxDelPw}
                onChange={e => { setRowCtxDelPw(e.target.value); setRowCtxDelErr(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmRowDelete()
                  if (e.key === 'Escape') { setRowCtxMenu(null); setRowCtxDelMode(false); setRowCtxDelPw('') }
                }}
                autoFocus
                placeholder="password"
                style={{ width: '100%', border: `1.5px solid ${rowCtxDelErr ? '#dc2626' : border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
              {rowCtxDelErr && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>Incorrect password</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onMouseDown={e => e.stopPropagation()} onClick={() => { setRowCtxMenu(null); setRowCtxDelMode(false); setRowCtxDelPw('') }}
                  style={{ flex: 1, background: 'none', border: `1.5px solid ${border}`, borderRadius: 6, padding: '5px 0', fontSize: 12, fontWeight: 700, color: gray, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onMouseDown={e => e.stopPropagation()} onClick={confirmRowDelete}
                  style={{ flex: 1, background: '#dc2626', border: 'none', borderRadius: 6, padding: '5px 0', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#dc2626' : '#3b1f8c', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  )
}

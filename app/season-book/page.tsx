'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}

import { useEffect, useState, useCallback, useRef } from 'react'
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
  const d = new Date(iso)
  return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${String(d.getFullYear()).slice(2)}`
}

// ── Blank store entry for the form ───────────────────────────────────────────
interface StoreEntry {
  store: string
  units: string
  initial_total: string
  deposit: string
  duties: string
  payment_date: string
  comment: string
  currency: Currency
  invoice_num: string
  order_num: string
  drop_name: string
}

function blankEntry(store: string): StoreEntry {
  return { store, units: '', initial_total: '', deposit: '', duties: '', payment_date: '', comment: '', currency: 'USD', invoice_num: '', order_num: '', drop_name: '' }
}
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
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
  const [modal, setModal] = useState<'none'|'new-entry'|'edit-entry'|'add-payment'|'quick-pay'|'invoice'>('none')
  const [editRow, setEditRow] = useState<LedgerRow | null>(null)
  const [quickPayBrand, setQuickPayBrand] = useState<string | null>(null)
  const [quickPayAmt, setQuickPayAmt] = useState('')
  const [quickPayDate, setQuickPayDate] = useState(today())
  // Which rows are selected for payment (by id); null = all with balance
  const [paySelectedIds, setPaySelectedIds] = useState<Set<string>>(new Set())
  // Payment modal brand search
  const [payBrandSearch, setPayBrandSearch] = useState('')
  // Invoice modal
  const [invoiceBrand, setInvoiceBrand] = useState<string | null>(null)
  const [invoiceStoreFilter, setInvoiceStoreFilter] = useState<string | null>(null) // null = both stores

  // Brand search inside new-entry modal
  const [modalBrandQ, setModalBrandQ] = useState('')
  const [modalBrandSuggs, setModalBrandSuggs] = useState<string[]>([])
  const [showModalBrandDrop, setShowModalBrandDrop] = useState(false)
  const modalBrandRef = useRef<HTMLDivElement>(null)

  // Form state: drop number + per-store entries (TTC + TTP simultaneously)
  const [formDrop, setFormDrop] = useState(1)
  const [formStores, setFormStores] = useState<StoreEntry[]>(STORES.map(blankEntry))
  const [formVendorId, setFormVendorId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3000)
  }

  const isAdmin = user?.store === 'ALL'

  // ── Vendor lookup map: brand → vendor_id[] ───────────────────────────────
  const brandToVendors = (() => {
    const map = new Map<string, string[]>()
    for (const v of VENDOR_DATA) {
      const existing = map.get(v.brand) ?? []
      if (!existing.includes(v.vendor_id)) {
        map.set(v.brand, [...existing, v.vendor_id])
      }
    }
    return map
  })()

  // Helper: get vendor_id for a brand (returns null if 0 or 2+ vendors)
  function getUniqueVendorId(brand: string): string | null {
    const vids = brandToVendors.get(brand)
    if (!vids || vids.length !== 1) return null
    return vids[0]
  }

  // ── Fetch rows for current season ─────────────────────────────────────────
  const fetchRows = useCallback(async (s: string, u: User) => {
    setLoading(true)
    let q = supabase.from('season_ledger').select('*').eq('season', s).order('brand').order('drop_num').order('store')
    if (u.store !== 'ALL') q = q.in('store', [u.store])
    const { data, error } = await q
    if (error) { showToast('❌ ' + error.message, 'err') }
    else setRows((data as unknown as LedgerRow[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchRows(season, u)
  }, [router, fetchRows, season])

  // Modal brand autocomplete
  useEffect(() => {
    if (!modalBrandQ.trim()) { setModalBrandSuggs([]); return }
    const q = modalBrandQ.toLowerCase()
    const inSeason = Array.from(new Set(rows.map(r => r.brand)))
    const all = Array.from(new Set([...BRAND_LIST, ...inSeason]))
    setModalBrandSuggs(all.filter(b => b.toLowerCase().includes(q)).slice(0, 10))
  }, [modalBrandQ, rows])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (headerSearchRef.current && !headerSearchRef.current.contains(e.target as Node)) {
        setShowHeaderDrop(false)
      }
      if (modalBrandRef.current && !modalBrandRef.current.contains(e.target as Node)) {
        setShowModalBrandDrop(false)
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
      const vendorBrands = new Set(VENDOR_DATA.filter(v => v.vendor_id === activeVendorId).map(v => v.brand))
      list = list.filter(b => vendorBrands.has(b))
    }
    return list
  })()

  // Header search: brand name OR invoice # OR vendor_id match
  const allBrandOptions = Array.from(new Set([...BRAND_LIST, ...brandsInSeason]))
  const headerSearchResults: Array<{ type: 'brand' | 'invoice' | 'vendor'; label: string; brand: string; invoiceNum?: string; vendorId?: string }> = headerSearch.trim()
    ? [
        // Vendor ID matches — only vendors with a vendor_id
        ...Array.from(new Set(VENDOR_DATA.filter(v => v.vendor_id && v.vendor_id.trim()).map(v => v.vendor_id)))
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
      payment_date: row.payment_date ?? '',
      comment: row.comment ?? '',
      currency: (row.currency as Currency) ?? 'USD',
      invoice_num: row.invoice_num ?? '',
      order_num: row.order_num ?? '',
      drop_name: row.drop_name ?? '',
    }])
    setModal('edit-entry')
  }

  // ── Save new log entry ─────────────────────────────────────────────────────
  async function saveNewEntry() {
    if (!user || !activeBrand) return
    setSaving(true)
    const inserts = formStores
      .filter(e => e.units || e.initial_total || e.deposit || e.duties)
      .map(e => {
        const init = parseFloat(e.initial_total) || null
        const dep  = parseFloat(e.deposit) || null
        const dut  = parseFloat(e.duties) || null
        const bal  = init != null ? (init - (dep ?? 0) - (dut ?? 0)) : null
        return {
          season, brand: activeBrand, drop_num: formDrop, store: e.store,
          units: parseInt(e.units) || null,
          initial_total: init, deposit: dep, duties: dut, balance_due: bal,
          payment_date: (e.deposit && e.payment_date) ? e.payment_date : null,
          comment: e.comment || null,
          currency: e.currency,
          invoice_num: e.invoice_num || null,
          order_num: e.order_num || null,
          drop_name: (e.drop_name && e.drop_name !== '\0') ? e.drop_name : null,
          vendor_id: formVendorId ?? null,
          logged_by: user.userid,
        }
      })
    if (inserts.length === 0) { showToast('⚠️ Enter at least one store row', 'err'); setSaving(false); return }

    // Check no duplicate drop+store
    const existing = rows.filter(r => r.brand === activeBrand && r.drop_num === formDrop)
    const existStores = existing.map(r => r.store)
    const dupe = inserts.find(i => existStores.includes(i.store))
    if (dupe) { showToast(`❌ Drop ${formDrop} already has a ${dupe.store} entry`, 'err'); setSaving(false); return }

    const { error } = await supabase.from('season_ledger').insert(inserts)
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
    showToast(`✅ Drop ${formDrop} saved for ${activeBrand}`)
    setModal('none')
    fetchRows(season, user)
    setSaving(false)
  }

  // ── Save edit ─────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!user || !editRow) return
    setSaving(true)
    const e = formStores[0]
    const init = parseFloat(e.initial_total) || null
    const dep  = parseFloat(e.deposit) || null
    const dut  = parseFloat(e.duties) || null
    const bal  = init != null ? (init - (dep ?? 0) - (dut ?? 0)) : null
    const { error } = await supabase.from('season_ledger').update({
      units: parseInt(e.units) || null,
      initial_total: init, deposit: dep, duties: dut, balance_due: bal,
      payment_date: (dep && e.payment_date) ? e.payment_date : null,
      comment: e.comment || null,
      currency: e.currency,
      invoice_num: e.invoice_num || null,
      order_num: e.order_num || null,
      drop_name: (e.drop_name && e.drop_name !== '\0') ? e.drop_name : null,
      updated_at: new Date().toISOString(),
    }).eq('id', editRow.id)
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
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
    const newBal = init - newDep - dut
    const { error } = await supabase.from('season_ledger').update({
      deposit: newDep, balance_due: newBal,
      payment_date: date || row.payment_date,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Payment recorded')
    fetchRows(season, user)
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
        .sb-subbar { padding: 8px 16px; background: #f5f3ff; border-bottom: 1px solid ${border}; display: flex; align-items: center; justify-content: center; gap: 8px; position: sticky; top: 54px; z-index: 99; }
        .sb-dropbar { padding: 6px 16px; background: #fff; border-bottom: 1px solid ${border}; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: sticky; top: 100px; z-index: 98; min-height: 38px; }
        .sb-layout { display: flex; flex: 1; position: relative; }
        .sb-sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid ${border}; background: rgba(255,255,255,0.7); overflow-y: auto; position: sticky; top: 138px; height: calc(100vh - 138px); }
        .sb-main { flex: 1; padding: 16px; }
        .sb-brand-row { padding: 8px 14px; cursor: pointer; border-bottom: 1px solid #ede9fe; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 13px; font-weight: 600; color: #374151; transition: background 0.1s; }
        .sb-brand-row:hover, .sb-brand-row.active { background: #ede9fe; color: ${purpleD}; }
        .sb-brand-row.active { font-weight: 800; }
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
        .modal-box { background: #fff; border-radius: 14px; width: 100%; max-width: 680px; box-shadow: 0 8px 48px rgba(0,0,0,0.22); }
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
        @media (max-width: 600px) {
          .sb-layout { flex-direction: column; }
          .sb-sidebar { width: 100%; border-right: none; border-bottom: 1px solid ${border}; max-height: 180px; }
          .sb-main { padding: 10px; }
          .form-grid { grid-template-columns: 1fr; }
          .store-table th, .store-table td { font-size: 11px; padding: 4px 6px; }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>📒 SEASON BOOK</span>
          <span style={{ background: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 12, padding: '3px 10px', border: '1.5px solid rgba(255,255,255,0.4)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            onClick={() => setShowSeasonPanel(true)}>
            {season}
          </span>
        </div>

        {/* Right: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          <button onClick={() => activeBrand ? openNewEntry(activeBrand) : openNewEntryBlank()}
            style={{ background: '#fff', color: purpleD, border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            + New
          </button>
          <button onClick={() => {
            setQuickPayBrand(activeBrand ?? null)
            setQuickPayAmt(''); setQuickPayDate(today())
            setPaySelectedIds(new Set())
            setPayBrandSearch('')
            setModal('quick-pay')
          }}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            💳 Payment
          </button>
        </div>
      </div>

      {/* Sub-bar: search */}
      <div className="sb-subbar">
        <div ref={headerSearchRef} style={{ position: 'relative', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 7, border: `1.5px solid ${border}`, overflow: 'hidden' }}>
            <span style={{ padding: '0 8px', color: gray, fontSize: 14 }}>🔍</span>
            <input
              value={headerSearch}
              onChange={e => { setHeaderSearch(e.target.value); setShowHeaderDrop(true) }}
              onFocus={() => setShowHeaderDrop(true)}
              placeholder="Search or select a brand…"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#111', fontSize: 13, fontWeight: 500, padding: '6px 8px 6px 0', flex: 1 }}
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
                    if (item.type === 'vendor') {
                      setActiveVendorId(item.vendorId!)
                      setActiveBrand(null)
                    } else {
                      setActiveBrand(item.brand)
                    }
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
                    {item.type === 'vendor' && (
                      <span style={{ fontSize: 10, color: '#065f46', fontWeight: 700, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 4, padding: '1px 5px' }}>
                        Vendor ID
                      </span>
                    )}
                    {item.type === 'invoice' && (
                      <span style={{ fontSize: 10, color: '#1e40af', fontWeight: 700, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 5px' }}>
                        INV {item.invoiceNum}
                      </span>
                    )}
                    {item.type === 'brand' && brandsInSeason.includes(item.brand) && (
                      <span style={{ fontSize: 10, color: purpleD, fontWeight: 700, background: '#ede9fe', borderRadius: 6, padding: '1px 6px' }}>in {season}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {activeBrand && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: purpleD }}>
            <span style={{ color: gray, fontWeight: 400 }}>Viewing:</span>
            {activeBrand}
            <button onClick={() => setActiveBrand(null)}
              style={{ background: 'none', border: 'none', color: gray, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
        )}
        {activeVendorId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 20, padding: '3px 10px' }}>
            <span style={{ fontWeight: 400, color: '#374151' }}>Vendor:</span>
            {activeVendorId}
            <button onClick={() => setActiveVendorId(null)}
              style={{ background: 'none', border: 'none', color: '#065f46', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
        )}
      </div>

      {/* Drop Name Filter Bar — always visible so new names can be added */}
      <div className="sb-dropbar">
          <span style={{ fontSize: 11, fontWeight: 700, color: gray, flexShrink: 0 }}>Drop:</span>
          <button
            onClick={() => setActiveDropName(null)}
            style={{
              fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 10px', cursor: 'pointer', border: 'none',
              background: activeDropName === null ? purpleD : '#e5e7eb',
              color: activeDropName === null ? '#fff' : '#374151',
            }}>All</button>
          {dropNamesInSeason.map(dn => (
            <button key={dn}
              onClick={() => setActiveDropName(activeDropName === dn ? null : dn)}
              style={{
                fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 10px', cursor: 'pointer', border: 'none',
                background: activeDropName === dn ? purpleD : '#ede9fe',
                color: activeDropName === dn ? '#fff' : purpleD,
              }}>{dn}</button>
          ))}
          {/* Add new drop name */}
          {showDropNameMgr ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input autoFocus value={newDropNameInput} onChange={e => setNewDropNameInput(e.target.value)}
                placeholder="New name…" maxLength={40}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newDropNameInput.trim()) {
                    setActiveDropName(newDropNameInput.trim())
                    setNewDropNameInput('')
                    setShowDropNameMgr(false)
                  }
                  if (e.key === 'Escape') { setShowDropNameMgr(false); setNewDropNameInput('') }
                }}
                style={{ fontSize: 11, border: `1.5px solid ${border}`, borderRadius: 6, padding: '3px 8px', outline: 'none', width: 110 }} />
              <button onClick={() => {
                if (newDropNameInput.trim()) { setActiveDropName(newDropNameInput.trim()); setNewDropNameInput('') }
                setShowDropNameMgr(false)
              }} style={{ fontSize: 11, background: purpleD, color: '#fff', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>✓</button>
              <button onClick={() => { setShowDropNameMgr(false); setNewDropNameInput('') }}
                style={{ fontSize: 11, background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <button onClick={() => setShowDropNameMgr(true)}
              style={{ fontSize: 11, fontWeight: 700, background: 'none', border: `1.5px dashed ${border}`, borderRadius: 20, padding: '3px 10px', cursor: 'pointer', color: gray }}>
              + New
            </button>
          )}
        </div>

      {/* Body */}
      <div className="sb-layout">

        {/* Sidebar — brand list */}
        <div className="sb-sidebar">
          {/* Filter existing brands */}
          {brandsInSeason.length > 0 && (
            <div style={{ padding: '6px 12px', borderBottom: `1px solid ${border}` }}>
              <input value={viewFilter} onChange={e => setViewFilter(e.target.value)}
                placeholder="Filter brands…"
                style={{ ...inp, fontSize: 11 }} />
            </div>
          )}

          {/* Brand list */}
          {loading ? (
            <p style={{ padding: 16, fontSize: 12, color: gray }}>Loading…</p>
          ) : brandsInSeason.length === 0 ? (
            <p style={{ padding: 16, fontSize: 12, color: gray, textAlign: 'center' }}>No brands logged for {season} yet.</p>
          ) : filteredBrands.map(b => {
            const bRows = activeDropName
              ? rows.filter(r => r.brand === b && r.drop_name === activeDropName)
              : rows.filter(r => r.brand === b)
            const totalBal = bRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
            const hasOwing = totalBal > 0.001
            return (
              <div key={b} className={`sb-brand-row${activeBrand === b ? ' active' : ''}`}
                onClick={() => {
                  const next = activeBrand === b ? '' : b
                  setActiveBrand(next)
                  if (next) {
                    setTimeout(() => {
                      document.getElementById(`brand-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 50)
                  }
                }}>
                {(() => {
                  const vids = brandToVendors.get(b)
                  if (!vids || vids.length === 0) return null
                  if (vids.length === 1) return (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
                      {vids[0]}
                    </span>
                  )
                  return (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
                      {vids.length}+
                    </span>
                  )
                })()}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</span>
                {hasOwing && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1px 5px', flexShrink: 0 }}>
                    {fmt$(totalBal)}
                  </span>
                )}
              </div>
            )
          })}
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
                  const vendorBrands = new Set(VENDOR_DATA.filter(v => v.vendor_id === activeVendorId).map(v => v.brand))
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

              {/* All brands — compact cards (filtered by drop name if active) */}
              {filteredBrands
                .filter(b => !activeBrand || b === activeBrand)
                .map(brand => {
                  // Scope rows to active drop name filter
                  const allBRows = rows.filter(r => r.brand === brand)
                  const bRows = activeDropName
                    ? allBRows.filter(r => r.drop_name === activeDropName)
                    : allBRows
                  if (bRows.length === 0) return null
                  const bDrops = Array.from(new Set(bRows.map(r => r.drop_num))).sort((a, b) => a - b)
                  const totBal = bRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                  const totInit = bRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                  const isHighlighted = activeBrand === brand
                  const storesPresent = STORES.filter(s => bRows.some(r => r.store === s))

                  return (
                    <div key={brand} id={`brand-${brand}`}
                      style={{ marginBottom: 16, border: `2px solid ${isHighlighted ? purple : border}`, borderRadius: 10, background: '#fff', overflow: 'hidden' }}>

                      {/* Brand header — single-click to open full invoice view */}
                      <div
                        onClick={() => { setInvoiceBrand(brand); setInvoiceStoreFilter(null); setModal('invoice') }}
                        title="Click to open invoice view"
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: isHighlighted ? '#ede9fe' : '#f5f3ff', borderBottom: `1px solid ${border}`, flexWrap: 'wrap', cursor: 'pointer' }}>
                        {(() => {
                          const vids = brandToVendors.get(brand)
                          if (!vids || vids.length === 0) return null
                          if (vids.length === 1) return (
                            <span
                              onClick={e => { e.stopPropagation(); setActiveVendorId(activeVendorId === vids[0] ? null : vids[0]) }}
                              title={`Filter by vendor ${vids[0]}`}
                              style={{ fontSize: 10, fontWeight: 700, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '1px 7px', cursor: 'pointer' }}>
                              {vids[0]}
                            </span>
                          )
                          return vids.map(vid => (
                            <span key={vid}
                              onClick={e => { e.stopPropagation(); setActiveVendorId(activeVendorId === vid ? null : vid) }}
                              title={`Filter by vendor ${vid}`}
                              style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: '1px 7px', cursor: 'pointer' }}>
                              {vid}
                            </span>
                          ))
                        })()}
                        <span style={{ fontSize: 15, fontWeight: 900, color: purpleD }}>{brand}</span>
                        <span style={{ fontSize: 11, color: gray, background: '#ede9fe', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>{season}</span>
                        <span style={{ fontSize: 11, color: gray }}>{bDrops.length} drop{bDrops.length !== 1 ? 's' : ''}</span>
                        {totBal <= 0.001 && totInit > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#166534', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1px 7px' }}>
                            ✓ Paid
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: gray, marginLeft: 'auto' }}>click to open invoice</span>
                      </div>

                      {/* Per-store summary rows — click to open single-store invoice */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#f8f7ff' }}>
                            <th style={{ padding: '5px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Store</th>
                            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Invoice #</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Units</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Total</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Deposits</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}>Balance Due</th>
                            <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: gray, borderBottom: `1px solid ${border}` }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {storesPresent.map(store => {
                            const sRows = bRows.filter(r => r.store === store)
                            const activeRows = sRows.filter(r => !r.is_cancelled)
                            const sUnits = activeRows.reduce((s, r) => s + (r.units ?? 0), 0)
                            const sInit  = activeRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                            const sDep   = activeRows.reduce((s, r) => s + (r.deposit ?? 0), 0)
                            const sBal   = activeRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                            const hasCancelled = sRows.some(r => r.is_cancelled)
                            // Collect unique invoice #s for this store (active only)
                            const invoiceNums = Array.from(new Set(activeRows.map(r => r.invoice_num).filter((n): n is string => !!n)))
                            return (
                              <tr key={store}
                                onClick={() => { setInvoiceBrand(brand); setInvoiceStoreFilter(store); setModal('invoice') }}
                                title="Click to view store invoice"
                                style={{ cursor: 'pointer', borderBottom: `1px solid #f3f4f6` }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#faf8ff')}
                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                <td style={{ padding: '8px 14px', fontWeight: 800, color: purpleD, whiteSpace: 'nowrap' }}>
                                  {store}
                                  {hasCancelled && <span style={{ fontSize: 9, fontWeight: 700, color: '#dc2626', marginLeft: 4 }}>🚫</span>}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                                  {invoiceNums.length > 0 ? invoiceNums.map(inv => (
                                    <span key={inv} style={{ fontSize: 10, color: '#1e40af', fontWeight: 700, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 5px', marginRight: 3, whiteSpace: 'nowrap' }}>
                                      {inv}
                                    </span>
                                  )) : <span style={{ color: gray }}>—</span>}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{sUnits || '—'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{fmt$(sInit)}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#166534' }}>{fmt$(sDep)}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: sBal > 0.001 ? '#dc2626' : '#166534' }}>{fmt$(sBal)}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                  <span style={{ fontSize: 10, color: gray }}>view →</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        {/* Total Owed footer — aligns under Balance Due */}
                        {storesPresent.length > 1 && (
                          <tfoot>
                            <tr style={{ background: totBal > 0.001 ? '#fef2f2' : '#f0fdf4', borderTop: `2px solid ${border}` }}>
                              <td colSpan={5} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 800, color: totBal > 0.001 ? '#dc2626' : '#166534', textAlign: 'right' }}>
                                Total Owed
                              </td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 13, fontWeight: 900, color: totBal > 0.001 ? '#dc2626' : '#166534' }}>
                                {fmt$(totBal)}
                              </td>
                              <td style={{ padding: '6px 10px' }} />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )
                })
              }

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
          <div className="modal-box">
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

              {/* Drop number */}
              <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={lbl}>Drop #</label>
                <input type="number" min={1} value={formDrop}
                  onChange={e => setFormDrop(parseInt(e.target.value) || 1)}
                  style={{ ...inp, width: 70 }} />
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
                      {/* Row 1: Invoice # + Order # + Drop Name */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lbl}>Invoice #</label>
                          <input value={entry.invoice_num} placeholder="INV-001"
                            onChange={e => upd({ invoice_num: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Order #</label>
                          <input value={entry.order_num} placeholder="ORD-001"
                            onChange={e => upd({ order_num: e.target.value })} style={inp} />
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                      {/* Row 3: Deposit + Duties + Payment Date */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lbl}>Deposit ({sym})</label>
                          <input type="number" value={entry.deposit} placeholder="0.00" step="0.01"
                            onChange={e => upd({ deposit: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Duties ({sym})</label>
                          <input type="number" value={entry.duties} placeholder="0.00" step="0.01"
                            onChange={e => upd({ duties: e.target.value })} style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Payment Date</label>
                          <input type="date" value={entry.payment_date}
                            onChange={e => upd({ payment_date: e.target.value })} style={inp} />
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
                        const bal  = init - dep - dut
                        return (
                          <div style={{ background: bal > 0.001 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${bal > 0.001 ? '#fca5a5' : '#86efac'}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, color: bal > 0.001 ? '#dc2626' : '#166534', fontWeight: 700 }}>
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
        const liveBal = init - dep - dut
        const isCancelled = editRow.is_cancelled ?? false

        return (
          <div className="modal-bg">
            <div className="modal-box" style={{ maxWidth: 560 }}>

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
                    Drop {editRow.drop_num}{editRow.drop_name ? ` · ${editRow.drop_name}` : ''} · {season}
                  </div>
                </div>
                <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
              </div>

              <div className="modal-body" style={{ opacity: isCancelled ? 0.7 : 1 }}>

                {/* Section 1: Reference fields */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: gray, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Reference</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={lbl}>Invoice #</label>
                      <input value={entry.invoice_num} placeholder="INV-001"
                        onChange={e => upd({ invoice_num: e.target.value })} style={inp} />
                    </div>
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

                {/* Divider */}
                <div style={{ height: 1, background: border, marginBottom: 14 }} />

                {/* Section 2: Financials — 2 column layout */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: gray, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Financials</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
                          onChange={e => upd({ deposit: e.target.value })} style={inp} />
                      </div>
                    </div>
                    {/* Right column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={lbl}>Duties ({sym})</label>
                        <input type="number" value={entry.duties} step="0.01" placeholder="0.00"
                          onChange={e => upd({ duties: e.target.value })} style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Payment Date</label>
                        <input type="date" value={entry.payment_date}
                          onChange={e => upd({ payment_date: e.target.value })} style={inp} />
                      </div>
                      {/* Live balance — right column bottom */}
                      <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                        <label style={{ ...lbl, color: liveBal > 0.001 ? '#dc2626' : '#166534' }}>Balance Due</label>
                        <div style={{
                          background: liveBal > 0.001 ? '#fef2f2' : '#f0fdf4',
                          border: `1.5px solid ${liveBal > 0.001 ? '#fca5a5' : '#86efac'}`,
                          borderRadius: 7, padding: '7px 10px',
                          fontSize: 15, fontWeight: 900,
                          color: liveBal > 0.001 ? '#dc2626' : '#166534',
                        }}>
                          {sym}{liveBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Comment — full width */}
                <div style={{ marginBottom: 16 }}>
                  <label style={lbl}>Comment</label>
                  <input value={entry.comment} placeholder="Optional note"
                    onChange={e => upd({ comment: e.target.value })} style={inp} />
                </div>

                {/* Action bar */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  {/* Left: quick-add + cancel-drop */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {!siblingExists && siblingStore && (
                      <button
                        onClick={() => {
                          setModal('none')
                          setActiveBrand(editRow.brand)
                          setFormDrop(editRow.drop_num)
                          setFormStores([blankEntry(siblingStore)])
                          setModal('new-entry')
                        }}
                        style={{ background: '#ede9fe', color: purpleD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        + Log {siblingStore}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setModal('none')
                        setActiveBrand(editRow.brand)
                        setFormDrop(maxDrop + 1)
                        setFormStores(STORES.map(blankEntry))
                        setModal('new-entry')
                      }}
                      style={{ background: '#ede9fe', color: purpleD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      + Drop {maxDrop + 1}
                    </button>
                    {/* Cancel/uncancel toggle */}
                    <button
                      onClick={async () => { await toggleCancelled(editRow); setModal('none') }}
                      style={{
                        background: isCancelled ? '#f0fdf4' : '#fff5f5',
                        color: isCancelled ? '#166534' : '#dc2626',
                        border: `1.5px solid ${isCancelled ? '#86efac' : '#fca5a5'}`,
                        borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer'
                      }}>
                      {isCancelled ? '✓ Uncancel' : '🚫 Cancel Drop'}
                    </button>
                  </div>
                  {/* Right: dismiss / save */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setModal('none')} disabled={saving}
                      style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Dismiss
                    </button>
                    <button onClick={saveEdit} disabled={saving}
                      style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Invoice Modal ───────────────────────────────────────────────────── */}
      {modal === 'invoice' && invoiceBrand && (() => {
        const iRows = rows.filter(r => r.brand === invoiceBrand)
        const storesToShow = invoiceStoreFilter
          ? [invoiceStoreFilter]
          : STORES.filter(s => iRows.some(r => r.store === s))
        const iDrops = Array.from(new Set(iRows.map(r => r.drop_num))).sort((a, b) => a - b)
        const sideBySide = !invoiceStoreFilter && storesToShow.length > 1

        return (
          <div className="modal-bg">
            <div className="modal-box" style={{ maxWidth: sideBySide ? 860 : 520 }}>
              <div className="modal-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: purpleD }}>📄 {invoiceBrand}</div>
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
                  <button onClick={() => { setQuickPayBrand(invoiceBrand); setQuickPayAmt(''); setQuickPayDate(today()); setPaySelectedIds(new Set()); setModal('quick-pay') }}
                    style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    💳 Pay
                  </button>
                  <button onClick={() => { setModal('none'); openNewEntry(invoiceBrand) }}
                    style={{ background: '#ede9fe', color: purpleD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    + Drop
                  </button>
                  <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
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
                            {sDrops.map((dropNum, di) => {
                              const dRow = sRows.find(r => r.drop_num === dropNum)!
                              const bal = dRow.balance_due ?? 0
                              const isLast = di === sDrops.length - 1
                              const isRowCancelled = dRow.is_cancelled ?? false
                              return (
                                <div key={dropNum}
                                  style={{ borderBottom: isLast ? 'none' : `1px solid #f3f4f6`, padding: '10px 12px', background: isRowCancelled ? '#fafafa' : undefined, opacity: isRowCancelled ? 0.7 : 1 }}>
                                  {/* Drop header row */}
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ fontWeight: 800, fontSize: 12, color: isRowCancelled ? gray : purpleD, textDecoration: isRowCancelled ? 'line-through' : undefined }}>Drop {dropNum}{dRow.drop_name ? ` · ${dRow.drop_name}` : ''}</span>
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
                                    <button
                                      onClick={() => { setModal('none'); openEdit(dRow) }}
                                      style={{ fontSize: 10, color: gray, background: '#f3f4f6', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>
                                      Edit
                                    </button>
                                  </div>

                                  {/* Drop detail grid */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px', fontSize: 11 }}>
                                    {dRow.units != null && (
                                      <div style={{ color: gray }}>Units: <span style={{ color: '#374151', fontWeight: 600 }}>{dRow.units}</span></div>
                                    )}
                                    <div style={{ color: gray }}>Total: <span style={{ color: '#374151', fontWeight: 600 }}>{fmt$(dRow.initial_total, dRow.currency)}</span></div>
                                    <div style={{ color: gray }}>Deposits: <span style={{ color: '#166534', fontWeight: 600 }}>{fmt$(dRow.deposit, dRow.currency)}</span></div>
                                    {(dRow.duties ?? 0) > 0 && (
                                      <div style={{ color: gray }}>Duties: <span style={{ color: '#92400e', fontWeight: 600 }}>{fmt$(dRow.duties, dRow.currency)}</span></div>
                                    )}
                                    {dRow.payment_date && (
                                      <div style={{ color: gray }}>Paid on: <span style={{ color: '#374151', fontWeight: 600 }}>{fmtDate(dRow.payment_date)}</span></div>
                                    )}
                                    {dRow.comment && (
                                      <div style={{ color: gray, gridColumn: 'span 2' }}>Note: <span style={{ color: '#374151' }}>{dRow.comment}</span></div>
                                    )}
                                  </div>

                                  {/* Balance chip */}
                                  <div style={{ marginTop: 7 }}>
                                    <span style={{ fontSize: 12, fontWeight: 800, color: bal > 0.001 ? '#dc2626' : '#166534', background: bal > 0.001 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${bal > 0.001 ? '#fca5a5' : '#86efac'}`, borderRadius: 6, padding: '2px 8px' }}>
                                      {bal > 0.001 ? `Balance: ${fmt$(bal, dRow.currency)}` : '✓ Paid'}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}

                            {/* Store total footer */}
                            <div style={{ background: '#f5f3ff', borderTop: `1.5px solid ${border}`, padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <div style={{ fontSize: 11, color: gray, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                <span>Total: <strong style={{ color: purpleD }}>{fmt$(storeTotInit)}</strong></span>
                                <span>Deposit: <strong style={{ color: '#166534' }}>{fmt$(storeDeposit)}</strong></span>
                                {storeDuties > 0 && <span>Duties: <strong style={{ color: '#92400e' }}>{fmt$(storeDuties)}</strong></span>}
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 800, color: storeBal > 0.001 ? '#dc2626' : '#166534' }}>
                                {storeBal > 0.001 ? `Owe ${fmt$(storeBal)}` : '✓ Clear'}
                              </span>
                            </div>
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
                  return (
                    <div style={{ marginTop: 14, background: purpleD, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#e9d5ff', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span>Grand Total: <strong style={{ color: '#fff' }}>{fmt$(grandInit)}</strong></span>
                        <span>Deposits: <strong style={{ color: '#a7f3d0' }}>{fmt$(grandDep)}</strong></span>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 900, color: grandBal > 0.001 ? '#fca5a5' : '#a7f3d0' }}>
                        {grandBal > 0.001 ? `Balance: ${fmt$(grandBal)}` : '✓ Fully Paid'}
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
        // All rows with a balance — optionally filtered to pre-selected brand
        const allBalanceRows = rows.filter(r => (r.balance_due ?? 0) > 0.001)
        const filteredRows = quickPayBrand
          ? allBalanceRows.filter(r => r.brand === quickPayBrand)
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

                {/* Brand filter — typeahead search */}
                {(() => {
                  const allBrandsWithBal = Array.from(new Set(allBalanceRows.map(r => r.brand))).sort()
                  const searchResults = payBrandSearch.trim()
                    ? allBrandsWithBal.filter(b => b.toLowerCase().includes(payBrandSearch.toLowerCase()))
                    : allBrandsWithBal
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 7, border: `1.5px solid ${border}`, overflow: 'hidden' }}>
                          <span style={{ padding: '0 8px', color: gray, fontSize: 13 }}>🔍</span>
                          <input
                            value={payBrandSearch}
                            onChange={e => setPayBrandSearch(e.target.value)}
                            placeholder="Search brand…"
                            style={{ background: 'transparent', border: 'none', outline: 'none', color: '#111', fontSize: 12, fontWeight: 500, padding: '6px 8px 6px 0', flex: 1 }}
                          />
                          {payBrandSearch && (
                            <button onClick={() => setPayBrandSearch('')}
                              style={{ background: 'none', border: 'none', color: gray, cursor: 'pointer', padding: '0 8px', fontSize: 13 }}>✕</button>
                          )}
                        </div>
                        {quickPayBrand && (
                          <button onClick={() => { setQuickPayBrand(null); setPaySelectedIds(new Set()); setPayBrandSearch('') }}
                            style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7, border: `1.5px solid ${border}`, background: '#f5f3ff', color: gray, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Clear filter
                          </button>
                        )}
                      </div>
                      {/* Show brand results as compact chips when searching */}
                      {payBrandSearch.trim() && searchResults.length > 0 && (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 80, overflowY: 'auto', padding: '4px 2px' }}>
                          {searchResults.map(b => (
                            <button key={b} onClick={() => { setQuickPayBrand(b); setPaySelectedIds(new Set()); setPayBrandSearch('') }}
                              style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${quickPayBrand === b ? purpleD : border}`, background: quickPayBrand === b ? purpleD : '#fff', color: quickPayBrand === b ? '#fff' : gray, cursor: 'pointer' }}>
                              {b}
                            </button>
                          ))}
                        </div>
                      )}
                      {quickPayBrand && (
                        <div style={{ fontSize: 11, color: purpleD, fontWeight: 700, padding: '2px 4px' }}>
                          Filtering: <span style={{ background: '#ede9fe', borderRadius: 6, padding: '1px 7px' }}>{quickPayBrand}</span>
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
                              <div style={{ fontSize: 10, fontWeight: 800, color: purpleD, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, paddingLeft: 2 }}>{brand}</div>
                            )}
                            {brandRows.map(r => (
                              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: paySelectedIds.has(r.id) ? '#f5f3ff' : '#fafafa', border: `1px solid ${paySelectedIds.has(r.id) ? purpleD : border}`, borderRadius: 7, padding: '7px 12px', marginBottom: 5, cursor: 'pointer' }}>
                                <input type="checkbox" checked={paySelectedIds.has(r.id)} onChange={() => toggleRow(r.id)}
                                  style={{ accentColor: purpleD, width: 14, height: 14, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontWeight: 700, color: purpleD, fontSize: 13 }}>{r.store}</span>
                                  <span style={{ fontSize: 11, color: gray, marginLeft: 6 }}>Drop {r.drop_num}</span>
                                  {!quickPayBrand && <span style={{ fontSize: 11, color: gray, marginLeft: 6 }}>· {r.brand}</span>}
                                </div>
                                <span style={{ fontWeight: 800, color: '#dc2626', fontSize: 13, flexShrink: 0 }}>{fmt$(r.balance_due, r.currency)} due</span>
                              </label>
                            ))}
                          </div>
                        )
                      })}
                    </div>

                    {/* Amount + date */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
                      <div>
                        <label style={lbl}>Amount</label>
                        <input type="number" value={quickPayAmt} onChange={e => setQuickPayAmt(e.target.value)}
                          placeholder="0.00" step="0.01" autoFocus style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Payment Date</label>
                        <input type="date" value={quickPayDate} onChange={e => setQuickPayDate(e.target.value)} style={inp} />
                      </div>
                    </div>

                    {selectedRows.length === 0 && (
                      <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8 }}>⚠ Select at least one row to apply payment to.</div>
                    )}

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                      <button onClick={() => setModal('none')}
                        style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button disabled={selectedRows.length === 0 || !quickPayAmt || !user}
                        onClick={async () => {
                          if (!quickPayAmt || !user || selectedRows.length === 0) return
                          for (const r of selectedRows) {
                            await addPayment(r, quickPayAmt, quickPayDate)
                          }
                          setModal('none')
                        }}
                        style={{ background: selectedRows.length === 0 || !quickPayAmt ? '#c4b5fd' : purple, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: selectedRows.length === 0 || !quickPayAmt ? 'not-allowed' : 'pointer' }}>
                        Apply to {selectedRows.length > 0 ? `${selectedRows.length} Row${selectedRows.length > 1 ? 's' : ''}` : 'Selected'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
                  Vendor {vid}
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

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#dc2626' : '#3b1f8c', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  )
}

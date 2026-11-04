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
}

function blankEntry(store: string): StoreEntry {
  return { store, units: '', initial_total: '', deposit: '', duties: '', payment_date: today(), comment: '', currency: 'USD' }
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

  // Data
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(false)

  // Brand search / create
  const [brandQ, setBrandQ] = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<string[]>([])
  const [showBrandDrop, setShowBrandDrop] = useState(false)
  const brandRef = useRef<HTMLDivElement>(null)

  // Active brand being viewed/edited
  const [activeBrand, setActiveBrand] = useState<string | null>(null)

  // Modal: new log entry
  const [modal, setModal] = useState<'none'|'new-entry'|'edit-entry'|'add-payment'>('none')
  const [editRow, setEditRow] = useState<LedgerRow | null>(null)

  // Form state: drop number + per-store entries (TTC + TTP simultaneously)
  const [formDrop, setFormDrop] = useState(1)
  const [formStores, setFormStores] = useState<StoreEntry[]>(STORES.map(blankEntry))
  const [saving, setSaving] = useState(false)

  // Filter/view
  const [viewFilter, setViewFilter] = useState('')

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3000)
  }

  const isAdmin = user?.store === 'ALL'

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

  // ── Brand autocomplete ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!brandQ.trim()) { setBrandSuggestions([]); return }
    const q = brandQ.toLowerCase()
    // Combine BRAND_LIST with brands already in this season's data
    const inSeason = Array.from(new Set(rows.map(r => r.brand)))
    const all = Array.from(new Set([...BRAND_LIST, ...inSeason]))
    setBrandSuggestions(all.filter(b => b.toLowerCase().includes(q)).slice(0, 10))
  }, [brandQ, rows])

  // Close brand dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (brandRef.current && !brandRef.current.contains(e.target as Node)) {
        setShowBrandDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Computed: brands in this season ───────────────────────────────────────
  const brandsInSeason = Array.from(new Set(rows.map(r => r.brand))).sort()
  const filteredBrands = viewFilter
    ? brandsInSeason.filter(b => b.toLowerCase().includes(viewFilter.toLowerCase()))
    : brandsInSeason

  // Rows for active brand
  const brandRows = activeBrand ? rows.filter(r => r.brand === activeBrand) : []

  // Group by drop for active brand
  const drops = Array.from(new Set(brandRows.map(r => r.drop_num))).sort((a,b) => a-b)

  // ── Open new entry modal ───────────────────────────────────────────────────
  function openNewEntry(brand: string) {
    setActiveBrand(brand)
    // Determine next drop number for this brand
    const existing = rows.filter(r => r.brand === brand)
    const maxDrop = existing.length > 0 ? Math.max(...existing.map(r => r.drop_num)) : 0
    setFormDrop(maxDrop + 1)
    setFormStores(STORES.map(blankEntry))
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
          payment_date: e.payment_date || null,
          comment: e.comment || null,
          currency: e.currency,
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
      payment_date: e.payment_date || null,
      comment: e.comment || null,
      currency: e.currency,
      updated_at: new Date().toISOString(),
    }).eq('id', editRow.id)
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
    showToast('✅ Entry updated')
    setModal('none')
    fetchRows(season, user)
    setSaving(false)
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
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; }
        .sb-header { padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-bottom: 2px solid ${border}; background: ${purpleD}; }
        .sb-season-btn { padding: 5px 12px; border-radius: 20px; border: 1.5px solid; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.12s; }
        .sb-season-btn.active { background: #fff; color: ${purpleD}; border-color: #fff; }
        .sb-season-btn:not(.active) { background: rgba(255,255,255,0.12); color: #e9d5ff; border-color: rgba(255,255,255,0.3); }
        .sb-season-btn:hover:not(.active) { background: rgba(255,255,255,0.22); }
        .sb-layout { display: flex; flex: 1; overflow: hidden; }
        .sb-sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid ${border}; background: rgba(255,255,255,0.7); overflow-y: auto; }
        .sb-main { flex: 1; overflow-y: auto; padding: 16px; }
        .sb-brand-row { padding: 8px 14px; cursor: pointer; border-bottom: 1px solid #ede9fe; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 13px; font-weight: 600; color: #374151; transition: background 0.1s; }
        .sb-brand-row:hover, .sb-brand-row.active { background: #ede9fe; color: ${purpleD}; }
        .sb-brand-row.active { font-weight: 800; }
        .drop-card { background: #fff; border: 1.5px solid ${border}; border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
        .drop-head { background: #ede9fe; padding: 7px 14px; display: flex; align-items: center; gap: 10px; }
        .store-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .store-table th { padding: 5px 10px; text-align: left; font-size: 11px; font-weight: 700; color: #1e3a8a; background: #dbeafe; border-bottom: 1.5px solid #93c5fd; white-space: nowrap; }
        .store-table td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
        .store-table tr:last-child td { border-bottom: none; }
        .bal-green { color: #15803d; font-weight: 700; }
        .bal-red   { color: #dc2626; font-weight: 700; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 16px; overflow-y: auto; }
        .modal-box { background: #fff; border-radius: 14px; width: 100%; max-width: 680px; box-shadow: 0 8px 48px rgba(0,0,0,0.22); }
        .modal-head { padding: 14px 18px; border-bottom: 1px solid #ede9fe; display: flex; align-items: center; justify-content: space-between; }
        .modal-body { padding: 16px 18px 20px; }
        .store-block { border: 1.5px solid #e0e7ff; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
        .store-block-head { font-size: 12px; font-weight: 800; color: ${purpleD}; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media (max-width: 600px) {
          .sb-layout { flex-direction: column; }
          .sb-sidebar { width: 100%; border-right: none; border-bottom: 1px solid ${border}; max-height: 180px; }
          .sb-main { padding: 10px; }
          .form-grid { grid-template-columns: 1fr; }
          .store-table th, .store-table td { font-size: 11px; padding: 4px 6px; }
        }
      `}</style>

      {/* Header */}
      <div className="sb-header">
        <button onClick={() => router.push('/selector')}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#e9d5ff', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '4px 10px' }}>
          ← Home
        </button>
        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.3)' }} />
        <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: '0.08em' }}>📒 SEASON BOOK</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {allSeasons.map(s => (
            <button key={s} className={`sb-season-btn${season === s ? ' active' : ''}`}
              onClick={() => { setSeason(s); setActiveBrand(null) }}>
              {s}
            </button>
          ))}
          {showNewSeason ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input value={newSeasonInput} onChange={e => setNewSeasonInput(e.target.value.toUpperCase())}
                placeholder="SS28" maxLength={5}
                onKeyDown={e => e.key === 'Enter' && createSeason()}
                style={{ width: 60, padding: '3px 6px', borderRadius: 5, border: '1.5px solid #e9d5ff', fontSize: 12, fontWeight: 700 }} />
              <button onClick={createSeason}
                style={{ background: '#fff', color: purpleD, border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓</button>
              <button onClick={() => setShowNewSeason(false)}
                style={{ background: 'rgba(255,255,255,0.15)', color: '#e9d5ff', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <button onClick={() => setShowNewSeason(true)}
              style={{ background: 'rgba(255,255,255,0.12)', color: '#e9d5ff', border: '1.5px dashed rgba(255,255,255,0.4)', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + Season
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="sb-layout">

        {/* Sidebar — brand list */}
        <div className="sb-sidebar">
          {/* Brand search / add */}
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${border}`, position: 'relative' }} ref={brandRef}>
            <input
              value={brandQ}
              onChange={e => { setBrandQ(e.target.value); setShowBrandDrop(true) }}
              onFocus={() => setShowBrandDrop(true)}
              placeholder="Search or add brand…"
              style={{ ...inp, fontSize: 12 }}
            />
            {showBrandDrop && brandQ.trim() && (
              <div style={{ position: 'absolute', top: '100%', left: 12, right: 12, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 50, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                {brandSuggestions.length > 0 ? brandSuggestions.map(b => (
                  <div key={b}
                    onClick={() => { setActiveBrand(b); setBrandQ(''); setShowBrandDrop(false) }}
                    style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, borderBottom: '1px solid #f3f4f6' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#ede9fe')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    {b}
                  </div>
                )) : (
                  <div style={{ padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: gray, marginBottom: 6 }}>No match — create new?</div>
                    <button
                      onClick={() => { setActiveBrand(brandQ.trim()); setBrandQ(''); setShowBrandDrop(false) }}
                      style={{ background: purple, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      + &ldquo;{brandQ.trim()}&rdquo;
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

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
            const bRows = rows.filter(r => r.brand === b)
            const totalBal = bRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
            const hasOwing = totalBal > 0.001
            return (
              <div key={b} className={`sb-brand-row${activeBrand === b ? ' active' : ''}`}
                onClick={() => setActiveBrand(b)}>
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
          {!activeBrand ? (
            <div style={{ textAlign: 'center', paddingTop: 60, color: gray }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📒</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: purpleD, marginBottom: 6 }}>{season} Season Book</div>
              <div style={{ fontSize: 13, color: gray }}>
                {brandsInSeason.length > 0
                  ? `${brandsInSeason.length} brand${brandsInSeason.length !== 1 ? 's' : ''} logged — select one from the sidebar`
                  : 'Search for a brand above to get started'}
              </div>
            </div>
          ) : (
            <>
              {/* Brand header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: purpleD }}>{activeBrand}</span>
                <span style={{ fontSize: 12, color: gray, background: '#ede9fe', borderRadius: 10, padding: '2px 8px', fontWeight: 600 }}>{season}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => openNewEntry(activeBrand)}
                  style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  + Log Drop
                </button>
              </div>

              {/* Summary row */}
              {brandRows.length > 0 && (() => {
                const totInit  = brandRows.reduce((s, r) => s + (r.initial_total ?? 0), 0)
                const totDep   = brandRows.reduce((s, r) => s + (r.deposit ?? 0), 0)
                const totDut   = brandRows.reduce((s, r) => s + (r.duties ?? 0), 0)
                const totBal   = brandRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
                const totUnits = brandRows.reduce((s, r) => s + (r.units ?? 0), 0)
                return (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Total Units', val: totUnits || '—', color: purpleD },
                      { label: 'Initial Total', val: fmt$(totInit), color: '#1e40af' },
                      { label: 'Deposits Paid', val: fmt$(totDep), color: '#166534' },
                      { label: 'Duties', val: fmt$(totDut), color: '#92400e' },
                      { label: 'Balance Due', val: fmt$(totBal), color: totBal > 0.001 ? '#dc2626' : '#166534' },
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 8, padding: '8px 14px', flex: '1 1 100px', minWidth: 100 }}>
                        <div style={{ fontSize: 10, color: gray, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color }}>{val}</div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Drops */}
              {brandRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: gray, fontSize: 13 }}>
                  No entries yet for {activeBrand} in {season}. Click &ldquo;+ Log Drop&rdquo; to start.
                </div>
              ) : drops.map(dropNum => {
                const dropRows = brandRows.filter(r => r.drop_num === dropNum)
                return (
                  <div key={dropNum} className="drop-card">
                    <div className="drop-head">
                      <span style={{ fontSize: 13, fontWeight: 800, color: purpleD }}>Drop {dropNum}</span>
                      <span style={{ fontSize: 11, color: gray, marginLeft: 'auto' }}>
                        {dropRows.map(r => r.store).join(' · ')}
                      </span>
                    </div>
                    <table className="store-table">
                      <thead>
                        <tr>
                          <th>Store</th>
                          <th>Cur</th>
                          <th>Units</th>
                          <th>Initial Total</th>
                          <th>Deposits</th>
                          <th>Duties</th>
                          <th>Balance Due</th>
                          <th>Payment Date</th>
                          <th>Comment</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {dropRows.map(r => {
                          const bal = r.balance_due ?? 0
                          return (
                            <tr key={r.id}>
                              <td style={{ fontWeight: 700, color: purpleD }}>{r.store}</td>
                              <td>
                                <span style={{ fontSize: 10, fontWeight: 700, background: r.currency === 'EUR' ? '#fef3c7' : '#eff6ff', color: r.currency === 'EUR' ? '#92400e' : '#1e40af', border: `1px solid ${r.currency === 'EUR' ? '#fcd34d' : '#93c5fd'}`, borderRadius: 4, padding: '1px 4px' }}>
                                  {r.currency ?? 'USD'}
                                </span>
                              </td>
                              <td>{r.units ?? '—'}</td>
                              <td>{fmt$(r.initial_total, r.currency)}</td>
                              <td>
                                <div>{fmt$(r.deposit, r.currency)}</div>
                                <PaymentRow row={r} />
                              </td>
                              <td>{fmt$(r.duties, r.currency)}</td>
                              <td className={bal > 0.001 ? 'bal-red' : bal < -0.001 ? 'bal-green' : ''}>
                                {fmt$(r.balance_due, r.currency)}
                              </td>
                              <td style={{ fontSize: 11, color: gray }}>{fmtDate(r.payment_date)}</td>
                              <td style={{ fontSize: 11, color: gray, maxWidth: 160 }}>{r.comment || '—'}</td>
                              <td>
                                <button onClick={() => openEdit(r)}
                                  style={{ background: '#ede9fe', color: purpleD, border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                  Edit
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* ── New Entry Modal ──────────────────────────────────────────────────── */}
      {modal === 'new-entry' && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setModal('none') }}>
          <div className="modal-box">
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: purpleD }}>{activeBrand}</div>
                <div style={{ fontSize: 12, color: gray }}>New Drop — {season}</div>
              </div>
              <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
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
                return (
                  <div key={entry.store} className="store-block">
                    <div className="store-block-head">
                      <span style={{ background: purple, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>{entry.store}</span>
                      <select value={entry.currency}
                        onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, currency: e.target.value as Currency } : p))}
                        style={{ fontSize: 11, fontWeight: 700, border: '1.5px solid #d1d5db', borderRadius: 5, padding: '2px 6px', background: '#f5f3ff', color: purpleD, cursor: 'pointer' }}>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                      </select>
                    </div>
                    <div className="form-grid">
                      <div>
                        <label style={lbl}>Units</label>
                        <input type="number" value={entry.units} placeholder="0"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, units: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Initial Total ({sym})</label>
                        <input type="number" value={entry.initial_total} placeholder="0.00" step="0.01"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, initial_total: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Deposit ({sym})</label>
                        <input type="number" value={entry.deposit} placeholder="0.00" step="0.01"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, deposit: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Duties ({sym})</label>
                        <input type="number" value={entry.duties} placeholder="0.00" step="0.01"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, duties: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Payment Date</label>
                        <input type="date" value={entry.payment_date}
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, payment_date: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Comment</label>
                        <input value={entry.comment} placeholder="Optional note"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, comment: e.target.value } : p))}
                          style={inp} />
                      </div>
                    </div>
                    {/* Live balance preview */}
                    {(entry.initial_total || entry.deposit || entry.duties) && (() => {
                      const init = parseFloat(entry.initial_total) || 0
                      const dep  = parseFloat(entry.deposit) || 0
                      const dut  = parseFloat(entry.duties) || 0
                      const bal  = init - dep - dut
                      return (
                        <div style={{ marginTop: 8, fontSize: 12, color: bal > 0.001 ? '#dc2626' : '#166534', fontWeight: 700 }}>
                          Balance Due: {sym}{bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      )
                    })()}
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
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Entry Modal ─────────────────────────────────────────────────── */}
      {modal === 'edit-entry' && editRow && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setModal('none') }}>
          <div className="modal-box">
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: purpleD }}>{editRow.brand} — {editRow.store}</div>
                <div style={{ fontSize: 12, color: gray }}>Drop {editRow.drop_num} · {season}</div>
              </div>
              <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
              {formStores.slice(0,1).map((entry, idx) => {
                const sym = CURRENCY_SYMBOLS[entry.currency]
                return (
                  <div key={entry.store}>
                    {/* Currency picker */}
                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={lbl}>Currency</label>
                      <select value={entry.currency}
                        onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, currency: e.target.value as Currency } : p))}
                        style={{ fontSize: 12, fontWeight: 700, border: '1.5px solid #d1d5db', borderRadius: 5, padding: '4px 8px', background: '#f5f3ff', color: purpleD, cursor: 'pointer' }}>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                      </select>
                    </div>
                    <div className="form-grid">
                      <div>
                        <label style={lbl}>Units</label>
                        <input type="number" value={entry.units}
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, units: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Initial Total ({sym})</label>
                        <input type="number" value={entry.initial_total} step="0.01"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, initial_total: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Deposit ({sym})</label>
                        <input type="number" value={entry.deposit} step="0.01"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, deposit: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Duties ({sym})</label>
                        <input type="number" value={entry.duties} step="0.01"
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, duties: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Payment Date</label>
                        <input type="date" value={entry.payment_date}
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, payment_date: e.target.value } : p))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Comment</label>
                        <input value={entry.comment}
                          onChange={e => setFormStores(prev => prev.map((p,i) => i===idx ? { ...p, comment: e.target.value } : p))}
                          style={inp} />
                      </div>
                    </div>
                    {(entry.initial_total || entry.deposit || entry.duties) && (() => {
                      const init = parseFloat(entry.initial_total) || 0
                      const dep  = parseFloat(entry.deposit) || 0
                      const dut  = parseFloat(entry.duties) || 0
                      const bal  = init - dep - dut
                      return (
                        <div style={{ marginTop: 10, fontSize: 13, color: bal > 0.001 ? '#dc2626' : '#166534', fontWeight: 700 }}>
                          Balance Due: {sym}{bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button onClick={() => setModal('none')} disabled={saving}
                  style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={saveEdit} disabled={saving}
                  style={{ background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
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

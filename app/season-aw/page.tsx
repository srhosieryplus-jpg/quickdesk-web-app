'use client'
import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

interface AWRow {
  id: string
  store: string
  brand: string
  invoice_no: string
  po_no: string | null
  qty: number | null
  logged: boolean
  logged_by: string | null
  logged_at: string | null
  note: string | null
  flagged: boolean
  created_at: string
}

// ── theme ─────────────────────────────────────────────────────────────────────
const blue   = '#1e40af'
const blueD  = '#1e3a8a'
const blueL  = '#eff6ff'
const border = '#93c5fd'
const amber  = '#d97706'
const amberL = '#fffbeb'

const labelSt: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: blueD, whiteSpace: 'nowrap',
}
const inputSt: React.CSSProperties = {
  background: '#fff', border: `1px solid #d1d5db`, borderRadius: 5,
  padding: '4px 8px', fontSize: 12, color: '#111', outline: 'none',
  fontFamily: 'Inter, sans-serif',
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'found';    row: AWRow }
  | { phase: 'notfound'; invoice: string }
  | { phase: 'brand';    results: AWRow[] }
  | { phase: 'create';   invoice: string }

// columns: Date(0) VendorID(1) Brand(2) Store(3) CI(4) Invoice#(5) PO#(6) Season(7) Source(8) Qty(9)
function parsePasteData(raw: string): { brand: string; store: string; invoice_no: string; po_no: string | null; qty: number | null }[] {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  const results: { brand: string; store: string; invoice_no: string; po_no: string | null; qty: number | null }[] = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 6) continue
    const invoice_no = cols[5]?.trim()
    const brand      = cols[2]?.trim()
    const storeRaw   = cols[3]?.trim()
    const store      = storeRaw ? storeRaw.toUpperCase() : ''
    if (!invoice_no || !brand || !store) continue
    // skip header row
    if (invoice_no.toLowerCase() === 'invoice #' || brand.toLowerCase() === 'brand') continue
    const po_no = cols[6]?.trim() || null
    const qtyRaw = cols[9]?.trim().replace(/[^0-9]/g, '')
    const qty = qtyRaw ? parseInt(qtyRaw) : null
    results.push({ brand, store, invoice_no, po_no: po_no || null, qty })
  }
  return results
}

function fmtTs(ts: string | null): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch { return ts }
}

export default function SeasonAWPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  // ── staff search state ────────────────────────────────────────────────────
  const [query, setQuery]           = useState('')
  const [searching, setSearching]   = useState(false)
  const [state, setState]           = useState<SearchState>({ phase: 'idle' })
  const [brandQuery, setBrandQuery] = useState('')
  const [crNote, setCrNote]         = useState('PRIORITY — items on floor, not in system')
  const [crBrand, setCrBrand]       = useState('')
  const [crPO, setCrPO]             = useState('')
  const [crQty, setCrQty]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [logNote, setLogNote]       = useState('')
  const [logging, setLogging]       = useState(false)
  const [loggedRow, setLoggedRow]   = useState<AWRow | null>(null)  // stays visible after log
  const [toast, setToast]           = useState('')
  const [toastType, setToastType]   = useState<'ok'|'err'>('ok')
  const inputRef = useRef<HTMLInputElement>(null)

  // ── admin POs modal state ─────────────────────────────────────────────────
  const [showModal, setShowModal]   = useState(false)
  const [modalTab, setModalTab]     = useState<'view'|'paste'>('paste')

  // view tab
  const [awRows, setAwRows]         = useState<AWRow[]>([])
  const [awLoading, setAwLoading]   = useState(false)
  const [awFilter, setAwFilter]     = useState('')
  const [awStoreFilter, setAwStoreFilter] = useState('ALL')

  // paste tab
  const [pasteText, setPasteText]   = useState('')
  const [pastePreview, setPastePreview] = useState<ReturnType<typeof parsePasteData>>([])
  const [pasting, setPasting]       = useState(false)
  const [pasteResult, setPasteResult] = useState<{ok: number; skip: number} | null>(null)

  // edit modal
  const [editRow, setEditRow]       = useState<AWRow | null>(null)
  const [editStore, setEditStore]   = useState('')
  const [editBrand, setEditBrand]   = useState('')
  const [editInv, setEditInv]       = useState('')
  const [editPO, setEditPO]         = useState('')
  const [editQty, setEditQty]       = useState('')
  const [editNote, setEditNote]     = useState('')
  const [saving, setSaving]         = useState(false)

  // ctx menu
  const [ctxMenu, setCtxMenu]       = useState<{ id: string; x: number; y: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)

  // clear season
  const [clearing, setClearing]     = useState(false)

  const AW_STORES = ['HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']

  // ── session + idle redirect ───────────────────────────────────────────────
  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [router])

  // dismiss ctx menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // fetch rows when modal opens on view tab
  useEffect(() => {
    if (showModal && modalTab === 'view') fetchAW()
  }, [showModal, modalTab])

  // ── helpers ───────────────────────────────────────────────────────────────
  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3200)
  }

  async function fetchAW() {
    setAwLoading(true)
    const { data } = await supabase.from('season_aw').select('*').order('created_at', { ascending: false })
    setAwLoading(false)
    setAwRows((data || []) as AWRow[])
  }

  const filteredAW = useMemo(() => {
    const q = awFilter.toLowerCase()
    return awRows.filter(r => {
      const storeOk = awStoreFilter === 'ALL' || r.store === awStoreFilter
      if (!q) return storeOk
      return storeOk && (
        r.invoice_no.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q) ||
        (r.po_no || '').toLowerCase().includes(q) ||
        r.store.toLowerCase().includes(q)
      )
    })
  }, [awRows, awFilter, awStoreFilter])

  // ── staff search ──────────────────────────────────────────────────────────
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const inv = query.trim()
    if (!inv || !user) return
    setSearching(true)
    setLoggedRow(null)
    const { data } = await supabase
      .from('season_aw').select('*')
      .eq('store', user.store).ilike('invoice_no', inv).maybeSingle()
    setSearching(false)
    if (data) setState({ phase: 'found', row: data as AWRow })
    else setState({ phase: 'notfound', invoice: inv })
  }

  async function handleBrandSearch(e: React.FormEvent) {
    e.preventDefault()
    const b = brandQuery.trim()
    if (!b || !user) return
    setSearching(true)
    const { data } = await supabase
      .from('season_aw').select('*')
      .eq('store', user.store).ilike('brand', `%${b}%`)
      .order('created_at', { ascending: false })
    setSearching(false)
    setState({ phase: 'brand', results: (data || []) as AWRow[] })
  }

  async function logRow(row: AWRow) {
    if (!user) return
    setLogging(true)
    const loggedAt = new Date().toISOString()
    const { error } = await supabase.from('season_aw')
      .update({ logged: true, logged_by: user.userid, logged_at: loggedAt, note: logNote.trim() || row.note })
      .eq('id', row.id)
    setLogging(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    // Keep card visible, show the updated row with green PO# box
    const updatedRow: AWRow = { ...row, logged: true, logged_by: user.userid, logged_at: loggedAt, note: logNote.trim() || row.note }
    setLoggedRow(updatedRow)
    setState({ phase: 'found', row: updatedRow })
    setLogNote('')
    showToast('✅ Invoice logged!')
  }

  async function unlogRow(row: AWRow) {
    if (!user) return
    const { error } = await supabase.from('season_aw')
      .update({ logged: false, logged_by: null, logged_at: null })
      .eq('id', row.id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    const updated: AWRow = { ...row, logged: false, logged_by: null, logged_at: null }
    setLoggedRow(null)
    setState({ phase: 'found', row: updated })
    showToast('↩ Invoice un-logged')
    fetchAW()
  }

  async function submitCreateRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const inv = state.phase === 'create' ? state.invoice : query.trim()
    setSubmitting(true)
    const { error } = await supabase.from('season_aw').insert({
      store: user.store, brand: crBrand.trim() || '—', invoice_no: inv,
      po_no: crPO.trim() || null, qty: crQty ? parseInt(crQty) : null,
      logged: true, logged_by: user.userid, logged_at: new Date().toISOString(),
      note: crNote.trim(), flagged: true,
    })
    setSubmitting(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Log request submitted — admin notified')
    reset()
  }

  function reset() {
    setState({ phase: 'idle' })
    setLoggedRow(null)
    setQuery(''); setBrandQuery('')
    setCrNote('PRIORITY — items on floor, not in system')
    setCrBrand(''); setCrPO(''); setCrQty(''); setLogNote('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── admin: paste processor ────────────────────────────────────────────────
  function handlePasteChange(val: string) {
    setPasteText(val)
    setPasteResult(null)
    if (val.trim()) setPastePreview(parsePasteData(val))
    else setPastePreview([])
  }

  async function submitPaste() {
    if (!pastePreview.length) return
    setPasting(true)
    const rows = pastePreview.map(r => ({
      store: r.store, brand: r.brand, invoice_no: r.invoice_no,
      po_no: r.po_no, qty: r.qty, logged: false, flagged: false,
    }))
    let ok = 0; let skip = 0
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50)
      const { error, data } = await supabase.from('season_aw').insert(batch).select('id')
      if (error) skip += batch.length
      else ok += (data?.length || batch.length)
    }
    setPasting(false)
    setPasteResult({ ok, skip })
    if (ok > 0) { fetchAW(); showToast(`✅ Inserted ${ok} rows`) }
    if (skip > 0) showToast(`⚠️ ${skip} rows failed`, 'err')
  }

  // ── admin: edit / delete / unlog (from view table) ────────────────────────
  function openEdit(row: AWRow) {
    setEditRow(row)
    setEditStore(row.store); setEditBrand(row.brand); setEditInv(row.invoice_no)
    setEditPO(row.po_no || ''); setEditQty(row.qty?.toString() || ''); setEditNote(row.note || '')
    setCtxMenu(null)
  }

  async function saveEdit() {
    if (!editRow) return
    setSaving(true)
    const { error } = await supabase.from('season_aw').update({
      store: editStore, brand: editBrand.trim(), invoice_no: editInv.trim(),
      po_no: editPO.trim() || null, qty: editQty ? parseInt(editQty) : null, note: editNote.trim() || null,
    }).eq('id', editRow.id)
    setSaving(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Saved')
    setEditRow(null)
    fetchAW()
  }

  async function deleteRow(id: string) {
    setCtxMenu(null)
    if (!window.confirm('Delete this row?')) return
    const { error } = await supabase.from('season_aw').delete().eq('id', id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('🗑 Deleted')
    fetchAW()
  }

  async function unlogRowAdmin(row: AWRow) {
    setCtxMenu(null)
    const { error } = await supabase.from('season_aw')
      .update({ logged: false, logged_by: null, logged_at: null })
      .eq('id', row.id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('↩ Un-logged')
    fetchAW()
  }

  async function clearSeason() {
    const pw = window.prompt('Enter password to clear all season data:')
    if (pw !== 'star') { if (pw !== null) showToast('❌ Wrong password', 'err'); return }
    if (!window.confirm('Delete ALL rows for this season? This cannot be undone.')) return
    setClearing(true)
    const { error } = await supabase.from('season_aw').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setClearing(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('🗑 Season cleared')
    setAwRows([])
  }

  // ── row color ─────────────────────────────────────────────────────────────
  function rowBg(r: AWRow, i: number) {
    if (r.flagged) return '#fffbeb'
    if (r.logged) return '#f0fdf4'
    return i % 2 === 0 ? '#fff' : '#f8faff'
  }

  function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', minWidth: 80, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{value ?? '—'}</span>
      </div>
    )
  }

  const loggedCount  = awRows.filter(r => r.logged && !r.flagged).length
  const flaggedCount = awRows.filter(r => r.flagged).length
  const isAdmin      = user?.store === 'ALL'

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: blueL, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; }
        .aw-btn { border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; transition: opacity 0.15s; }
        .aw-btn:disabled { opacity: 0.6; cursor: default; }
        .aw-btn-primary { background: ${blue}; color: #fff; }
        .aw-btn-outline { background: #fff; color: ${blueD}; border: 1.5px solid ${border} !important; }
        .aw-btn-amber   { background: ${amber}; color: #fff; }
        .aw-btn-gray    { background: #f3f4f6; color: #374151; }
        .aw-btn-red     { background: #dc2626; color: #fff; }
        .aw-btn-green   { background: #16a34a; color: #fff; }
        .result-card { background: #fff; border: 1.5px solid ${border}; border-radius: 10px; padding: 16px; margin: 0; box-shadow: 0 2px 12px rgba(30,64,175,0.07); }
        .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
        .brand-row:hover { background: ${blueL}; border-color: ${border}; }
        .ss-table { border-collapse: collapse; width: 100%; font-size: 11px; }
        .ss-table th { background: #e0e7ff; color: #1e3a8a; font-size: 10px; font-weight: 800; padding: 5px 8px; text-align: left; border: 1px solid #c7d2fe; white-space: nowrap; position: sticky; top: 0; z-index: 1; }
        .ss-table td { padding: 3px 8px; border: 1px solid #e0e7ff; height: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
        .ss-table tr:hover td { filter: brightness(0.97); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 16px 12px; overflow-y: auto; }
        .modal-box { background: #fff; border-radius: 14px; box-shadow: 0 8px 48px rgba(0,0,0,0.22); width: 100%; max-width: 1000px; display: flex; flex-direction: column; min-height: 80vh; max-height: 94vh; }
        .modal-head { padding: 14px 18px; border-bottom: 1px solid #e0e7ff; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .modal-tabs { display: flex; gap: 2px; padding: 8px 16px 0; border-bottom: 1px solid #e0e7ff; flex-shrink: 0; }
        .modal-tab { padding: 7px 18px; border: none; background: none; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 8px 8px 0 0; color: #64748b; }
        .modal-tab.active { background: ${blue}; color: #fff; }
        .modal-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
        .qs-header { padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; border-bottom: 2px solid ${blueD}; background: ${blue}; }
        .qs-logo { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; }
        @media (max-width: 600px) {
          .qs-logo { order: 3; width: 100%; justify-content: center; }
        }
        .paste-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; height: 100%; min-height: 0; }
        @media (max-width: 700px) { .paste-layout { grid-template-columns: 1fr; } }
        .paste-area { width: 100%; height: 100%; min-height: 200px; border: 1.5px solid #d1d5db; border-radius: 6px; padding: 8px; font-size: 11px; font-family: monospace; resize: none; outline: none; }
        .paste-area:focus { border-color: ${border}; }
        .po-badge { display: inline-block; background: #dcfce7; color: #15803d; border: 1.5px solid #86efac; border-radius: 8px; padding: '4px 14px'; font-size: 13px; font-weight: 800; letter-spacing: 0.03em; }
      `}</style>

      {/* ── HEADER ── */}
      <div className="qs-header">
        {/* Left: user info + home */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#bfdbfe', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '4px 10px' }}>
            ← Home
          </button>
          <span style={{ fontSize: 12, color: '#93c5fd' }}>
            <span style={{ fontWeight: 700, color: '#bfdbfe' }}>{user?.userid}</span>
            {user?.store && user.store !== 'ALL' && (
              <span style={{ marginLeft: 6, background: blueD, color: '#bfdbfe', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px' }}>{user.store}</span>
            )}
          </span>
        </div>

        {/* Center: title with snowflake */}
        <div className="qs-logo">
          {/* Snowflake SVG */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#bfdbfe" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="2" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
            <line x1="12" y1="2" x2="10" y2="5"/>
            <line x1="12" y1="2" x2="14" y2="5"/>
            <line x1="12" y1="22" x2="10" y2="19"/>
            <line x1="12" y1="22" x2="14" y2="19"/>
            <line x1="2" y1="12" x2="5" y2="10"/>
            <line x1="2" y1="12" x2="5" y2="14"/>
            <line x1="22" y1="12" x2="19" y2="10"/>
            <line x1="22" y1="12" x2="19" y2="14"/>
          </svg>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '0.08em' }}>AW SEASON</span>
          <span style={{ color: '#60a5fa', fontSize: 16, fontWeight: 300, margin: '0 4px' }}>—</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#bfdbfe' }}>Invoice Log</span>
        </div>

        {/* Right: POs AW button (admin only) */}
        <div style={{ flexShrink: 0, minWidth: 80, display: 'flex', justifyContent: 'flex-end' }}>
          {isAdmin && (
            <button onClick={() => { setShowModal(true); setModalTab('paste') }}
              style={{ background: amber, border: 'none', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', borderRadius: 7, padding: '6px 14px', letterSpacing: '0.04em', boxShadow: '0 2px 8px rgba(217,119,6,0.4)' }}>
              🗂 POs AW
            </button>
          )}
        </div>
      </div>

      {/* ── SEARCH BAR ── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '8px 16px' }}>
        <div style={{ width: '100%', maxWidth: 680, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {/* Invoice # search */}
          <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
            <label style={labelSt}>Invoice #:</label>
            <input
              ref={inputRef} autoFocus value={query}
              onChange={e => { setQuery(e.target.value); if (state.phase !== 'idle' && state.phase !== 'found') setState({ phase: 'idle' }) }}
              placeholder="Enter invoice number…"
              style={{ ...inputSt, flex: 1 }}
            />
            <button type="submit" disabled={!query.trim() || searching} className="aw-btn aw-btn-primary">
              {searching ? '…' : '🔍'}
            </button>
          </form>

          {/* Brand search */}
          <form onSubmit={handleBrandSearch} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
            <label style={labelSt}>Brand:</label>
            <input value={brandQuery} onChange={e => setBrandQuery(e.target.value)}
              placeholder="Search brand…"
              style={{ ...inputSt, flex: 1 }} />
            <button type="submit" disabled={!brandQuery.trim() || searching} className="aw-btn aw-btn-outline">
              {searching ? '…' : '🔍'}
            </button>
          </form>

          {(state.phase !== 'idle') && (
            <button type="button" onClick={reset} className="aw-btn aw-btn-gray">✕ Clear</button>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', gap: 16 }}>

        {state.phase === 'idle' && (
          <div style={{ color: '#93c5fd', fontSize: 13, marginTop: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>❄</div>
            Search by invoice # or brand to log a delivery
          </div>
        )}

        {/* ── FOUND ── */}
        {state.phase === 'found' && (
          <div className="result-card" style={{ width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: blueD }}>Invoice Found</span>
              {state.row.logged && (
                <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 10px' }}>
                  ✓ Logged by {state.row.logged_by}
                </span>
              )}
            </div>

            {/* Green PO# badge — appears after logging */}
            {loggedRow && loggedRow.id === state.row.id && (
              <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: 8, padding: '8px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 2 }}>Logged successfully</div>
                  {loggedRow.po_no && (
                    <div style={{ fontSize: 14, fontWeight: 900, color: '#166534', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                      PO# {loggedRow.po_no}
                    </div>
                  )}
                </div>
              </div>
            )}

            <InfoRow label="Invoice #" value={state.row.invoice_no} />
            <InfoRow label="Brand"     value={state.row.brand} />
            <InfoRow label="PO #"      value={state.row.po_no} />
            <InfoRow label="Qty"       value={state.row.qty} />
            {state.row.note && <InfoRow label="Note" value={state.row.note} />}
            {state.row.logged && state.row.logged_at && (
              <InfoRow label="Logged at" value={fmtTs(state.row.logged_at)} />
            )}

            {!state.row.logged && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={labelSt}>Note:</label>
                  <input value={logNote} onChange={e => setLogNote(e.target.value)}
                    placeholder="optional…" style={{ ...inputSt, flex: 1 }} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={reset} className="aw-btn aw-btn-gray">Cancel</button>
                  <button onClick={() => logRow(state.row)} disabled={logging} className="aw-btn aw-btn-primary">
                    {logging ? '…' : '✓ Log Invoice'}
                  </button>
                </div>
              </div>
            )}

            {state.row.logged && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {isAdmin && (
                  <button onClick={() => unlogRow(state.row)} className="aw-btn aw-btn-amber" style={{ fontSize: 11 }}>
                    ↩ Un-log
                  </button>
                )}
                <button onClick={reset} className="aw-btn aw-btn-gray">← Back</button>
              </div>
            )}
          </div>
        )}

        {state.phase === 'notfound' && (
          <div className="result-card" style={{ width: '100%', maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#dc2626', marginBottom: 6 }}>
              Invoice not found: <span style={{ fontFamily: 'monospace' }}>{state.invoice}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              This invoice isn't in the system for store <strong>{user?.store}</strong>. What would you like to do?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => { setState({ phase: 'idle' }); setQuery(''); setTimeout(() => inputRef.current?.focus(), 50) }}
                className="aw-btn aw-btn-outline" style={{ textAlign: 'left', padding: '10px 14px' }}>
                🔄 Try another invoice #
              </button>
              <button onClick={() => { setBrandQuery(''); setState({ phase: 'brand', results: [] }) }}
                className="aw-btn aw-btn-outline" style={{ textAlign: 'left', padding: '10px 14px' }}>
                🏷 Search by brand instead
              </button>
              <button onClick={() => setState({ phase: 'create', invoice: state.invoice })}
                className="aw-btn aw-btn-amber" style={{ textAlign: 'left', padding: '10px 14px' }}>
                ⚑ Create log request — items on floor, not in system
              </button>
            </div>
          </div>
        )}

        {state.phase === 'brand' && (
          <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.results.length === 0 && brandQuery && !searching && (
              <div style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 8, padding: 16, color: '#6b7280', fontSize: 13 }}>
                No invoices found for "{brandQuery}" at store {user?.store}.
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button onClick={() => setState({ phase: 'create', invoice: query })} className="aw-btn aw-btn-amber">⚑ Create log request</button>
                  <button onClick={reset} className="aw-btn aw-btn-gray">← Back</button>
                </div>
              </div>
            )}
            {state.results.length > 0 && (
              <div className="result-card">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 10 }}>
                  {state.results.length} invoice{state.results.length !== 1 ? 's' : ''} found for "{brandQuery}"
                </div>
                {state.results.map(row => (
                  <div key={row.id} className="brand-row" onClick={() => { setState({ phase: 'found', row }); setQuery(row.invoice_no) }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: blueD }}>{row.brand}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Invoice: {row.invoice_no}{row.po_no ? ` · PO: ${row.po_no}` : ''}{row.qty ? ` · Qty: ${row.qty}` : ''}</div>
                      {row.logged && <div style={{ fontSize: 10, color: '#15803d', fontWeight: 700 }}>✓ Already logged by {row.logged_by} · {fmtTs(row.logged_at)}</div>}
                    </div>
                    <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700 }}>Select →</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={reset} className="aw-btn aw-btn-gray" style={{ alignSelf: 'flex-start' }}>← Back</button>
          </div>
        )}

        {state.phase === 'create' && (
          <div className="result-card" style={{ width: '100%', maxWidth: 520, borderColor: amber, background: amberL }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: amber, marginBottom: 4 }}>⚑ Create Log Request</div>
            <div style={{ fontSize: 12, color: '#92400e', marginBottom: 14 }}>
              Invoice <strong>{state.invoice}</strong> wasn't found. This will be flagged for admin review.
            </div>
            <form onSubmit={submitCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>Brand:</label>
                <input value={crBrand} onChange={e => setCrBrand(e.target.value)}
                  placeholder="Brand name if known…" style={{ ...inputSt, flex: 1 }} autoFocus />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>PO #:</label>
                <input value={crPO} onChange={e => setCrPO(e.target.value)}
                  placeholder="optional…" style={{ ...inputSt, flex: 1 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>Qty:</label>
                <input value={crQty} onChange={e => setCrQty(e.target.value)}
                  placeholder="optional…" type="number" min="0" style={{ ...inputSt, width: 80 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>Note:</label>
                <input value={crNote} onChange={e => setCrNote(e.target.value)}
                  style={{ ...inputSt, flex: 1, fontWeight: 700, color: '#92400e' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={reset} className="aw-btn aw-btn-gray">Cancel</button>
                <button type="submit" disabled={submitting} className="aw-btn aw-btn-amber">
                  {submitting ? '…' : '⚑ Submit Request'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#1e3a8a', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          POs AW MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal-box">
            {/* Modal header */}
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, color: amber }}>🗂</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: blueD, letterSpacing: '0.04em' }}>POs Created — AW</span>
              </div>
              <button onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>
                ✕ Close
              </button>
            </div>

            {/* Tabs: Paste Processor | View All */}
            <div className="modal-tabs">
              {(['paste','view'] as const).map(t => (
                <button key={t} className={`modal-tab${modalTab === t ? ' active' : ''}`}
                  onClick={() => { setModalTab(t); if (t === 'view') fetchAW() }}>
                  {t === 'paste' ? '⚡ Paste Processor' : '📋 View All'}
                </button>
              ))}
            </div>

            {/* ── PASTE PROCESSOR TAB ── */}
            {modalTab === 'paste' && (
              <div className="modal-body" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10, flexShrink: 0 }}>
                  Copy rows from your Excel PO log and paste on the left. Preview appears on the right.
                  Columns: <strong>Date · Vendor ID · Brand · Store · C.I. · Invoice # · PO # · Season · Source · Qty</strong>
                </p>
                <div className="paste-layout" style={{ flex: 1, minHeight: 0 }}>
                  {/* Left: narrow paste panel */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ ...labelSt, fontSize: 10 }}>PASTE EXCEL DATA HERE</label>
                    <textarea
                      className="paste-area"
                      value={pasteText}
                      onChange={e => handlePasteChange(e.target.value)}
                      placeholder="Paste tab-separated rows here (copy directly from Excel)…"
                      style={{ flex: 1, minHeight: 300 }}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={submitPaste} disabled={pasting || pastePreview.length === 0}
                        className="aw-btn aw-btn-primary">
                        {pasting ? '…inserting…' : `⚡ Insert ${pastePreview.length} rows`}
                      </button>
                      <button onClick={() => { setPasteText(''); setPastePreview([]); setPasteResult(null) }}
                        className="aw-btn aw-btn-gray">Clear</button>
                      {pasteResult && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: pasteResult.skip > 0 ? '#dc2626' : '#15803d' }}>
                          ✓ {pasteResult.ok} inserted{pasteResult.skip > 0 ? ` · ✕ ${pasteResult.skip} failed` : ''}
                        </span>
                      )}
                    </div>
                    {pasteText && pastePreview.length === 0 && (
                      <div style={{ fontSize: 12, color: '#dc2626' }}>
                        No rows parsed. Make sure you copy directly from Excel with all columns present.
                      </div>
                    )}
                  </div>

                  {/* Right: wide preview */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                    <label style={{ ...labelSt, fontSize: 10 }}>
                      PREVIEW — {pastePreview.length} ROW{pastePreview.length !== 1 ? 'S' : ''} PARSED
                    </label>
                    {pastePreview.length > 0 ? (
                      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #e0e7ff', borderRadius: 8 }}>
                        <table className="ss-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Store</th>
                              <th>Brand</th>
                              <th>Invoice #</th>
                              <th>PO #</th>
                              <th>Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pastePreview.map((r, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8faff' }}>
                                <td style={{ color: '#94a3b8', width: 32 }}>{i + 1}</td>
                                <td style={{ fontWeight: 700, color: blueD }}>{r.store}</td>
                                <td>{r.brand}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.invoice_no}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.po_no || '—'}</td>
                                <td style={{ textAlign: 'right' }}>{r.qty ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ flex: 1, border: '1.5px dashed #d1d5db', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                        Paste data on the left to see preview
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── VIEW ALL TAB ── */}
            {modalTab === 'view' && (
              <div className="modal-body">
                {/* toolbar */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={awFilter} onChange={e => setAwFilter(e.target.value)}
                    placeholder="Search invoice, brand, PO…"
                    style={{ ...inputSt, flex: 1, minWidth: 160 }} />
                  <select value={awStoreFilter} onChange={e => setAwStoreFilter(e.target.value)}
                    style={{ ...inputSt, minWidth: 80 }}>
                    <option value="ALL">All Stores</option>
                    {AW_STORES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={fetchAW} className="aw-btn aw-btn-outline" style={{ flexShrink: 0 }}>↺ Refresh</button>
                  <button onClick={clearSeason} disabled={clearing} className="aw-btn aw-btn-red" style={{ flexShrink: 0 }}>
                    {clearing ? '…' : '🗑 Clear Season'}
                  </button>
                </div>

                {/* legend */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 10, fontWeight: 700 }}>
                  <span style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 7px', color: '#92400e' }}>⚑ Flagged</span>
                  <span style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, padding: '1px 7px', color: '#15803d' }}>✓ Logged</span>
                  <span style={{ background: '#f8faff', border: '1px solid #c7d2fe', borderRadius: 4, padding: '1px 7px', color: blueD }}>Pending</span>
                </div>

                {awLoading ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#93c5fd' }}>Loading…</div>
                ) : (
                  <div style={{ overflow: 'auto', maxHeight: 480, border: '1px solid #e0e7ff', borderRadius: 8 }}>
                    <table className="ss-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Store</th>
                          <th>Brand</th>
                          <th>Invoice #</th>
                          <th>PO #</th>
                          <th>Qty</th>
                          <th>Status</th>
                          <th>Logged By</th>
                          <th>Logged At</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAW.map((r, i) => (
                          <tr key={r.id} style={{ background: rowBg(r, i) }}
                            onContextMenu={e => { e.preventDefault(); setCtxMenu({ id: r.id, x: e.clientX, y: e.clientY }) }}>
                            <td style={{ color: '#94a3b8', width: 32 }}>{i + 1}</td>
                            <td style={{ fontWeight: 700, color: blueD, width: 52 }}>{r.store}</td>
                            <td style={{ fontWeight: 600 }}>{r.brand}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.invoice_no}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.po_no || '—'}</td>
                            <td style={{ textAlign: 'right', width: 48 }}>{r.qty ?? '—'}</td>
                            <td style={{ width: 72 }}>
                              {r.flagged
                                ? <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px' }}>⚑ Flag</span>
                                : r.logged
                                  ? <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px' }}>✓ Done</span>
                                  : <span style={{ background: '#e0e7ff', color: blueD, fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px' }}>Pending</span>
                              }
                            </td>
                            <td style={{ color: '#64748b', fontSize: 10 }}>{r.logged_by || '—'}</td>
                            <td style={{ color: '#64748b', fontSize: 10, whiteSpace: 'nowrap' }}>{r.logged_at ? fmtTs(r.logged_at) : '—'}</td>
                            <td style={{ color: '#64748b', fontSize: 10, maxWidth: 140 }}>{r.note || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredAW.length === 0 && (
                      <div style={{ padding: 20, textAlign: 'center', color: '#93c5fd', fontSize: 12 }}>No rows found</div>
                    )}
                  </div>
                )}

                {/* footer stats */}
                <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: '#64748b' }}>
                  <span>{filteredAW.length} of {awRows.length} rows</span>
                  <span style={{ color: '#15803d', fontWeight: 700 }}>✓ {loggedCount} logged</span>
                  <span style={{ color: '#92400e', fontWeight: 700 }}>⚑ {flaggedCount} flagged</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU ── */}
      {ctxMenu && (
        <div ref={ctxRef} style={{
          position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, background: '#fff',
          border: '1px solid #e0e7ff', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          zIndex: 9000, minWidth: 150, padding: '4px 0', overflow: 'hidden',
        }}>
          <button onClick={() => { const r = awRows.find(x => x.id === ctxMenu.id); if (r) openEdit(r) }}
            style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: blueD, fontWeight: 600, cursor: 'pointer' }}>
            ✏️ Edit
          </button>
          {(() => { const r = awRows.find(x => x.id === ctxMenu.id); return r?.logged ? (
            <button onClick={() => unlogRowAdmin(r)}
              style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: amber, fontWeight: 600, cursor: 'pointer' }}>
              ↩ Un-log
            </button>
          ) : null })()}
          <button onClick={() => deleteRow(ctxMenu.id)}
            style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>
            🗑 Delete
          </button>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editRow && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditRow(null) }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, color: blueD, marginBottom: 14 }}>Edit Row</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {([
                ['Store', editStore, setEditStore, false, true] as const,
                ['Brand', editBrand, setEditBrand, false, false] as const,
                ['Invoice #', editInv, setEditInv, false, false] as const,
                ['PO #', editPO, setEditPO, false, false] as const,
                ['Qty', editQty, setEditQty, true, false] as const,
                ['Note', editNote, setEditNote, false, false] as const,
              ]).map(([label, val, setter, isNum, isSelect]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ ...labelSt, minWidth: 72 }}>{label}:</label>
                  {isSelect ? (
                    <select value={val} onChange={e => setter(e.target.value)} style={{ ...inputSt, flex: 1 }}>
                      {AW_STORES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input value={val} onChange={e => setter(e.target.value)}
                      type={isNum ? 'number' : 'text'} min={isNum ? '0' : undefined}
                      style={{ ...inputSt, flex: 1 }} />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setEditRow(null)} className="aw-btn aw-btn-gray">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="aw-btn aw-btn-primary">
                {saving ? '…' : '✓ Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

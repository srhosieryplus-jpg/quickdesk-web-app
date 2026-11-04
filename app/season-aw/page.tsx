'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'
import { BRAND_LIST } from '@/lib/brands'

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
  | { phase: 'notfound'; term: string; byBrand: boolean }
  | { phase: 'brand';    results: AWRow[]; term: string }
  | { phase: 'create';   invoice: string }

// columns: Date(0) VendorID(1) Brand(2) Store(3) CI(4) Invoice#(5) PO#(6) Season(7) Source(8) Qty(9)
function parsePasteData(raw: string): { brand: string; store: string; invoice_no: string; po_no: string | null; qty: number | null }[] {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  const results: { brand: string; store: string; invoice_no: string; po_no: string | null; qty: number | null }[] = []

  // Detect header row to determine column layout
  const firstLine = lines[0]?.toLowerCase() || ''
  const isNewFormat = firstLine.includes('storeid') || (firstLine.includes('store') && firstLine.includes('brand') && firstLine.includes('invoice'))

  // New format: Storeid | Brand | Invoice # | Qty  (4 cols, header row present)
  if (isNewFormat) {
    for (const line of lines) {
      const cols = line.split('\t')
      const store      = cols[0]?.trim().toUpperCase()
      const brand      = cols[1]?.trim()
      const invoice_no = cols[2]?.trim()
      const qtyRaw     = cols[3]?.trim().replace(/[^0-9]/g, '')
      const qty        = qtyRaw ? parseInt(qtyRaw) : null
      const po_no      = cols[4]?.trim() || null
      if (!store || !brand || !invoice_no) continue
      // skip header row
      if (store.toLowerCase() === 'storeid' || invoice_no.toLowerCase() === 'invoice #') continue
      results.push({ brand, store, invoice_no, po_no, qty })
    }
    return results
  }

  // Legacy format: col[2]=brand, col[3]=store, col[5]=invoice_no, col[6]=po_no, col[9]=qty
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 6) continue
    const invoice_no = cols[5]?.trim()
    const brand      = cols[2]?.trim()
    const store      = cols[3]?.trim().toUpperCase()
    if (!invoice_no || !brand || !store) continue
    if (invoice_no.toLowerCase() === 'invoice #' || brand.toLowerCase() === 'brand') continue
    const po_no  = cols[6]?.trim() || null
    const qtyRaw = cols[9]?.trim().replace(/[^0-9]/g, '')
    const qty    = qtyRaw ? parseInt(qtyRaw) : null
    results.push({ brand, store, invoice_no, po_no: po_no || null, qty })
  }
  return results
}

function fmtTs(ts: string | null): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch { return ts }
}

function fmtDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${String(d.getFullYear()).slice(2)} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

export default function SeasonAWPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  // ── search bar ────────────────────────────────────────────────────────────
  const [invoiceQ, setInvoiceQ]     = useState('')
  const [brandQ, setBrandQ]         = useState('')
  const [searching, setSearching]   = useState(false)
  const [state, setState]           = useState<SearchState>({ phase: 'idle' })
  const [brandSuggestions, setBrandSuggestions] = useState<string[]>([])
  const [showSugg, setShowSugg]     = useState(false)
  const invoiceRef = useRef<HTMLInputElement>(null)
  const brandRef   = useRef<HTMLInputElement>(null)
  const suggRef    = useRef<HTMLDivElement>(null)
  const [pullY, setPullY] = useState(0)
  const [pulling, setPulling] = useState(false)
  const touchStartY = useRef(0)
  const tableScrollRef = useRef<HTMLDivElement>(null)

  // log form (appears on found card)
  const [logNote, setLogNote]       = useState('')
  const [logging, setLogging]       = useState(false)
  const [loggedRow, setLoggedRow]   = useState<AWRow | null>(null)

  // create request form
  const [crNote, setCrNote]         = useState('PRIORITY — items on floor, not in system')
  const [crBrand, setCrBrand]       = useState('')
  const [crPO, setCrPO]             = useState('')
  const [crQty, setCrQty]           = useState('')
  const [submitting, setSubmitting] = useState(false)

  // toast
  const [toast, setToast]           = useState('')
  const [toastType, setToastType]   = useState<'ok'|'err'>('ok')

  // ── store log table (ic-log style) ────────────────────────────────────────
  const [storeRows, setStoreRows]   = useState<AWRow[]>([])
  const [tableLoading, setTableLoading] = useState(false)
  const [tableFilter, setTableFilter]   = useState('')

  // ── admin POs modal state ─────────────────────────────────────────────────
  const [showModal, setShowModal]   = useState(false)
  const [modalTab, setModalTab]     = useState<'view'|'paste'>('paste')

  // admin view tab
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
    function onVis() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [router])

  // dismiss ctx menu and suggestions on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
      if (suggRef.current && !suggRef.current.contains(e.target as Node) &&
          brandRef.current && !brandRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // ── fetch store log table ─────────────────────────────────────────────────
  const fetchStoreRows = useCallback(async (u?: User) => {
    const usr = u || user
    if (!usr) return
    setTableLoading(true)
    let q = supabase.from('season_aw').select('*').order('created_at', { ascending: false })
    if (usr.store !== 'ALL') q = q.eq('store', usr.store)
    const { data } = await q
    setTableLoading(false)
    setStoreRows((data || []) as AWRow[])
  }, [user])

  useEffect(() => {
    if (user) fetchStoreRows(user)
  }, [user])

  // fetch admin view rows
  async function fetchAW() {
    setAwLoading(true)
    const { data } = await supabase.from('season_aw').select('*').order('created_at', { ascending: false })
    setAwLoading(false)
    setAwRows((data || []) as AWRow[])
  }

  useEffect(() => {
    if (showModal && modalTab === 'view') fetchAW()
  }, [showModal, modalTab])

  // ── helpers ───────────────────────────────────────────────────────────────
  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3200)
  }

  // brand autocomplete
  function onBrandInput(val: string) {
    setBrandQ(val)
    if (val.trim().length >= 1) {
      const q = val.toLowerCase()
      const matches = BRAND_LIST.filter(b => b.toLowerCase().startsWith(q)).slice(0, 8)
      const extra   = BRAND_LIST.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q)).slice(0, 4)
      setBrandSuggestions([...matches, ...extra])
      setShowSugg(true)
    } else {
      setBrandSuggestions([])
      setShowSugg(false)
    }
  }

  // ── search (single button) ────────────────────────────────────────────────
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setShowSugg(false)
    setLoggedRow(null)

    const inv = invoiceQ.trim()
    const br  = brandQ.trim()

    if (!inv && !br) return

    setSearching(true)

    if (inv) {
      // Invoice # search — exact match for this store
      let q = supabase.from('season_aw').select('*').ilike('invoice_no', inv)
      if (user.store !== 'ALL') q = q.eq('store', user.store)
      const { data } = await q.maybeSingle()
      setSearching(false)
      if (data) setState({ phase: 'found', row: data as AWRow })
      else setState({ phase: 'notfound', term: inv, byBrand: false })
    } else {
      // Brand search — first try in-memory from already-loaded rows, fall back to DB
      const inMemory = storeRows.filter(r => r.brand?.toLowerCase().includes(br.toLowerCase()))
      if (inMemory.length > 0) {
        setSearching(false)
        setState({ phase: 'brand', results: inMemory, term: br })
      } else {
        let q = supabase.from('season_aw').select('*').ilike('brand', `%${br}%`)
        if (user.store !== 'ALL') q = q.eq('store', user.store)
        const { data } = await q.order('created_at', { ascending: false })
        setSearching(false)
        const results = (data || []) as AWRow[]
        if (results.length === 0) setState({ phase: 'notfound', term: br, byBrand: true })
        else setState({ phase: 'brand', results, term: br })
      }
    }
  }

  function reset() {
    setState({ phase: 'idle' })
    setLoggedRow(null)
    setInvoiceQ(''); setBrandQ('')
    setCrNote('PRIORITY — items on floor, not in system')
    setCrBrand(''); setCrPO(''); setCrQty(''); setLogNote('')
    setTimeout(() => invoiceRef.current?.focus(), 50)
    fetchStoreRows()
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
    const updated: AWRow = { ...row, logged: true, logged_by: user.userid, logged_at: loggedAt, note: logNote.trim() || row.note }
    setLoggedRow(updated)
    setState({ phase: 'found', row: updated })
    setLogNote('')
    showToast('✅ Invoice logged!')
    fetchStoreRows()
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
    fetchStoreRows()
  }

  async function submitCreateRequest(e?: React.FormEvent, overrideBrand?: string, overrideInv?: string) {
    e?.preventDefault()
    if (!user) return
    const inv   = overrideInv   || (state.phase === 'create' ? state.invoice : invoiceQ.trim())
    const brand = overrideBrand || crBrand.trim() || brandQ.trim() || '—'
    setSubmitting(true)
    const { error } = await supabase.from('season_aw').insert({
      store: user.store, brand, invoice_no: inv,
      po_no: crPO.trim() || null, qty: crQty ? parseInt(crQty) : null,
      logged: true, logged_by: user.userid, logged_at: new Date().toISOString(),
      note: crNote.trim(), flagged: true,
    })
    setSubmitting(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Log request submitted — admin notified')
    reset()
  }

  async function quickCreateRequest(invoice: string, brand: string) {
    if (!user) return
    setSubmitting(true)
    const { error } = await supabase.from('season_aw').insert({
      store: user.store, brand: brand || '—', invoice_no: invoice,
      po_no: null, qty: null,
      logged: true, logged_by: user.userid, logged_at: new Date().toISOString(),
      note: 'PRIORITY — items on floor, not in system', flagged: true,
    })
    setSubmitting(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Log request submitted — admin notified')
    reset()
  }

  // ── admin helpers ─────────────────────────────────────────────────────────
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
    fetchAW(); fetchStoreRows()
  }

  async function deleteRow(id: string) {
    setCtxMenu(null)
    if (!window.confirm('Delete this row?')) return
    const { error } = await supabase.from('season_aw').delete().eq('id', id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('🗑 Deleted')
    fetchAW(); fetchStoreRows()
  }

  async function unlogRowAdmin(row: AWRow) {
    setCtxMenu(null)
    const { error } = await supabase.from('season_aw')
      .update({ logged: false, logged_by: null, logged_at: null })
      .eq('id', row.id)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('↩ Un-logged')
    fetchAW(); fetchStoreRows()
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
    setAwRows([]); setStoreRows([])
  }

  // ── filtered views ────────────────────────────────────────────────────────
  const filteredStore = useMemo(() => {
    const q = tableFilter.toLowerCase()
    const rows = q
      ? storeRows.filter(r =>
          r.invoice_no.toLowerCase().includes(q) ||
          r.brand.toLowerCase().includes(q) ||
          (r.po_no || '').toLowerCase().includes(q) ||
          r.store.toLowerCase().includes(q) ||
          (r.logged_by || '').toLowerCase().includes(q)
        )
      : storeRows
    return [...rows].sort((a, b) => a.brand.localeCompare(b.brand))
  }, [storeRows, tableFilter])

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

  function rowBg(r: AWRow, i: number) {
    if (r.flagged) return '#fffbeb'
    if (r.logged)  return i % 2 === 0 ? '#14532d' : '#166534'
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

  const isAdmin      = user?.store === 'ALL'
  const loggedCount  = storeRows.filter(r => r.logged && !r.flagged).length
  const flaggedCount = storeRows.filter(r => r.flagged).length
  const adminLoggedCount  = awRows.filter(r => r.logged && !r.flagged).length
  const adminFlaggedCount = awRows.filter(r => r.flagged).length

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
        .result-card { background: #fff; border: 1.5px solid ${border}; border-radius: 10px; padding: 16px; margin: 0; box-shadow: 0 2px 12px rgba(30,64,175,0.07); }
        .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
        .brand-row:hover { background: ${blueL}; border-color: ${border}; }
        .aw-table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .aw-table th { background: #dbeafe; color: #1e3a8a; font-size: 11px; font-weight: 700; padding: 7px 10px; text-align: left; border-bottom: 2px solid #93c5fd; white-space: nowrap; position: sticky; top: 0; z-index: 1; }
        .aw-table td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; height: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; vertical-align: middle; }
        .aw-table tr:hover td { filter: brightness(0.97); }
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
        @media (max-width: 600px) { .qs-logo { order: 3; width: 100%; justify-content: center; } }
        .paste-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; }
        @media (max-width: 700px) { .paste-layout { grid-template-columns: 1fr; } }
        .paste-area { width: 100%; min-height: 120px; max-height: 180px; border: 1.5px solid #d1d5db; border-radius: 6px; padding: 8px; font-size: 11px; font-family: monospace; resize: vertical; outline: none; }
        .paste-area:focus { border-color: ${border}; }
        .sugg-box { position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1.5px solid ${border}; border-radius: 0 0 8px 8px; box-shadow: 0 4px 16px rgba(30,64,175,0.12); z-index: 200; max-height: 220px; overflow-y: auto; }
        .sugg-item { padding: 7px 12px; font-size: 12px; cursor: pointer; color: #1e293b; }
        .sugg-item:hover { background: ${blueL}; color: ${blueD}; font-weight: 600; }
        .aw-col-hide { }
        .aw-refresh-btn { display: inline-block; }
        .aw-table-wrap { display: flex; }
        .aw-cards { display: none; }
        @media (max-width: 600px) {
          .aw-col-hide { display: none; }
          .aw-table td { height: 42px; padding: 4px 8px; font-size: 12px; }
          .aw-table th { font-size: 11px; padding: 6px 8px; }
          .aw-refresh-btn { display: none !important; }
          .aw-table-wrap { display: none; }
          .aw-cards { display: block; padding: 8px 12px; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <div className="qs-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#bfdbfe', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '4px 10px' }}>
            ← Home
          </button>
          <span style={{ fontSize: 12, color: '#93c5fd' }}>
            <span style={{ fontWeight: 700, color: '#bfdbfe' }}>{displayUser(user?.userid)}</span>
            {user?.store && user.store !== 'ALL' && (
              <span style={{ marginLeft: 6, background: blueD, color: '#bfdbfe', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px' }}>{user.store}</span>
            )}
          </span>
        </div>

        {/* Snowflake + title */}
        <div className="qs-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#bfdbfe" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="2" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
            <line x1="12" y1="2" x2="10" y2="5"/><line x1="12" y1="2" x2="14" y2="5"/>
            <line x1="12" y1="22" x2="10" y2="19"/><line x1="12" y1="22" x2="14" y2="19"/>
            <line x1="2" y1="12" x2="5" y2="10"/><line x1="2" y1="12" x2="5" y2="14"/>
            <line x1="22" y1="12" x2="19" y2="10"/><line x1="22" y1="12" x2="19" y2="14"/>
          </svg>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '0.08em' }}>AW SEASON</span>
          <span style={{ color: '#60a5fa', fontSize: 16, fontWeight: 300, margin: '0 4px' }}>—</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#bfdbfe' }}>Invoice Log</span>
        </div>

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
        <form onSubmit={handleSearch} style={{ width: '100%', maxWidth: 700, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 0, border: `1.5px solid ${border}`, borderRadius: 8, overflow: 'visible', background: '#fff' }}>
          {/* Invoice # */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', flex: 1, borderRight: `1px solid #e0e7ff` }}>
            <label style={{ ...labelSt, fontSize: 10, color: '#94a3b8' }}>INV#</label>
            <input
              ref={invoiceRef} autoFocus value={invoiceQ}
              onChange={e => { setInvoiceQ(e.target.value); if (e.target.value) setBrandQ('') }}
              placeholder="Invoice number…"
              style={{ border: 'none', outline: 'none', fontSize: 13, color: '#111', background: 'transparent', flex: 1, padding: '8px 0', fontFamily: 'Inter, sans-serif' }}
              onBlur={() => { if (window.visualViewport) { (document.documentElement.style as any).zoom = '1' } }}
            />
          </div>

          {/* OR divider */}
          <div style={{ padding: '0 10px', color: '#94a3b8', fontSize: 11, fontWeight: 700, flexShrink: 0, userSelect: 'none' }}>or</div>

          {/* Brand with autocomplete */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', flex: 1.4, borderLeft: `1px solid #e0e7ff`, position: 'relative' }}>
            <label style={{ ...labelSt, fontSize: 10, color: '#94a3b8' }}>BRAND</label>
            <input
              ref={brandRef} value={brandQ}
              onChange={e => { onBrandInput(e.target.value); if (e.target.value) setInvoiceQ('') }}
              onFocus={() => { if (brandQ.length >= 1) setShowSugg(true) }}
              placeholder="Brand name…"
              style={{ border: 'none', outline: 'none', fontSize: 13, color: '#111', background: 'transparent', flex: 1, padding: '8px 0', fontFamily: 'Inter, sans-serif' }}
              autoComplete="off"
              onBlur={() => { if (window.visualViewport) { (document.documentElement.style as any).zoom = '1' } }}
            />
            {showSugg && brandSuggestions.length > 0 && (
              <div ref={suggRef} className="sugg-box">
                {brandSuggestions.map(s => (
                  <div key={s} className="sugg-item"
                    onMouseDown={() => { setBrandQ(s); setShowSugg(false); setInvoiceQ('') }}>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search button */}
          <button type="submit" disabled={(!invoiceQ.trim() && !brandQ.trim()) || searching}
            style={{ background: blue, color: '#fff', border: 'none', borderRadius: '0 6px 6px 0', padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0, opacity: (!invoiceQ.trim() && !brandQ.trim()) || searching ? 0.5 : 1 }}>
            {searching ? '…' : '🔍 Search'}
          </button>
        </form>
      </div>

      {/* ── RESULT PANEL (above the table) ── */}
      {state.phase !== 'idle' && (
        <div style={{ background: blueL, borderBottom: `1px solid ${border}`, padding: '12px 16px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 560 }}>

            {/* FOUND */}
            {state.phase === 'found' && (
              <div className="result-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: blueD }}>Invoice Found</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {state.row.logged && (
                      <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 10px' }}>
                        ✓ Logged by {state.row.logged_by}
                      </span>
                    )}
                    <button onClick={reset} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
                </div>

                {/* Green PO badge after logging */}
                {loggedRow && loggedRow.id === state.row.id && (
                  <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: 8, padding: '8px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>✅</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d' }}>Logged successfully</div>
                      {loggedRow.po_no && (
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#166534', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                          PO# {loggedRow.po_no}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <InfoRow label="Invoice #" value={state.row.invoice_no} />
                  <InfoRow label="PO #"      value={state.row.po_no} />
                  <InfoRow label="Brand"     value={state.row.brand} />
                  <InfoRow label="Qty"       value={state.row.qty} />
                  {state.row.logged_at && <InfoRow label="Logged at" value={fmtTs(state.row.logged_at)} />}
                  {state.row.note && <InfoRow label="Note" value={state.row.note} />}
                </div>

                {!state.row.logged && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input value={logNote} onChange={e => setLogNote(e.target.value)}
                      placeholder="Note (optional)…" style={{ ...inputSt, flex: 1, minWidth: 140 }} />
                    <button onClick={() => logRow(state.row)} disabled={logging} className="aw-btn aw-btn-primary">
                      {logging ? '…' : '✓ Log Invoice'}
                    </button>
                    <button onClick={reset} className="aw-btn aw-btn-gray">Cancel</button>
                  </div>
                )}
                {state.row.logged && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {isAdmin && (
                      <button onClick={() => unlogRow(state.row)} className="aw-btn aw-btn-amber" style={{ fontSize: 11 }}>↩ Un-log</button>
                    )}
                    <button onClick={reset} className="aw-btn aw-btn-gray">← Back</button>
                  </div>
                )}
              </div>
            )}

            {/* NOT FOUND */}
            {state.phase === 'notfound' && (
              <div className="result-card">
                <div style={{ fontSize: 13, fontWeight: 800, color: '#dc2626', marginBottom: 6 }}>
                  {state.byBrand
                    ? <>No invoices found for brand: <span style={{ fontFamily: 'monospace' }}>{state.term}</span></>
                    : <>Invoice not found: <span style={{ fontFamily: 'monospace' }}>{state.term}</span></>
                  }
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
                  Not in the system for store <strong>{user?.store}</strong>.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={reset} className="aw-btn aw-btn-outline">🔄 Try again</button>
                  {!state.byBrand && (
                    <button onClick={() => quickCreateRequest(state.term, brandQ.trim())}
                      disabled={submitting} className="aw-btn aw-btn-amber">
                      {submitting ? '…' : '⚑ Create log request'}
                    </button>
                  )}
                  {state.byBrand && (
                    <button onClick={() => quickCreateRequest(invoiceQ.trim(), state.term)}
                      disabled={submitting} className="aw-btn aw-btn-amber">
                      {submitting ? '…' : '⚑ Create log request'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* BRAND RESULTS */}
            {state.phase === 'brand' && (
              <div className="result-card">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 8 }}>
                  {state.results.length} invoice{state.results.length !== 1 ? 's' : ''} found for "{state.term}"
                  <button onClick={reset} style={{ float: 'right', background: 'none', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>✕</button>
                </div>
                {state.results.map(row => (
                  <div key={row.id} className="brand-row"
                    onClick={() => { setState({ phase: 'found', row }); setInvoiceQ(row.invoice_no) }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: blueD }}>{row.brand}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        Invoice: {row.invoice_no}{row.po_no ? ` · PO: ${row.po_no}` : ''}{row.qty ? ` · Qty: ${row.qty}` : ''}
                      </div>
                      {row.logged && (
                        <div style={{ fontSize: 10, color: '#15803d', fontWeight: 700 }}>✓ Logged by {row.logged_by} · {fmtTs(row.logged_at)}</div>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: row.logged ? '#15803d' : '#60a5fa', fontWeight: 700 }}>
                      {row.logged ? '✓ Done' : 'Select →'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* CREATE REQUEST — auto-submits, this state is transitional; shown briefly */}
            {state.phase === 'create' && (
              <div className="result-card" style={{ borderColor: amber, background: amberL }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: amber, marginBottom: 4 }}>⚑ Submitting Log Request…</div>
                <div style={{ fontSize: 12, color: '#92400e' }}>
                  Invoice <strong>{state.invoice}</strong> · Brand: <strong>{brandQ.trim() || '—'}</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STORE LOG TABLE (IC-log style) ── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 900, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: blueD }}>Filter:</span>
          <input value={tableFilter} onChange={e => setTableFilter(e.target.value)}
            placeholder="invoice, brand, PO, user…"
            style={{ ...inputSt, flex: 1 }} />
          <button onClick={() => fetchStoreRows()} className="aw-refresh-btn" style={{ background: '#dbeafe', border: 'none', color: blueD, borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ↺ Refresh
          </button>
          <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
            {filteredStore.length} rows · <span style={{ color: '#15803d', fontWeight: 700 }}>✓ {loggedCount}</span>
            {flaggedCount > 0 && <> · <span style={{ color: '#92400e', fontWeight: 700 }}>⚑ {flaggedCount}</span></>}
          </span>
        </div>
      </div>

      <div ref={tableScrollRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }} onClick={() => setCtxMenu(null)}
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; setPulling(false) }}
        onTouchMove={e => {
          const el = tableScrollRef.current; if (!el) return
          const dy = e.touches[0].clientY - touchStartY.current
          if (el.scrollTop === 0 && dy > 0) { setPullY(Math.min(dy, 72)); setPulling(true) }
          else { setPullY(0); setPulling(false) }
        }}
        onTouchEnd={() => {
          if (pullY > 50) { fetchStoreRows(); }
          setPullY(0); setPulling(false)
        }}
      >
        {pulling && pullY > 10 && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#2563eb', opacity: Math.min(pullY / 50, 1) }}>
            {pullY > 50 ? '↑ Release to refresh' : '↓ Pull to refresh'}
          </div>
        )}
        {tableLoading ? (
          <p style={{ padding: 24, color: '#93c5fd', fontSize: 13 }}>Loading…</p>
        ) : (
          <>
          <div className="aw-table-wrap" style={{ justifyContent: 'center', padding: '0 16px 40px' }}>
          <div style={{ background: '#fff', border: '1px solid #93c5fd', overflow: 'auto', width: '100%', maxWidth: 900, alignSelf: 'flex-start' }}>
            <table className="aw-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {isAdmin && <th>Store</th>}
                  <th>Brand</th>
                  <th>Invoice #</th>
                  <th className="aw-col-hide">PO #</th>
                  <th className="aw-col-hide">Qty</th>
                  <th>Status</th>
                  <th className="aw-col-hide">Logged By</th>
                  <th className="aw-col-hide">Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredStore.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#93c5fd', fontSize: 13 }}>
                    {storeRows.length === 0 ? 'No invoices in system yet.' : 'No matches.'}
                  </td></tr>
                )}
                {filteredStore.map((r, i) => {
                  const logged = r.logged && !r.flagged
                  const bg = r.flagged ? '#fffbeb' : logged ? (i % 2 === 0 ? '#dcfce7' : '#d1fae5') : (i % 2 === 0 ? '#fff' : '#eff6ff')
                  const txt = logged ? '#166534' : r.flagged ? '#92400e' : '#1f2937'
                  const dim = logged ? '#15803d' : r.flagged ? '#b45309' : '#6b7280'
                  return (
                    <tr key={r.id} style={{ background: bg, cursor: 'pointer' }}
                      onClick={() => { setState({ phase: 'found', row: r }); setInvoiceQ(r.invoice_no); setLoggedRow(r.logged ? r : null) }}
                      onContextMenu={e => { e.preventDefault(); setCtxMenu({ id: r.id, x: e.clientX, y: e.clientY }) }}>
                      <td style={{ color: dim, whiteSpace: 'nowrap', fontSize: 11 }}>{fmtDate(r.created_at)}</td>
                      {isAdmin && <td style={{ fontWeight: 700, color: logged ? '#15803d' : blueD, fontSize: 11 }}>{r.store}</td>}
                      <td style={{ fontWeight: 600, color: txt }}>{r.brand}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: logged ? '#14532d' : blueD, fontWeight: 700 }}>{r.invoice_no}</td>
                      <td className="aw-col-hide" style={{ fontFamily: 'monospace', fontSize: 11, color: txt }}>{r.po_no || '—'}</td>
                      <td className="aw-col-hide" style={{ textAlign: 'right', color: txt }}>{r.qty ?? '—'}</td>
                      <td>
                        {r.flagged
                          ? <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}>⚑ Flagged</span>
                          : r.logged
                            ? <span style={{ background: '#bbf7d0', color: '#14532d', border: '1px solid #86efac', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}>✓ Logged</span>
                            : <span style={{ background: '#e0e7ff', color: blueD, fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>Pending</span>
                        }
                      </td>
                      <td className="aw-col-hide" style={{ fontSize: 10, color: dim }}>{r.logged_by || '—'}</td>
                      <td className="aw-col-hide" style={{ fontSize: 10, color: dim, maxWidth: 140 }}>{r.note || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>

          {/* ── MOBILE CARDS ── */}
          <div className="aw-cards" style={{ paddingBottom: 40 }}>
            {filteredStore.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#9b8ec4', fontSize: 13, padding: 24 }}>
                {storeRows.length === 0 ? 'No invoices in system yet.' : 'No matches.'}
              </p>
            ) : filteredStore.map((r) => {
              const logged = r.logged && !r.flagged
              const cardBg = r.flagged ? '#fffbeb' : logged ? '#dcfce7' : '#fff'
              const cardBorder = r.flagged ? '#fcd34d' : logged ? '#86efac' : '#93c5fd'
              return (
                <div key={r.id}
                  style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}
                  onClick={() => { setState({ phase: 'found', row: r }); setInvoiceQ(r.invoice_no); setLoggedRow(r.logged ? r : null) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: logged ? '#14532d' : r.flagged ? '#92400e' : '#1f2937' }}>
                        {r.invoice_no}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: logged ? '#166534' : '#374151', marginTop: 2 }}>{r.brand}</div>
                      {r.note && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Note: {r.note}</div>}
                    </div>
                    <span style={{
                      background: r.flagged ? '#fef3c7' : logged ? '#bbf7d0' : '#e0e7ff',
                      color: r.flagged ? '#92400e' : logged ? '#14532d' : blueD,
                      border: `1px solid ${r.flagged ? '#fcd34d' : logged ? '#86efac' : '#a5b4fc'}`,
                      fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {r.flagged ? '⚑ Flagged' : logged ? '✓ Logged' : 'Pending'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 11, color: logged ? '#16a34a' : '#6b7280', flexWrap: 'wrap' }}>
                    {isAdmin && <><span style={{ fontWeight: 700 }}>{r.store}</span><span>·</span></>}
                    <span>{fmtDate(r.created_at)}</span>
                    {r.logged_by && <><span>·</span><span>{displayUser(r.logged_by)}</span></>}
                    {r.po_no && <><span>·</span><span>PO: {r.po_no}</span></>}
                  </div>
                </div>
              )
            })}
          </div>
          </>
        )}
      </div>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#1e3a8a', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* ════ POs AW MODAL ════ */}
      {showModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal-box">
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

            <div className="modal-tabs">
              {(['paste','view'] as const).map(t => (
                <button key={t} className={`modal-tab${modalTab === t ? ' active' : ''}`}
                  onClick={() => { setModalTab(t); if (t === 'view') fetchAW() }}>
                  {t === 'paste' ? '⚡ Paste Processor' : '📋 View All'}
                </button>
              ))}
            </div>

            {/* PASTE TAB */}
            {modalTab === 'paste' && (
              <div className="modal-body" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10, flexShrink: 0 }}>
                  Copy rows from Excel and paste left. <strong>Date · Vendor ID · Brand · Store · C.I. · Invoice # · PO # · Season · Source · Qty</strong>
                </p>
                <div className="paste-layout" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <label style={{ ...labelSt, fontSize: 10, marginRight: 4 }}>PASTE DATA</label>
                      <button onClick={async () => {
                        if (!pastePreview.length) return
                        setPasting(true)
                        const allRows = pastePreview.map(r => ({ store: r.store, brand: r.brand, invoice_no: r.invoice_no, po_no: r.po_no ?? '', qty: r.qty, logged: false, flagged: false }))
                        // De-dupe against existing rows
                        const invoiceNos = Array.from(new Set(allRows.map(r => r.invoice_no)))
                        const { data: existing } = await supabase.from('season_aw').select('store,brand,invoice_no,po_no,qty').in('invoice_no', invoiceNos)
                        const existingSet = new Set((existing || []).map(e => `${e.store}|${e.brand}|${e.invoice_no}|${e.po_no ?? ''}|${e.qty}`))
                        const rows = allRows.filter(r => !existingSet.has(`${r.store}|${r.brand}|${r.invoice_no}|${r.po_no}|${r.qty}`))
                        const dupes = allRows.length - rows.length
                        let ok = 0; let skip = 0
                        for (let i = 0; i < rows.length; i += 50) {
                          const batch = rows.slice(i, i + 50)
                          const { error, data } = await supabase.from('season_aw').insert(batch).select('id')
                          if (error) skip += batch.length; else ok += (data?.length || batch.length)
                        }
                        setPasting(false); setPasteResult({ ok, skip: skip + dupes })
                        if (ok > 0) { fetchAW(); fetchStoreRows(); showToast(`✅ Inserted ${ok} rows${dupes > 0 ? ` · ${dupes} dupes skipped` : ''}`) }
                        if (dupes > 0 && ok === 0) showToast(`⚠️ ${dupes} duplicate${dupes !== 1 ? 's' : ''} skipped — nothing new`, 'err')
                        if (skip > 0) showToast(`⚠️ ${skip} rows failed`, 'err')
                      }} disabled={pasting || pastePreview.length === 0} className="aw-btn aw-btn-primary">
                        {pasting ? '…inserting…' : `⚡ Insert ${pastePreview.length} rows`}
                      </button>
                      <button onClick={() => { setPasteText(''); setPastePreview([]); setPasteResult(null) }} className="aw-btn aw-btn-gray">Clear</button>
                      {pasteResult && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: pasteResult.skip > 0 ? '#dc2626' : '#15803d' }}>
                          ✓ {pasteResult.ok} inserted{pasteResult.skip > 0 ? ` · ✕ ${pasteResult.skip} failed` : ''}
                        </span>
                      )}
                    </div>
                    <textarea className="paste-area" value={pasteText}
                      onChange={e => { setPasteText(e.target.value); setPasteResult(null); if (e.target.value.trim()) setPastePreview(parsePasteData(e.target.value)); else setPastePreview([]) }}
                      placeholder="Paste tab-separated rows here…" />
                    {pasteText && pastePreview.length === 0 && (
                      <div style={{ fontSize: 12, color: '#dc2626' }}>No rows parsed. Copy directly from Excel.</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                    <label style={{ ...labelSt, fontSize: 10 }}>PREVIEW — {pastePreview.length} ROW{pastePreview.length !== 1 ? 'S' : ''}</label>
                    {pastePreview.length > 0 ? (
                      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #e0e7ff', borderRadius: 8 }}>
                        <table className="ss-table">
                          <thead><tr><th>#</th><th>Store</th><th>Brand</th><th>Invoice #</th><th>PO #</th><th>Qty</th></tr></thead>
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

            {/* VIEW ALL TAB */}
            {modalTab === 'view' && (
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={awFilter} onChange={e => setAwFilter(e.target.value)}
                    placeholder="Search invoice, brand, PO…" style={{ ...inputSt, flex: 1, minWidth: 160 }} />
                  <select value={awStoreFilter} onChange={e => setAwStoreFilter(e.target.value)} style={{ ...inputSt, minWidth: 80 }}>
                    <option value="ALL">All Stores</option>
                    {AW_STORES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={fetchAW} className="aw-btn aw-btn-outline">↺ Refresh</button>
                  <button onClick={clearSeason} disabled={clearing} className="aw-btn aw-btn-red">{clearing ? '…' : '🗑 Clear Season'}</button>
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 10, fontWeight: 700 }}>
                  <span style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 7px', color: '#92400e' }}>⚑ Flagged</span>
                  <span style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, padding: '1px 7px', color: '#15803d' }}>✓ Logged</span>
                  <span style={{ background: '#f8faff', border: '1px solid #c7d2fe', borderRadius: 4, padding: '1px 7px', color: blueD }}>Pending</span>
                </div>
                {awLoading ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#93c5fd' }}>Loading…</div>
                ) : (
                  <div style={{ overflow: 'auto', maxHeight: 500, border: '1px solid #e0e7ff', borderRadius: 8 }}>
                    <table className="ss-table">
                      <thead>
                        <tr><th>#</th><th>Store</th><th>Brand</th><th>Invoice #</th><th>PO #</th><th>Qty</th><th>Status</th><th>Logged By</th><th>Logged At</th><th>Note</th></tr>
                      </thead>
                      <tbody>
                        {filteredAW.map((r, i) => {
                          const bg = r.flagged ? '#fffbeb' : r.logged ? '#f0fdf4' : i % 2 === 0 ? '#fff' : '#f8faff'
                          return (
                            <tr key={r.id} style={{ background: bg }}
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
                              <td style={{ color: '#64748b', fontSize: 10, whiteSpace: 'nowrap' }}>{fmtTs(r.logged_at)}</td>
                              <td style={{ color: '#64748b', fontSize: 10, maxWidth: 140 }}>{r.note || ''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {filteredAW.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#93c5fd', fontSize: 12 }}>No rows found</div>}
                  </div>
                )}
                <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: '#64748b' }}>
                  <span>{filteredAW.length} of {awRows.length} rows</span>
                  <span style={{ color: '#15803d', fontWeight: 700 }}>✓ {adminLoggedCount} logged</span>
                  <span style={{ color: '#92400e', fontWeight: 700 }}>⚑ {adminFlaggedCount} flagged</span>
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
          {(() => {
            const r = [...storeRows, ...awRows].find(x => x.id === ctxMenu.id)
            return <>
              <button onClick={() => { if (r) openEdit(r) }}
                style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: blueD, fontWeight: 600, cursor: 'pointer' }}>
                ✏️ Edit
              </button>
              {r?.logged && (
                <button onClick={() => { if (r) unlogRowAdmin(r) }}
                  style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: amber, fontWeight: 600, cursor: 'pointer' }}>
                  ↩ Un-log
                </button>
              )}
              <button onClick={() => deleteRow(ctxMenu.id)}
                style={{ display: 'block', width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>
                🗑 Delete
              </button>
            </>
          })()}
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editRow && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditRow(null) }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', marginTop: 40 }}
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
              <button onClick={saveEdit} disabled={saving} className="aw-btn aw-btn-primary">{saving ? '…' : '✓ Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

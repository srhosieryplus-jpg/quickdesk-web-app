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

// ── Types ─────────────────────────────────────────────────────────────────────
interface EditSheetRow {
  id: string
  store: string
  brand: string
  order_num: string | null
  season: string | null
  markup: string | null
  markup_add: number | null
  status: 'Pending' | 'Edits Completed'
  note: string | null
  pdf_files: { url: string; name: string; uploaded_at: string }[] | null
  season_book_id: string | null
  created_at: string
  updated_at: string | null
  created_by: string | null
}

// ── Theme (teal/green) ────────────────────────────────────────────────────────
const teal    = '#0d9488'
const tealD   = '#0f5a52'
const tealL   = '#f0fdfa'
const border  = '#99f6e4'
const gray    = '#6b7280'

const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: tealD, letterSpacing: '0.07em', textTransform: 'uppercase', display: 'block', marginBottom: 3 }
const inp: React.CSSProperties = { background: '#fff', border: '1.5px solid #d1d5db', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: '#111', outline: 'none', width: '100%', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }

const MARKUP_OPTIONS = ['x2', 'x2.1', 'x2.2', 'x2.3', 'x2.4', 'x2.5', 'MSRP']
const STORES = ['TTC', 'TTP']
const STATUS_OPTIONS: EditSheetRow['status'][] = ['Pending', 'Edits Completed']

function fmtTs(ts: string | null) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return ts }
}

function statusColor(s: string) {
  if (s === 'Edits Completed') return { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' }
  return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' }
}

export default function EditSheetPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const isAdmin = user?.store === 'ALL'

  // ── State ─────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<EditSheetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok'|'err'>('ok')

  // Search
  const [brandQ, setBrandQ] = useState('')
  const [brandSuggs, setBrandSuggs] = useState<string[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const brandRef = useRef<HTMLInputElement>(null)
  const suggRef  = useRef<HTMLDivElement>(null)
  const [searching, setSearching] = useState(false)

  type SearchState =
    | { phase: 'idle' }
    | { phase: 'found'; rows: EditSheetRow[] }
    | { phase: 'notfound'; term: string }

  const [state, setState] = useState<SearchState>({ phase: 'idle' })

  // Table
  const [tableFilter, setTableFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // New entry
  const [showNew, setShowNew] = useState(false)
  const [newStore, setNewStore] = useState('TTC')
  const [newBrand, setNewBrand] = useState('')
  const [newOrderNum, setNewOrderNum] = useState('')
  const [newSeason, setNewSeason] = useState('')
  const [newMarkup, setNewMarkup] = useState('x2')
  const [newMarkupAdd, setNewMarkupAdd] = useState('')
  const [newMarkupCustom, setNewMarkupCustom] = useState('')
  const [newStatus, setNewStatus] = useState<EditSheetRow['status']>('Pending')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Edit
  const [editRow, setEditRow] = useState<EditSheetRow | null>(null)
  const [editMarkup, setEditMarkup] = useState('')
  const [editMarkupAdd, setEditMarkupAdd] = useState('')
  const [editMarkupCustom, setEditMarkupCustom] = useState('')
  const [editStatus, setEditStatus] = useState<EditSheetRow['status']>('Pending')
  const [editNote, setEditNote] = useState('')
  const [editOrderNum, setEditOrderNum] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // PDF upload in edit
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // History panel
  const [historyBrand, setHistoryBrand] = useState<string | null>(null)
  const [historyRows, setHistoryRows] = useState<EditSheetRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    if (user) fetchRows()
  }, [user])

  // Idle redirect
  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVis() {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [router])

  // Click-outside suggestions
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (suggRef.current && !suggRef.current.contains(e.target as Node) &&
          brandRef.current && !brandRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3200)
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    if (!user) return
    setLoading(true)
    let q = supabase.from('edit_sheet').select('*').order('created_at', { ascending: false })
    if (!isAdmin) {
      const viewStores = [user.store, ...(user.admin_stores ?? [])].filter(Boolean)
      q = viewStores.length === 1 ? q.eq('store', viewStores[0]) : q.in('store', viewStores)
    }
    const { data } = await q
    setLoading(false)
    setRows((data || []) as EditSheetRow[])
  }, [user, isAdmin])

  // ── Brand autocomplete ────────────────────────────────────────────────────
  function onBrandInput(val: string) {
    setBrandQ(val)
    if (val.trim().length >= 1) {
      const q = val.toLowerCase()
      const starts = BRAND_LIST.filter(b => b.toLowerCase().startsWith(q)).slice(0, 8)
      const contains = BRAND_LIST.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q)).slice(0, 4)
      setBrandSuggs([...starts, ...contains])
      setShowSugg(true)
    } else { setBrandSuggs([]); setShowSugg(false) }
  }

  // ── Search ────────────────────────────────────────────────────────────────
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!brandQ.trim()) return
    setShowSugg(false)
    setSearching(true)
    const q = brandQ.trim()
    let query = supabase.from('edit_sheet').select('*').ilike('brand', `%${q}%`).order('created_at', { ascending: false })
    if (!isAdmin) {
      const viewStores = [user!.store, ...(user!.admin_stores ?? [])].filter(Boolean)
      query = viewStores.length === 1 ? query.eq('store', viewStores[0]) : query.in('store', viewStores)
    }
    const { data } = await query
    setSearching(false)
    if (!data || data.length === 0) setState({ phase: 'notfound', term: q })
    else setState({ phase: 'found', rows: data as EditSheetRow[] })
  }

  function resetSearch() {
    setState({ phase: 'idle' })
    setBrandQ('')
    fetchRows()
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async function createRow() {
    if (!user || !newBrand.trim()) { showToast('❌ Brand required', 'err'); return }
    setSaving(true)
    const markupVal = newMarkup === '__custom__' ? newMarkupCustom.trim() : newMarkup
    const { error } = await supabase.from('edit_sheet').insert({
      store: newStore, brand: newBrand.trim(),
      order_num: newOrderNum.trim() || null,
      season: newSeason.trim() || null,
      markup: markupVal || null,
      markup_add: newMarkupAdd ? parseFloat(newMarkupAdd) : null,
      status: newStatus, note: newNote.trim() || null,
      created_by: user.userid,
      pdf_files: [],
    })
    setSaving(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Entry added')
    setShowNew(false)
    setNewBrand(''); setNewOrderNum(''); setNewSeason(''); setNewMarkup('x2')
    setNewMarkupAdd(''); setNewMarkupCustom(''); setNewStatus('Pending'); setNewNote('')
    fetchRows()
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  function openEdit(row: EditSheetRow) {
    setEditRow(row)
    setEditMarkup(row.markup || 'x2')
    setEditMarkupAdd(row.markup_add?.toString() || '')
    setEditMarkupCustom('')
    setEditStatus(row.status)
    setEditNote(row.note || '')
    setEditOrderNum(row.order_num || '')
  }

  async function saveEdit() {
    if (!editRow) return
    setEditSaving(true)
    const markupVal = editMarkup === '__custom__' ? editMarkupCustom.trim() : editMarkup
    const { error } = await supabase.from('edit_sheet').update({
      markup: markupVal || null,
      markup_add: editMarkupAdd ? parseFloat(editMarkupAdd) : null,
      status: editStatus,
      note: editNote.trim() || null,
      order_num: editOrderNum.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editRow.id)
    setEditSaving(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Saved')
    setEditRow(null)
    fetchRows()
  }

  // ── PDF upload ────────────────────────────────────────────────────────────
  async function handlePDFUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editRow || !e.target.files?.[0]) return
    const file = e.target.files[0]
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `es_${editRow.id}_${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('invoices').upload(path, file)
    if (upErr) { showToast('❌ Upload failed: ' + upErr.message, 'err'); setUploading(false); return }
    const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path)
    const newFile = { url: urlData.publicUrl, name: file.name, uploaded_at: new Date().toISOString() }
    const updatedFiles = [...(editRow.pdf_files || []), newFile]
    const { error: dbErr } = await supabase.from('edit_sheet').update({ pdf_files: updatedFiles }).eq('id', editRow.id)
    setUploading(false)
    if (dbErr) { showToast('❌ ' + dbErr.message, 'err'); return }
    setEditRow({ ...editRow, pdf_files: updatedFiles })
    showToast('✅ PDF attached')
    fetchRows()
  }

  async function removePDF(url: string) {
    if (!editRow) return
    const updated = (editRow.pdf_files || []).filter(f => f.url !== url)
    await supabase.from('edit_sheet').update({ pdf_files: updated }).eq('id', editRow.id)
    setEditRow({ ...editRow, pdf_files: updated })
    fetchRows()
  }

  // ── History panel ─────────────────────────────────────────────────────────
  async function openHistory(brand: string) {
    setHistoryBrand(brand)
    setHistoryLoading(true)
    const { data } = await supabase.from('edit_sheet').select('*').ilike('brand', brand).order('created_at', { ascending: false })
    setHistoryLoading(false)
    setHistoryRows((data || []) as EditSheetRow[])
  }

  // ── Filtered table ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = tableFilter.toLowerCase()
    return rows.filter(r => {
      if (storeFilter !== 'ALL' && r.store !== storeFilter) return false
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (!q) return true
      return (
        (r.brand || '').toLowerCase().includes(q) ||
        (r.order_num || '').toLowerCase().includes(q) ||
        (r.season || '').toLowerCase().includes(q) ||
        (r.markup || '').toLowerCase().includes(q) ||
        (r.note || '').toLowerCase().includes(q)
      )
    })
  }, [rows, tableFilter, storeFilter, statusFilter])

  if (!user) return null

  const markupDisplay = (row: EditSheetRow) => {
    if (!row.markup) return '—'
    return row.markup_add ? `${row.markup} +${row.markup_add}` : row.markup
  }

  return (
    <div style={{ minHeight: '100vh', background: '#edfcfa', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        .es-header { background: linear-gradient(135deg, ${tealD} 0%, ${teal} 100%); padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .es-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.07); padding: 18px; margin: 0 16px 16px; }
        .es-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .es-table th { background: ${tealL}; color: ${tealD}; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; padding: 8px 10px; text-align: left; border-bottom: 2px solid ${border}; }
        .es-table td { padding: 9px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
        .es-table tr:hover td { background: #f0fdfa; }
        .es-badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 800; border: 1px solid; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .modal-box { background: #fff; border-radius: 14px; width: 100%; max-width: 680px; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 8px 48px rgba(0,0,0,0.22); }
        .modal-head { padding: 14px 18px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .modal-body { overflow-y: auto; flex: 1; padding: 18px; }
        .modal-foot { padding: 12px 18px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
        .hist-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 320px; background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.12); z-index: 900; display: flex; flex-direction: column; }
        @media (max-width: 600px) {
          .modal-bg { padding: 0; align-items: flex-end; }
          .modal-box { border-radius: 18px 18px 0 0 !important; max-width: 100% !important; }
          .es-card { margin: 0 8px 12px; padding: 12px; }
        }
      `}</style>

      {/* Header */}
      <div className="es-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/selector')} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← Back</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-0.01em' }}>✏️ Edit Sheet</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{isAdmin ? 'All Stores' : user.store}</div>
          </div>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ background: '#fff', color: tealD, border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
          + New Entry
        </button>
      </div>

      {/* Search bar */}
      <div style={{ padding: '14px 16px 0' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input ref={brandRef} value={brandQ} onChange={e => onBrandInput(e.target.value)}
              onFocus={() => brandQ.trim() && setShowSugg(true)}
              placeholder="Search by brand…"
              style={{ ...inp, paddingRight: 32 }} />
            {showSugg && brandSuggs.length > 0 && (
              <div ref={suggRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${border}`, borderRadius: 7, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto' }}>
                {brandSuggs.map(b => (
                  <div key={b} onMouseDown={e => { e.preventDefault(); setBrandQ(b); setShowSugg(false) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}
                    onMouseEnter={e => (e.currentTarget.style.background = tealL)}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" style={{ background: teal, color: '#fff', border: 'none', borderRadius: 7, padding: '0 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {searching ? '…' : 'Search'}
          </button>
          {state.phase !== 'idle' && (
            <button type="button" onClick={resetSearch} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '0 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
          )}
        </form>
        {state.phase === 'notfound' && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>No results for "{state.term}"</div>
        )}
      </div>

      {/* Main table card */}
      <div className="es-card" style={{ marginTop: 14, overflowX: 'auto' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={tableFilter} onChange={e => setTableFilter(e.target.value)} placeholder="Filter…"
            style={{ ...inp, width: 180, fontSize: 12 }} />
          {isAdmin && (
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
              style={{ ...inp, width: 100, fontSize: 12, cursor: 'pointer' }}>
              <option value="ALL">All Stores</option>
              {STORES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ ...inp, width: 160, fontSize: 12, cursor: 'pointer' }}>
            <option value="ALL">All Statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ fontSize: 12, color: gray, marginLeft: 'auto' }}>{filtered.length} row{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: gray }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: gray, fontSize: 13 }}>No entries yet — click + New Entry to add one.</div>
        ) : (
          <table className="es-table">
            <thead>
              <tr>
                {isAdmin && <th>Store</th>}
                <th>Brand</th>
                <th>Order #</th>
                <th>Season</th>
                <th>Markup</th>
                <th>Status</th>
                <th>PDFs</th>
                <th>Note</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(state.phase === 'found' ? state.rows : filtered).map(row => {
                const sc = statusColor(row.status)
                return (
                  <tr key={row.id}>
                    {isAdmin && <td style={{ fontWeight: 700, color: tealD }}>{row.store}</td>}
                    <td>
                      <div style={{ fontWeight: 700 }}>{row.brand}</div>
                      {row.season_book_id && <div style={{ fontSize: 10, color: teal, fontWeight: 600 }}>🔗 Season Book</div>}
                    </td>
                    <td style={{ color: gray, fontSize: 12 }}>{row.order_num || '—'}</td>
                    <td style={{ fontSize: 12 }}>{row.season || '—'}</td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: 13, color: tealD }}>{markupDisplay(row)}</span>
                    </td>
                    <td>
                      <span className="es-badge" style={{ background: sc.bg, color: sc.color, borderColor: sc.border }}>{row.status}</span>
                    </td>
                    <td>
                      {(row.pdf_files || []).length > 0 ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(row.pdf_files || []).map((f, i) => (
                            <a key={i} href={f.url} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: teal, fontWeight: 600, textDecoration: 'none', background: tealL, border: `1px solid ${border}`, borderRadius: 5, padding: '2px 7px' }}>
                              📄 {f.name.length > 14 ? f.name.slice(0, 12) + '…' : f.name}
                            </a>
                          ))}
                        </div>
                      ) : <span style={{ fontSize: 11, color: '#d1d5db' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12, color: gray, maxWidth: 160 }}>{row.note || '—'}</td>
                    <td style={{ fontSize: 11, color: gray, whiteSpace: 'nowrap' }}>{fmtTs(row.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => openEdit(row)}
                          style={{ background: tealL, color: tealD, border: `1px solid ${border}`, borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                          Edit
                        </button>
                        <button onClick={() => openHistory(row.brand)}
                          style={{ background: '#f5f3ff', color: '#5b21b6', border: '1px solid #c4b5fd', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── New Entry Modal ──────────────────────────────────────────────────── */}
      {showNew && (
        <div className="modal-bg">
          <div className="modal-box">
            <div className="modal-head">
              <span style={{ fontSize: 15, fontWeight: 800, color: tealD }}>+ New Edit Sheet Entry</span>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                {isAdmin && (
                  <div>
                    <label style={lbl}>Store</label>
                    <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                      {STORES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={lbl}>Brand</label>
                  <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Brand name" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Order #</label>
                  <input value={newOrderNum} onChange={e => setNewOrderNum(e.target.value)} placeholder="Order number" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Season</label>
                  <input value={newSeason} onChange={e => setNewSeason(e.target.value)} placeholder="e.g. SS27" style={inp} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Markup</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={newMarkup} onChange={e => setNewMarkup(e.target.value)} style={{ ...inp, cursor: 'pointer', flex: 1 }}>
                      {MARKUP_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                      <option value="__custom__">+ Custom…</option>
                    </select>
                    {newMarkup === '__custom__' && (
                      <input value={newMarkupCustom} onChange={e => setNewMarkupCustom(e.target.value)} placeholder="e.g. x2.7" style={{ ...inp, width: 90 }} />
                    )}
                  </div>
                </div>
                <div>
                  <label style={lbl}>+ Add to Markup</label>
                  <input type="number" step="0.01" value={newMarkupAdd} onChange={e => setNewMarkupAdd(e.target.value)} placeholder="e.g. 8" style={inp} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Status</label>
                  <select value={newStatus} onChange={e => setNewStatus(e.target.value as EditSheetRow['status'])} style={{ ...inp, cursor: 'pointer' }}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Note</label>
                  <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Optional note" style={inp} />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setShowNew(false)} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={createRow} disabled={saving} style={{ background: teal, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Saving…' : '+ Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ──────────────────────────────────────────────────────── */}
      {editRow && (
        <div className="modal-bg">
          <div className="modal-box">
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: tealD }}>{editRow.brand}</div>
                <div style={{ fontSize: 11, color: gray }}>{editRow.store} · {editRow.season || '—'}</div>
              </div>
              <button onClick={() => setEditRow(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
              {/* Order # */}
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Order #</label>
                <input value={editOrderNum} onChange={e => setEditOrderNum(e.target.value)} placeholder="Order number" style={inp} />
              </div>
              {/* Markup row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Markup</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={editMarkup} onChange={e => setEditMarkup(e.target.value)} style={{ ...inp, cursor: 'pointer', flex: 1 }}>
                      {MARKUP_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                      <option value="__custom__">+ Custom…</option>
                    </select>
                    {editMarkup === '__custom__' && (
                      <input value={editMarkupCustom} onChange={e => setEditMarkupCustom(e.target.value)} placeholder="e.g. x2.7" style={{ ...inp, width: 90 }} />
                    )}
                  </div>
                </div>
                <div>
                  <label style={lbl}>+ Add to Markup</label>
                  <input type="number" step="0.01" value={editMarkupAdd} onChange={e => setEditMarkupAdd(e.target.value)} placeholder="e.g. 8" style={inp} />
                </div>
              </div>
              {/* Status */}
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value as EditSheetRow['status'])} style={{ ...inp, cursor: 'pointer' }}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* Note */}
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Note</label>
                <input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Optional note" style={inp} />
              </div>

              {/* PDF attachments */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: gray, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, borderBottom: `1.5px solid ${border}`, paddingBottom: 4 }}>
                  📎 PDF Edits
                </div>
                {(editRow.pdf_files || []).map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, background: tealL, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 10px' }}>
                    <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: tealD, textDecoration: 'none', flex: 1 }}>
                      📄 {f.name}
                    </a>
                    <span style={{ fontSize: 10, color: gray }}>{fmtTs(f.uploaded_at)}</span>
                    {isAdmin && (
                      <button onClick={() => removePDF(f.url)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                    )}
                  </div>
                ))}
                <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={handlePDFUpload} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  style={{ background: tealL, color: tealD, border: `1.5px solid ${border}`, borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>
                  {uploading ? 'Uploading…' : '📎 Attach PDF Edit'}
                </button>
              </div>

              {/* Linked season book info */}
              {editRow.season_book_id && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 7, fontSize: 11, color: '#5b21b6', fontWeight: 600 }}>
                  🔗 Linked to Season Book
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditRow(null)} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Dismiss</button>
              <button onClick={saveEdit} disabled={editSaving} style={{ background: teal, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── History Side Panel ───────────────────────────────────────────────── */}
      {historyBrand && (
        <>
          <div onClick={() => setHistoryBrand(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 899 }} />
          <div className="hist-panel">
            <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: tealL }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: tealD }}>History</div>
                <div style={{ fontSize: 12, color: gray }}>{historyBrand}</div>
              </div>
              <button onClick={() => setHistoryBrand(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', color: gray, padding: 24 }}>Loading…</div>
              ) : historyRows.length === 0 ? (
                <div style={{ textAlign: 'center', color: gray, padding: 24, fontSize: 13 }}>No history found</div>
              ) : historyRows.map(r => {
                const sc = statusColor(r.status)
                return (
                  <div key={r.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: tealD }}>{r.store}</span>
                      <span style={{ fontSize: 10, color: gray }}>{fmtTs(r.created_at)}</span>
                    </div>
                    {r.season && <div style={{ fontSize: 11, color: gray, marginBottom: 4 }}>Season: {r.season}</div>}
                    {r.order_num && <div style={{ fontSize: 11, color: gray, marginBottom: 4 }}>Order #: {r.order_num}</div>}
                    <div style={{ fontSize: 12, fontWeight: 700, color: tealD, marginBottom: 4 }}>{markupDisplay(r)}</div>
                    <span className="es-badge" style={{ background: sc.bg, color: sc.color, borderColor: sc.border }}>{r.status}</span>
                    {r.note && <div style={{ fontSize: 11, color: gray, marginTop: 6, fontStyle: 'italic' }}>{r.note}</div>}
                    {(r.pdf_files || []).length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(r.pdf_files || []).map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 10, color: teal, fontWeight: 600, background: tealL, border: `1px solid ${border}`, borderRadius: 4, padding: '1px 6px', textDecoration: 'none' }}>
                            📄 {f.name.length > 16 ? f.name.slice(0, 14) + '…' : f.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#134e4a', color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

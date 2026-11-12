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

// ── Theme ─────────────────────────────────────────────────────────────────────
const accent  = '#db2777'   // pink
const accentD = '#831843'
const accentL = '#fdf2f8'
const accentB = '#f9a8d4'
const gray    = '#6b7280'
const borderC = '#e5e7eb'

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 3, display: 'block' }
const inp: React.CSSProperties = { background: '#fff', border: `1px solid #d1d5db`, borderRadius: 6, padding: '7px 10px', fontSize: 13, color: '#111', outline: 'none', width: '100%', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }
const inpMd: React.CSSProperties = { ...inp, padding: '8px 12px', fontSize: 14 }

const MARKUP_OPTIONS = ['x2', 'x2.1', 'x2.2', 'x2.3', 'x2.4', 'x2.5', 'MSRP']
const STORES = ['TTC', 'TTP']
const STATUS_OPTIONS: EditSheetRow['status'][] = ['Pending', 'Edits Completed']

// ── Seasons ───────────────────────────────────────────────────────────────────
const BASE_SEASONS = ['SS24','SS25','SS26','SS27','SS28','AW24','AW25','AW26','AW27','AW28']
function buildSeasons(extra: string[]): string[] {
  const all = [...BASE_SEASONS, ...extra.filter(s => !BASE_SEASONS.includes(s))]
  return all.sort((a, b) => {
    const yr = (s: string) => parseInt(s.slice(2))
    const half = (s: string) => s.startsWith('SS') ? 0 : 1
    if (yr(a) !== yr(b)) return yr(a) - yr(b)
    return half(a) - half(b)
  })
}

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

// ── EditRow sub-component (avoids IIFE in map) ────────────────────────────────
function EditRow({ row, isAdmin, accent, accentD, accentL, accentB, gray, markupDisplay, fmtTs, onEdit, onHistory }: {
  row: EditSheetRow; isAdmin: boolean
  accent: string; accentD: string; accentL: string; accentB: string; gray: string; borderC?: string
  markupDisplay: (r: EditSheetRow) => string
  fmtTs: (ts: string | null) => string
  onEdit: (r: EditSheetRow) => void
  onHistory: (brand: string) => void
}) {
  const emptyMarkup = !row.markup || !row.markup.trim()
  const sc = row.status === 'Edits Completed'
    ? { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' }
    : { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' }
  return (
    <tr className="es-row" onClick={() => onEdit(row)} style={emptyMarkup ? { background: '#fef2f2' } : undefined}>
      {isAdmin && <td style={{ fontWeight: 700, color: accentD }}>{row.store}</td>}
      <td>
        <div style={{ fontWeight: 700 }}>{row.brand}</div>
        {row.season_book_id && <div style={{ fontSize: 10, color: accent, fontWeight: 600 }}>🔗 Season Book</div>}
      </td>
      <td style={{ color: gray, fontSize: 12 }}>{row.order_num || '—'}</td>
      <td>
        {emptyMarkup
          ? <span style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 5, padding: '2px 8px' }}>⚠ Empty</span>
          : <span style={{ fontWeight: 700, fontSize: 13, color: accentD }}>{markupDisplay(row)}</span>
        }
      </td>
      <td>
        <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800, border: '1px solid', background: sc.bg, color: sc.color, borderColor: sc.border, whiteSpace: 'nowrap' }}>{row.status}</span>
      </td>
      <td onClick={e => e.stopPropagation()}>
        {(row.pdf_files || []).length > 0 ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(row.pdf_files || []).map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: accent, fontWeight: 600, textDecoration: 'none', background: accentL, border: `1px solid ${accentB}`, borderRadius: 5, padding: '2px 7px' }}>
                📄 {f.name.length > 14 ? f.name.slice(0, 12) + '…' : f.name}
              </a>
            ))}
          </div>
        ) : <span style={{ fontSize: 11, color: '#d1d5db' }}>—</span>}
      </td>
      <td style={{ fontSize: 12, color: gray, maxWidth: 160 }}>{row.note || '—'}</td>
      <td style={{ fontSize: 11, color: gray, whiteSpace: 'nowrap' }}>{fmtTs(row.created_at)}</td>
      <td onClick={e => e.stopPropagation()}>
        <button onClick={() => onHistory(row.brand)}
          style={{ background: accentL, color: accentD, border: `1px solid ${accentB}`, borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          History
        </button>
      </td>
    </tr>
  )
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

  // Season panel
  const [showSeasonPanel, setShowSeasonPanel] = useState(false)
  const [season, setSeason] = useState('SS27')
  const [extraSeasons, setExtraSeasons] = useState<string[]>([])

  // Search / filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [markupFilter, setMarkupFilter] = useState('ALL')

  // Brand search popup
  const [brandQ, setBrandQ] = useState('')
  const [brandSuggs, setBrandSuggs] = useState<string[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const brandRef = useRef<HTMLInputElement>(null)
  const suggRef  = useRef<HTMLDivElement>(null)

  // New entry
  const [showNew, setShowNew] = useState(false)
  const [newStore, setNewStore] = useState('TTC')
  const [newBrand, setNewBrand] = useState('')
  const [newBrandSuggs, setNewBrandSuggs] = useState<string[]>([])
  const [showNewSugg, setShowNewSugg] = useState(false)
  const newBrandRef = useRef<HTMLInputElement>(null)
  const newSuggRef  = useRef<HTMLDivElement>(null)
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
  }, [user, season])

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
      if (newSuggRef.current && !newSuggRef.current.contains(e.target as Node) &&
          newBrandRef.current && !newBrandRef.current.contains(e.target as Node)) setShowNewSugg(false)
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
    let q = supabase.from('edit_sheet').select('*')
      .eq('season', season)
      .order('created_at', { ascending: false })
    if (!isAdmin) {
      const viewStores = [user.store, ...(user.admin_stores ?? [])].filter(Boolean)
      q = viewStores.length === 1 ? q.eq('store', viewStores[0]) : q.in('store', viewStores)
    }
    const { data } = await q
    setLoading(false)
    setRows((data || []) as EditSheetRow[])
    // Collect any extra seasons used in this table so season panel is complete
    const { data: seasons } = await supabase.from('edit_sheet').select('season')
    if (seasons) {
      const all = Array.from(new Set(seasons.map((r: { season: string | null }) => r.season).filter(Boolean))) as string[]
      setExtraSeasons(all.filter(s => !BASE_SEASONS.includes(s)))
    }
  }, [user, isAdmin, season])

  // ── Brand autocomplete ────────────────────────────────────────────────────
  function brandInput(val: string, setter: (v: string) => void, suggSetter: (v: string[]) => void, showSetter: (v: boolean) => void) {
    setter(val)
    if (val.trim().length >= 1) {
      const q = val.toLowerCase()
      const starts = BRAND_LIST.filter(b => b.toLowerCase().startsWith(q)).slice(0, 8)
      const contains = BRAND_LIST.filter(b => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q)).slice(0, 4)
      suggSetter([...starts, ...contains])
      showSetter(true)
    } else { suggSetter([]); showSetter(false) }
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async function createRow() {
    if (!user || !newBrand.trim()) { showToast('❌ Brand required', 'err'); return }
    setSaving(true)
    const markupVal = newMarkup === '__custom__' ? newMarkupCustom.trim() : newMarkup
    const { error } = await supabase.from('edit_sheet').insert({
      store: isAdmin ? newStore : user.store,
      brand: newBrand.trim(),
      order_num: newOrderNum.trim() || null,
      season: newSeason.trim() || season,
      markup: markupVal || null,
      markup_add: newMarkupAdd ? parseFloat(newMarkupAdd) : null,
      status: newStatus,
      note: newNote.trim() || null,
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
    const q = search.toLowerCase()
    return rows.filter(r => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (markupFilter === '__empty__') { if (r.markup && r.markup.trim()) return false }
      else if (markupFilter !== 'ALL' && r.markup !== markupFilter) return false
      if (!q) return true
      return (
        (r.brand || '').toLowerCase().includes(q) ||
        (r.order_num || '').toLowerCase().includes(q) ||
        (r.markup || '').toLowerCase().includes(q) ||
        (r.note || '').toLowerCase().includes(q)
      )
    })
  }, [rows, search, statusFilter, markupFilter])

  const emptyMarkupCount = useMemo(() => rows.filter(r => !r.markup || !r.markup.trim()).length, [rows])

  const brandsInUse = useMemo(() => Array.from(new Set(rows.map(r => r.brand))).sort(), [rows])
  const allSeasons  = buildSeasons(extraSeasons)
  const pendingCount   = rows.filter(r => r.status === 'Pending').length
  const completedCount = rows.filter(r => r.status === 'Edits Completed').length

  if (!user) return null

  const markupDisplay = (row: EditSheetRow) => {
    if (!row.markup) return '—'
    return row.markup_add ? `${row.markup} +${row.markup_add}` : row.markup
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fdf2f8', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        /* ── Season panel ── */
        .season-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 2000; }
        .season-panel {
          position: fixed; top: 0; left: 0; height: 100vh; width: 220px;
          background: #fff; color: #1f2937; display: flex; flex-direction: column;
          box-shadow: 4px 0 24px rgba(0,0,0,0.18); z-index: 2001;
          animation: slideInLeft 0.2s ease;
        }
        @keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .sp-head {
          padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;
          border-bottom: 1px solid #f3f4f6; background: ${accentD}; color: #fff;
        }
        .sp-row {
          padding: 10px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;
          font-size: 13px; transition: background 0.1s; border-bottom: 1px solid #f3f4f6; color: #374151;
        }
        .sp-row:hover { background: ${accentL} !important; }
        /* ── Header ── */
        .es-header {
          background: ${accentD}; color: #fff; padding: 10px 20px;
          display: flex; align-items: center; justify-content: space-between; gap: 12;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15); position: relative;
        }
        .es-header-title {
          position: absolute; left: 50%; transform: translateX(-50%);
          text-align: center; pointer-events: none;
        }
        .es-header-right { display: flex; gap: 8px; align-items: center; }
        /* ── Filters ── */
        .es-filters {
          display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
          max-width: 960px; margin: 0 auto; justify-content: center;
        }
        /* ── Table ── */
        .es-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .es-table th { background: ${accentL}; color: ${accentD}; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; padding: 9px 10px; text-align: left; border-bottom: 2px solid ${accentB}; }
        .es-table td { padding: 9px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
        .es-row { cursor: pointer; transition: background 0.1s; }
        .es-row:hover td { background: ${accentL} !important; }
        .es-badge { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 800; border: 1px solid; white-space: nowrap; }
        /* ── Modal ── */
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .modal-box { background: #fff; border-radius: 14px; width: 100%; max-width: 680px; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 8px 48px rgba(0,0,0,0.22); }
        .modal-head { padding: 14px 18px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .modal-body { overflow-y: auto; flex: 1; padding: 18px; }
        .modal-foot { padding: 12px 18px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
        /* ── History panel (right side) ── */
        .hist-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 320px; background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.12); z-index: 900; display: flex; flex-direction: column; animation: slideInRight 0.2s ease; }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        /* ── Mobile ── */
        @media (max-width: 600px) {
          .modal-bg { padding: 0; align-items: flex-end; }
          .modal-box { border-radius: 18px 18px 0 0 !important; max-width: 100% !important; }
          .es-header { flex-wrap: nowrap !important; }
          .es-header-title { position: static !important; transform: none !important; flex: 1; pointer-events: auto !important; }
          .es-header-right { display: none !important; }
          .es-filters { flex-direction: column !important; align-items: stretch !important; padding: 8px 12px !important; }
          .es-filters > * { width: 100% !important; max-width: none !important; flex: none !important; }
        }
      `}</style>

      {/* ── Season panel overlay ───────────────────────────────────────────── */}
      {showSeasonPanel && (
        <>
          <div className="season-overlay" onClick={() => setShowSeasonPanel(false)} />
          <div className="season-panel" onClick={e => e.stopPropagation()}>
            <div className="sp-head">
              <span style={{ fontWeight: 800, fontSize: 14 }}>Season</span>
              <button onClick={() => setShowSeasonPanel(false)}
                style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {allSeasons.map(s => (
                <div key={s} className="sp-row"
                  style={{ background: s === season ? accentL : '#fff', fontWeight: s === season ? 800 : 500, color: s === season ? accentD : '#374151' }}
                  onClick={() => { setSeason(s); setShowSeasonPanel(false) }}>
                  <span>{s}</span>
                  {s === season && <span style={{ fontSize: 11, color: accent }}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="es-header">
        {/* Left: hamburger + back */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowSeasonPanel(true)}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 16, cursor: 'pointer' }}
            title="Switch season">☰</button>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ← Home
          </button>
        </div>

        {/* Center: title */}
        <div className="es-header-title">
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '0.05em' }}>✏️ EDIT SHEET</div>
          <div style={{ fontSize: 10, opacity: 0.75, fontWeight: 500 }}>
            {season} · {pendingCount} pending · {completedCount} completed
          </div>
        </div>

        {/* Right: season badge + new */}
        <div className="es-header-right">
          <button onClick={() => setShowSeasonPanel(true)}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.05em' }}>
            {season}
          </button>
          <button onClick={() => setShowNew(true)}
            style={{ background: '#fff', color: accentD, border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            + New
          </button>
        </div>
      </div>

      {/* ── Filters bar ───────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${borderC}`, padding: '10px 20px' }}>
        <div className="es-filters">
          {/* Status filter */}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ ...inpMd, width: 170, flex: '0 0 auto', fontWeight: 700, cursor: 'pointer' }}>
            <option value="ALL">View All</option>
            <option value="Pending">View Pending</option>
            <option value="Edits Completed">View Edits Completed</option>
          </select>

          {/* Markup filter */}
          <select value={markupFilter} onChange={e => setMarkupFilter(e.target.value)}
            style={{ ...inpMd, width: 160, flex: '0 0 auto', cursor: 'pointer', fontWeight: markupFilter === '__empty__' ? 800 : undefined, color: markupFilter === '__empty__' ? '#dc2626' : undefined }}>
            <option value="ALL">All Markups</option>
            {MARKUP_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="__empty__">⚠ Empty{emptyMarkupCount > 0 ? ` (${emptyMarkupCount})` : ''}</option>
          </select>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: gray, fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            <input ref={brandRef} value={search}
              onChange={e => {
                setSearch(e.target.value)
                brandInput(e.target.value, setSearch, setBrandSuggs, setShowSugg)
              }}
              onFocus={() => search.trim() && setShowSugg(true)}
              placeholder="Search brand, order #, note…"
              style={{ ...inpMd, paddingLeft: 32, width: '100%' }} />
            {search && (
              <button onClick={() => { setSearch(''); setShowSugg(false) }}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: gray, cursor: 'pointer', fontSize: 15 }}>✕</button>
            )}
            {showSugg && brandSuggs.length > 0 && (
              <div ref={suggRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${accentB}`, borderRadius: 7, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto' }}>
                {brandSuggs.map(b => (
                  <div key={b} onMouseDown={e => { e.preventDefault(); setSearch(b); setShowSugg(false) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}
                    onMouseEnter={e => (e.currentTarget.style.background = accentL)}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Brand dropdown */}
          <select value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inpMd, width: 160, flex: '0 0 auto', cursor: 'pointer' }}>
            <option value="">All Brands</option>
            {brandsInUse.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <span style={{ fontSize: 12, color: gray }}>{filtered.length} row{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* ── Table card ────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', margin: '16px 16px 24px', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: gray }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: gray, fontSize: 13 }}>
            No entries for {season} — click <strong>+ New</strong> to add one.
          </div>
        ) : (
          <table className="es-table">
            <thead>
              <tr>
                {isAdmin && <th>Store</th>}
                <th>Brand</th>
                <th>Order #</th>
                <th>Markup</th>
                <th>Status</th>
                <th>PDFs</th>
                <th>Note</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <EditRow key={row.id} row={row} isAdmin={isAdmin} accent={accent} accentD={accentD} accentL={accentL} accentB={accentB} gray={gray} borderC={borderC} markupDisplay={markupDisplay} fmtTs={fmtTs} onEdit={openEdit} onHistory={openHistory} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── New Entry Modal ──────────────────────────────────────────────────── */}
      {showNew && (
        <div className="modal-bg">
          <div className="modal-box">
            <div className="modal-head">
              <span style={{ fontSize: 15, fontWeight: 800, color: accentD }}>+ New Edit Sheet Entry</span>
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
                {/* Brand with autocomplete */}
                <div style={{ position: 'relative' }}>
                  <label style={lbl}>Brand</label>
                  <input ref={newBrandRef} value={newBrand}
                    onChange={e => brandInput(e.target.value, setNewBrand, setNewBrandSuggs, setShowNewSugg)}
                    onFocus={() => newBrand.trim() && setShowNewSugg(true)}
                    placeholder="Brand name" style={inp} />
                  {showNewSugg && newBrandSuggs.length > 0 && (
                    <div ref={newSuggRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${accentB}`, borderRadius: 7, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto' }}>
                      {newBrandSuggs.map(b => (
                        <div key={b} onMouseDown={e => { e.preventDefault(); setNewBrand(b); setShowNewSugg(false) }}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}
                          onMouseEnter={e => (e.currentTarget.style.background = accentL)}
                          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                          {b}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={lbl}>Order #</label>
                  <input value={newOrderNum} onChange={e => setNewOrderNum(e.target.value)} placeholder="Order number" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Season</label>
                  <input value={newSeason} onChange={e => setNewSeason(e.target.value)} placeholder={season} style={inp} />
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
              <button onClick={createRow} disabled={saving}
                style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
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
                <div style={{ fontSize: 15, fontWeight: 800, color: accentD }}>{editRow.brand}</div>
                <div style={{ fontSize: 11, color: gray }}>{editRow.store} · {editRow.season || season}</div>
              </div>
              <button onClick={() => setEditRow(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Order #</label>
                <input value={editOrderNum} onChange={e => setEditOrderNum(e.target.value)} placeholder="Order number" style={inp} />
              </div>
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
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value as EditSheetRow['status'])} style={{ ...inp, cursor: 'pointer' }}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Note</label>
                <input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Optional note" style={inp} />
              </div>

              {/* PDF attachments */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: gray, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, borderBottom: `1.5px solid ${accentB}`, paddingBottom: 4 }}>
                  📎 PDF Edits
                </div>
                {(editRow.pdf_files || []).map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, background: accentL, border: `1px solid ${accentB}`, borderRadius: 6, padding: '6px 10px' }}>
                    <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: accentD, textDecoration: 'none', flex: 1 }}>
                      📄 {f.name}
                    </a>
                    <span style={{ fontSize: 10, color: gray }}>{fmtTs(f.uploaded_at)}</span>
                    <button onClick={() => removePDF(f.url)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                  </div>
                ))}
                <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={handlePDFUpload} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  style={{ background: accentL, color: accentD, border: `1.5px solid ${accentB}`, borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>
                  {uploading ? 'Uploading…' : '📎 Attach PDF Edit'}
                </button>
              </div>

              {editRow.season_book_id && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: accentL, border: `1px solid ${accentB}`, borderRadius: 7, fontSize: 11, color: accentD, fontWeight: 600 }}>
                  🔗 Linked to Season Book
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditRow(null)} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Dismiss</button>
              <button onClick={saveEdit} disabled={editSaving}
                style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
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
            <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${borderC}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: accentD, color: '#fff' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>History</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{historyBrand}</div>
              </div>
              <button onClick={() => setHistoryBrand(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#fff', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', color: gray, padding: 24 }}>Loading…</div>
              ) : historyRows.length === 0 ? (
                <div style={{ textAlign: 'center', color: gray, padding: 24, fontSize: 13 }}>No history found</div>
              ) : historyRows.map(r => {
                const sc = statusColor(r.status)
                return (
                  <div key={r.id} style={{ background: '#fff', border: `1px solid ${borderC}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: accentD }}>{r.store} · {r.season || '—'}</span>
                      <span style={{ fontSize: 10, color: gray }}>{fmtTs(r.created_at)}</span>
                    </div>
                    {r.order_num && <div style={{ fontSize: 11, color: gray, marginBottom: 4 }}>Order #: {r.order_num}</div>}
                    <div style={{ fontSize: 12, fontWeight: 700, color: accentD, marginBottom: 4 }}>{markupDisplay(r)}</div>
                    <span className="es-badge" style={{ background: sc.bg, color: sc.color, borderColor: sc.border }}>{r.status}</span>
                    {r.note && <div style={{ fontSize: 11, color: gray, marginTop: 6, fontStyle: 'italic' }}>{r.note}</div>}
                    {(r.pdf_files || []).length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(r.pdf_files || []).map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 10, color: accent, fontWeight: 600, background: accentL, border: `1px solid ${accentB}`, borderRadius: 4, padding: '1px 6px', textDecoration: 'none' }}>
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
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#831843', color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

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
  order_num: string | null      // season book order # (read-only reference)
  po_num: string | null         // PO # entered manually in Edit Sheet
  season: string | null
  markup: string | null
  markup_add: number | null
  status: 'Pending' | 'Items Created' | 'Edits Completed' // legacy — keep for reads
  edit_status: 'Pending' | 'Edits Completed' | null        // PDF edit workflow
  entry_status: 'Pending' | 'Items Created' | null         // PO entry workflow
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
const STATUS_OPTIONS: EditSheetRow['status'][] = ['Pending', 'Items Created', 'Edits Completed'] // legacy
const EDIT_STATUS_OPTIONS = ['Pending', 'Edits Completed'] as const
const ENTRY_STATUS_OPTIONS = ['Pending', 'Items Created'] as const

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

function statusColor(s: string | null | undefined) {
  if (s === 'Edits Completed') return { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' }
  if (s === 'Items Created')   return { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' }
  return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' }
}
function statusTextColor(s: string | null | undefined) {
  if (s === 'Edits Completed' || s === 'Items Created') return '#16a34a'
  return '#ca8a04'
}
const pillSt = (s: string | null | undefined): React.CSSProperties => {
  const c = statusColor(s)
  return { display: 'inline-block', padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800, border: `1px solid ${c.border}`, background: c.bg, color: c.color, whiteSpace: 'nowrap' as const }
}
// Small read-only info pill (store, order#, etc)
const infoPill: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' as const }


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
  const [newMarkup, setNewMarkup] = useState('')
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

  // Brand modal (bulk edit for a brand)
  const [brandModal, setBrandModal] = useState<string | null>(null) // brand name
  const [bmMarkup, setBmMarkup] = useState('')
  const [bmMarkupCustom, setBmMarkupCustom] = useState('')
  const [bmMarkupAdd, setBmMarkupAdd] = useState('')
  // per-row edits: id → { po_num, edit_status, entry_status, note }
  const [bmRows, setBmRows] = useState<Record<string, { po_num: string; edit_status: 'Pending' | 'Edits Completed'; entry_status: 'Pending' | 'Items Created'; note: string }>>({})
  const [bmSaving, setBmSaving] = useState(false)
  const [bmUploading, setBmUploading] = useState(false)
  const [bmUploadTarget, setBmUploadTarget] = useState<string | null>(null) // row id to attach PDF to

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
    setNewBrand(''); setNewOrderNum(''); setNewSeason(''); setNewMarkup('')
    setNewMarkupAdd(''); setNewMarkupCustom(''); setNewStatus('Pending'); setNewNote('')
    fetchRows()
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  function openEdit(row: EditSheetRow) {
    setEditRow(row)
    setEditMarkup(row.markup || '')
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
    setHistoryBrand(brand || 'All Brands')
    setHistoryLoading(true)
    let q = supabase.from('edit_sheet').select('*').order('created_at', { ascending: false })
    if (brand) q = q.ilike('brand', brand)
    const { data } = await q
    setHistoryLoading(false)
    setHistoryRows((data || []) as EditSheetRow[])
  }

  // ── Brand modal ───────────────────────────────────────────────────────────
  function openBrandModal(brand: string) {
    const brandRows = rows.filter(r => r.brand === brand)
    const firstMarkup = brandRows[0]?.markup || ''
    setBmMarkup(MARKUP_OPTIONS.includes(firstMarkup) ? firstMarkup : firstMarkup ? '__custom__' : '')
    setBmMarkupCustom(MARKUP_OPTIONS.includes(firstMarkup) || !firstMarkup ? '' : firstMarkup)
    setBmMarkupAdd(brandRows[0]?.markup_add?.toString() || '')
    const perRow: Record<string, { po_num: string; edit_status: 'Pending' | 'Edits Completed'; entry_status: 'Pending' | 'Items Created'; note: string }> = {}
    for (const r of brandRows) {
      perRow[r.id] = {
        po_num: r.po_num || '',
        edit_status: (r.edit_status as 'Pending' | 'Edits Completed') || 'Pending',
        entry_status: (r.entry_status as 'Pending' | 'Items Created') || (r.po_num ? 'Items Created' : 'Pending'),
        note: r.note || '',
      }
    }
    setBmRows(perRow)
    setBrandModal(brand)
  }

  async function saveBrandModal() {
    if (!brandModal) return
    setBmSaving(true)
    const markupVal = bmMarkup === '__custom__' ? bmMarkupCustom.trim() : bmMarkup
    const brandRows = rows.filter(r => r.brand === brandModal)

    // Save each row
    for (const r of brandRows) {
      const perRow = bmRows[r.id]
      if (!perRow) continue
      const poVal = perRow.po_num.trim()
      const { error } = await supabase.from('edit_sheet').update({
        markup: markupVal || null,
        markup_add: bmMarkupAdd ? parseFloat(bmMarkupAdd) : null,
        po_num: poVal || null,
        edit_status: perRow.edit_status,
        entry_status: perRow.entry_status,
        note: perRow.note.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq('id', r.id)
      if (error) { showToast('❌ ' + error.message, 'err'); setBmSaving(false); return }

      // Sync PO# to season_ledger and season_ss if linked
      if (r.season_book_id && poVal) {
        // Update season_ledger order_num
        await supabase.from('season_ledger').update({
          order_num: poVal,
          updated_at: new Date().toISOString(),
        }).eq('id', r.season_book_id)
        // Update season_ss and season_aw po_no (find rows linked to same season_book_id)
        await supabase.from('season_ss').update({ po_no: poVal }).eq('season_book_id', r.season_book_id)
        await supabase.from('season_aw').update({ po_no: poVal }).eq('season_book_id', r.season_book_id)
      }
    }

    setBmSaving(false)
    showToast('✅ Saved')
    setBrandModal(null)
    fetchRows()
  }

  async function bmUploadPDF(rowId: string, file: File) {
    setBmUploading(true)
    setBmUploadTarget(rowId)
    const ext = file.name.split('.').pop()
    const path = `es_${rowId}_${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('invoices').upload(path, file)
    if (upErr) { showToast('❌ Upload failed: ' + upErr.message, 'err'); setBmUploading(false); setBmUploadTarget(null); return }
    const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path)
    const newFile = { url: urlData.publicUrl, name: file.name, uploaded_at: new Date().toISOString() }
    const targetRow = rows.find(r => r.id === rowId)
    const updatedFiles = [...(targetRow?.pdf_files || []), newFile]
    await supabase.from('edit_sheet').update({ pdf_files: updatedFiles }).eq('id', rowId)
    setBmUploading(false)
    setBmUploadTarget(null)
    showToast('✅ PDF attached')
    fetchRows()
  }

  // ── Filtered table ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r => {
      if (statusFilter !== 'ALL' && (r.edit_status || 'Pending') !== statusFilter) return false
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
          position: sticky; top: 0; z-index: 100;
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
          <div style={{ fontSize: 19, fontWeight: 900, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 10 }}>
            ✏️ EDIT SHEET
            <span style={{ fontSize: 19, fontWeight: 900, opacity: 0.85, letterSpacing: '0.05em', background: 'rgba(249,168,212,0.3)', border: '1.5px solid #f9a8d4', borderRadius: 7, padding: '0px 10px' }}>{season}</span>
          </div>
        </div>

        {/* Right: season badge + new */}
        <div className="es-header-right">
          <button onClick={() => setShowSeasonPanel(true)}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.05em' }}>
            {season}
          </button>
          <button onClick={() => openHistory('')}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            History
          </button>
          <button onClick={() => setShowNew(true)}
            style={{ background: '#fff', color: accentD, border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            + New
          </button>
        </div>
      </div>

      {/* ── Filters bar ───────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${borderC}`, padding: '10px 20px', position: 'sticky', top: 53, zIndex: 99, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
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

      {/* ── Brand cards ───────────────────────────────────────────────────── */}
      <div style={{ padding: '16px', maxWidth: 820, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: gray }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: gray, fontSize: 13 }}>
            No entries for {season} — click <strong>+ New</strong> to add one.
          </div>
        ) : (() => {
          // Group rows by brand
          const brandOrder = Array.from(new Set(filtered.map(r => r.brand))).sort()
          return brandOrder.map(brand => {
            const brandRows = filtered.filter(r => r.brand === brand)
            const anyEmpty = brandRows.some(r => !r.markup || !r.markup.trim())
            const markup = brandRows[0]?.markup  // markup is brand-wide, same for all rows
            const emptyMarkup = !markup || !markup.trim()

            return (
              <div key={brand}
                style={{ background: '#fff', border: `2px solid ${anyEmpty ? '#fca5a5' : accentB}`, borderRadius: 10, marginBottom: 14, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>

                {/* Card header — click to open brand modal */}
                <div onClick={() => openBrandModal(brand)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: anyEmpty ? '#fef2f2' : accentL, borderBottom: `1px solid ${anyEmpty ? '#fecaca' : accentB}`, flexWrap: 'wrap', cursor: 'pointer' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: accentD, flex: 1 }}>{brand}</span>
                  {emptyMarkup
                    ? <span style={{ fontSize: 12, fontWeight: 800, color: '#dc2626', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '2px 10px' }}>⚠ Empty Markup</span>
                    : <span style={{ fontSize: 13, fontWeight: 800, color: accentD, background: '#fff', border: `1px solid ${accentB}`, borderRadius: 6, padding: '2px 10px' }}>{markupDisplay(brandRows[0])}</span>
                  }
                  <span style={{ fontSize: 11, color: gray }}>{brandRows.length} order{brandRows.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Orders table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <colgroup>
                    {isAdmin && <col style={{ width: '8%' }} />}{/* Store ID */}
                    <col style={{ width: '14%' }} />{/* Order # */}
                    <col style={{ width: '10%' }} />{/* PDF */}
                    <col style={{ width: '14%' }} />{/* Edit */}
                    <col style={{ width: '14%' }} />{/* PO # */}
                    <col style={{ width: '14%' }} />{/* Entry */}
                    <col />{/* Notes */}
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#f9f1f6', borderBottom: `1px solid ${accentB}` }}>
                      {isAdmin && <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Store ID</th>}
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Order #</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>PDF</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Edit</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>PO #</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Entry</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandRows.map((row, ri) => {
                      return (
                        <tr key={row.id}
                          onClick={() => openBrandModal(brand)}
                          style={{ borderBottom: ri < brandRows.length - 1 ? `1px solid ${borderC}` : 'none', cursor: 'pointer', background: ri % 2 === 0 ? '#fff' : '#fdf8fb' }}
                          onMouseEnter={e => (e.currentTarget.style.background = accentL)}
                          onMouseLeave={e => (e.currentTarget.style.background = ri % 2 === 0 ? '#fff' : '#fdf8fb')}>
                          {isAdmin && <td style={{ padding: '8px 12px', color: accent, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{row.store}</td>}
                          <td style={{ padding: '8px 12px', color: accent, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {row.order_num || '—'}
                            {row.season_book_id && <span style={{ marginLeft: 4, fontSize: 10, color: accent, fontWeight: 700 }}>🔗</span>}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {(row.pdf_files || []).length > 0 ? (
                              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {(row.pdf_files || []).map((f, i) => (
                                  <a key={i} href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                    style={{ fontSize: 10, color: accent, fontWeight: 600, textDecoration: 'none', background: '#fff', border: `1px solid ${accentB}`, borderRadius: 4, padding: '1px 6px' }}>
                                    📄 {f.name.length > 12 ? f.name.slice(0, 10) + '…' : f.name}
                                  </a>
                                ))}
                              </div>
                            ) : <span style={{ color: accent, fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', color: statusTextColor(row.edit_status || 'Pending') }}>
                            {row.edit_status || 'Pending'}
                          </td>
                          <td style={{ padding: '8px 12px', color: accent, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {row.po_num || <span style={{ color: accent, opacity: 0.4 }}>—</span>}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', color: statusTextColor(row.entry_status || (row.po_num ? 'Items Created' : 'Pending')) }}>
                            {row.entry_status || (row.po_num ? 'Items Created' : 'Pending')}
                          </td>
                          <td style={{ padding: '8px 12px', color: accent, fontSize: 12, fontStyle: row.note ? 'normal' : 'italic' }}>
                            {row.note || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })
        })()}
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
                      <option value="">— Select —</option>
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
                      <option value="">— Select —</option>
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

      {/* ── Brand Modal ─────────────────────────────────────────────────────── */}
      {brandModal && (() => {
        const bmBrandRows = rows.filter(r => r.brand === brandModal)
        const ttcRows = bmBrandRows.filter(r => r.store === 'TTC')
        const ttpRows = bmBrandRows.filter(r => r.store === 'TTP')
        const otherRows = bmBrandRows.filter(r => r.store !== 'TTC' && r.store !== 'TTP')
        const hasSplit = ttcRows.length > 0 || ttpRows.length > 0
        return (
          <div className="modal-bg">
            <div className="modal-box" style={{ maxWidth: hasSplit ? 860 : 640 }}>
              <div className="modal-head">
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: accentD }}>{brandModal}</div>
                  <div style={{ fontSize: 11, color: gray }}>{season} · {bmBrandRows.length} order{bmBrandRows.length !== 1 ? 's' : ''}</div>
                </div>
                <button onClick={() => setBrandModal(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: gray, cursor: 'pointer' }}>✕</button>
              </div>
              <div className="modal-body">

                {/* Markup — applies to all orders for this brand */}
                <div style={{ background: accentL, border: `1.5px solid ${accentB}`, borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: accentD, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>📐 Markup — applies to all orders</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 160 }}>
                      <select value={bmMarkup} onChange={e => setBmMarkup(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                        <option value="">— Select —</option>
                        {MARKUP_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                        <option value="__custom__">+ Custom…</option>
                      </select>
                      {bmMarkup === '__custom__' && (
                        <input value={bmMarkupCustom} onChange={e => setBmMarkupCustom(e.target.value)} placeholder="e.g. x2.7" style={{ ...inp, marginTop: 6 }} />
                      )}
                    </div>
                    <div style={{ width: 110 }}>
                      <input type="number" step="0.01" value={bmMarkupAdd} onChange={e => setBmMarkupAdd(e.target.value)}
                        placeholder="+ Add" style={inp} />
                      <div style={{ fontSize: 10, color: gray, marginTop: 3 }}>+ add to markup</div>
                    </div>
                  </div>
                </div>

                {/* Per-order rows — TTC | TTP split, or stacked for other stores */}
                <div style={{ fontSize: 11, fontWeight: 800, color: accentD, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>📋 Order Details</div>

                {hasSplit ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {(['TTC', 'TTP'] as const).map(store => {
                      const storeRows = store === 'TTC' ? ttcRows : ttpRows
                      return (
                        <div key={store}>
                          {/* Store column header */}
                          <div style={{ background: accentD, color: '#fff', borderRadius: '8px 8px 0 0', padding: '6px 12px', fontWeight: 800, fontSize: 13 }}>
                            {store} <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.8 }}>· {storeRows.length} order{storeRows.length !== 1 ? 's' : ''}</span>
                          </div>
                          <div style={{ border: `1px solid ${borderC}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: storeRows.length === 0 ? '20px 12px' : '10px 10px' }}>
                            {storeRows.length === 0
                              ? <div style={{ textAlign: 'center', color: gray, fontSize: 12 }}>No orders for {store}</div>
                              : storeRows.map(r => {
                                  const perRow = bmRows[r.id] || { po_num: '', edit_status: 'Pending' as const, entry_status: 'Pending' as const, note: '' }
                                  return (
                                    <div key={r.id} style={{ background: '#fff', border: `1px solid ${borderC}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                                      {/* Read-only info row */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                        {r.order_num && <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>Order # {r.order_num}</span>}
                                        {r.season_book_id && <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: '#fff', border: `1px solid ${accentB}`, borderRadius: 6, padding: '1px 7px' }}>🔗 Linked</span>}
                                      </div>
                                      {/* PO # + Entry Status */}
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                                        <div>
                                          <label style={lbl}>PO #{r.season_book_id && <span style={{ color: accent, fontSize: 9, fontWeight: 400 }}> → SB</span>}</label>
                                          <input value={perRow.po_num}
                                            onChange={e => { const val = e.target.value; setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], po_num: val, entry_status: val.trim() ? 'Items Created' : 'Pending' } })) }}
                                            placeholder="PO number" style={inp} />
                                        </div>
                                        <div>
                                          <label style={lbl}>Entry</label>
                                          <select value={perRow.entry_status}
                                            onChange={e => setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], entry_status: e.target.value as 'Pending' | 'Items Created' } }))}
                                            style={{ ...inp, cursor: 'pointer', fontSize: 12 }}>
                                            {ENTRY_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                      {/* Note */}
                                      <div style={{ marginBottom: 8 }}>
                                        <label style={lbl}>Note</label>
                                        <input value={perRow.note}
                                          onChange={e => setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], note: e.target.value } }))}
                                          placeholder="Optional note" style={inp} />
                                      </div>
                                      {/* PDFs + Edit Status */}
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: gray, marginBottom: 4 }}>📎 PDF Edits</div>
                                          {(r.pdf_files || []).length > 0 && (
                                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                                              {(r.pdf_files || []).map((f, i) => (
                                                <a key={i} href={f.url} target="_blank" rel="noreferrer"
                                                  style={{ fontSize: 10, color: accent, fontWeight: 600, textDecoration: 'none', background: accentL, border: `1px solid ${accentB}`, borderRadius: 4, padding: '1px 5px' }}>
                                                  📄 {f.name.length > 12 ? f.name.slice(0, 10) + '…' : f.name}
                                                </a>
                                              ))}
                                            </div>
                                          )}
                                          <label style={{ display: 'inline-block', background: accentL, color: accentD, border: `1px solid ${accentB}`, borderRadius: 5, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                                            {bmUploading && bmUploadTarget === r.id ? 'Uploading…' : '📎 Attach'}
                                            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
                                              onChange={e => { if (e.target.files?.[0]) bmUploadPDF(r.id, e.target.files[0]) }} />
                                          </label>
                                        </div>
                                        <div style={{ width: 130 }}>
                                          <label style={lbl}>Edit Status</label>
                                          <select value={perRow.edit_status}
                                            onChange={e => setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], edit_status: e.target.value as 'Pending' | 'Edits Completed' } }))}
                                            style={{ ...inp, cursor: 'pointer', fontSize: 11 }}>
                                            {EDIT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })
                            }
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {/* Other stores (not TTC/TTP) stacked normally */}
                {otherRows.map(r => {
                  const perRow = bmRows[r.id] || { po_num: '', edit_status: 'Pending' as const, entry_status: 'Pending' as const, note: '' }
                  return (
                    <div key={r.id} style={{ background: '#fff', border: `1px solid ${borderC}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>{r.store}</span>
                        {r.order_num && <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>Order # {r.order_num}</span>}
                        {r.season_book_id && <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: '#fff', border: `1px solid ${accentB}`, borderRadius: 6, padding: '1px 7px' }}>🔗 Linked</span>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '160px 160px', gap: 8, marginBottom: 8 }}>
                        <div>
                          <label style={lbl}>PO #{r.season_book_id && <span style={{ color: accent, fontSize: 9, fontWeight: 400 }}> → SB</span>}</label>
                          <input value={perRow.po_num}
                            onChange={e => { const val = e.target.value; setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], po_num: val, entry_status: val.trim() ? 'Items Created' : 'Pending' } })) }}
                            placeholder="PO number" style={inp} />
                        </div>
                        <div>
                          <label style={lbl}>Entry</label>
                          <select value={perRow.entry_status}
                            onChange={e => setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], entry_status: e.target.value as 'Pending' | 'Items Created' } }))}
                            style={{ ...inp, cursor: 'pointer', fontSize: 12 }}>
                            {ENTRY_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={lbl}>Note</label>
                        <input value={perRow.note}
                          onChange={e => setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], note: e.target.value } }))}
                          placeholder="Optional note" style={inp} />
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: gray, marginBottom: 4 }}>📎 PDF Edits</div>
                          {(r.pdf_files || []).length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
                              {(r.pdf_files || []).map((f, i) => (
                                <a key={i} href={f.url} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 10, color: accent, fontWeight: 600, textDecoration: 'none', background: accentL, border: `1px solid ${accentB}`, borderRadius: 4, padding: '1px 6px' }}>
                                  📄 {f.name.length > 14 ? f.name.slice(0, 12) + '…' : f.name}
                                </a>
                              ))}
                            </div>
                          )}
                          <label style={{ display: 'inline-block', background: accentL, color: accentD, border: `1px solid ${accentB}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            {bmUploading && bmUploadTarget === r.id ? 'Uploading…' : '📎 Attach PDF'}
                            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
                              onChange={e => { if (e.target.files?.[0]) bmUploadPDF(r.id, e.target.files[0]) }} />
                          </label>
                        </div>
                        <div style={{ width: 160 }}>
                          <label style={lbl}>Edit Status</label>
                          <select value={perRow.edit_status}
                            onChange={e => setBmRows(prev => ({ ...prev, [r.id]: { ...prev[r.id], edit_status: e.target.value as 'Pending' | 'Edits Completed' } }))}
                            style={{ ...inp, cursor: 'pointer', fontSize: 12 }}>
                            {EDIT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="modal-foot">
                <button onClick={() => setBrandModal(null)} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveBrandModal} disabled={bmSaving}
                  style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {bmSaving ? 'Saving…' : '✓ Save All'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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
                const editSc = statusColor(r.edit_status || 'Pending')
                const entrySc = statusColor(r.entry_status || 'Pending')
                return (
                  <div key={r.id} style={{ background: '#fff', border: `1px solid ${borderC}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                    {/* Brand + timestamp row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: accentD }}>{r.brand}</div>
                        <div style={{ fontSize: 11, color: accent, fontWeight: 700, marginTop: 1 }}>{r.store}{r.season ? ` · ${r.season}` : ''}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: gray }}>{fmtTs(r.created_at)}</div>
                        {r.created_by && <div style={{ fontSize: 10, fontWeight: 700, color: accent, marginTop: 1 }}>👤 {r.created_by}</div>}
                      </div>
                    </div>
                    {/* Order # + PO # */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                      {r.order_num && <span style={{ fontSize: 11, color: gray }}>Order #: <strong style={{ color: accentD }}>{r.order_num}</strong></span>}
                      {r.po_num && <span style={{ fontSize: 11, color: gray }}>PO #: <strong style={{ color: accentD }}>{r.po_num}</strong></span>}
                    </div>
                    {/* Markup */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: accentD, marginBottom: 6 }}>{markupDisplay(r)}</div>
                    {/* Statuses */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: r.note || (r.pdf_files || []).length > 0 ? 6 : 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, border: `1px solid ${editSc.border}`, background: editSc.bg, color: editSc.color }}>Edit: {r.edit_status || 'Pending'}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, border: `1px solid ${entrySc.border}`, background: entrySc.bg, color: entrySc.color }}>Entry: {r.entry_status || 'Pending'}</span>
                    </div>
                    {r.note && <div style={{ fontSize: 11, color: gray, fontStyle: 'italic' }}>{r.note}</div>}
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

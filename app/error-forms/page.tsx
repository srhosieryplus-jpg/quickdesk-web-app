'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'
import { BRAND_LIST } from '@/lib/brands'

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

// ── Types ────────────────────────────────────────────────────────────────────
type EFStatus = 'pending' | 'credit' | 'refund' | 'item_received' | 'invoice_fixed'

interface ErrorForm {
  id: string
  season: string
  store_id: string
  brand: string
  invoice_number: string | null
  amount: number | null
  email_sent: boolean
  error_date: string | null
  status: EFStatus
  comments: string | null
  final_date: string | null
  invoice_file_url: string | null
  error_file_url: string | null
  credit_note_url: string | null
  logged_by: string
  created_at: string
  updated_at: string
}

// ── Theme (red/coral for error forms) ────────────────────────────────────────
const red    = '#dc2626'
const redD   = '#991b1b'
const redL   = '#fef2f2'
const purple = '#7c3aed'
const purpleD = '#5b21b6'
const gray   = '#6b7280'
const border = '#e5e7eb'

const inp: React.CSSProperties = {
  background: '#fff', border: `1px solid #d1d5db`, borderRadius: 6,
  padding: '5px 8px', fontSize: 12, color: '#111', outline: 'none',
  fontFamily: 'Inter, sans-serif', width: '100%', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 3, display: 'block',
}

const STATUS_LABELS: Record<EFStatus, string> = {
  pending: 'Pending',
  credit: 'Credit',
  refund: 'Refund',
  item_received: 'Item Received',
  invoice_fixed: 'Invoice Fixed',
}
const STATUS_COLORS: Record<EFStatus, { bg: string; color: string; border: string }> = {
  pending:        { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  credit:         { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
  refund:         { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  item_received:  { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
  invoice_fixed:  { bg: '#dcfce7', color: '#166534', border: '#86efac' },
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function safeDate(d: string | null | undefined) {
  if (!d) return d
  return d.slice(0, 10) + 'T12:00:00'
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const s = iso.slice(0, 10)
  const [y, m, d] = s.split('-')
  return `${m}-${d}-${String(y).slice(2)}`
}
function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── File attachment sub-component ────────────────────────────────────────────
function FileAttach({
  label, url, bucket, path, onUpdated, disabled,
}: {
  label: string
  url: string | null
  bucket: string
  path: string
  onUpdated: (url: string | null) => void
  disabled?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const fullPath = `${path}.${ext}`
    const { error: upErr } = await supabase.storage.from(bucket).upload(fullPath, file, { upsert: true })
    if (upErr) { alert('❌ ' + upErr.message); setUploading(false); return }
    const { data } = supabase.storage.from(bucket).getPublicUrl(fullPath)
    setUploading(false)
    onUpdated(data.publicUrl)
    if (ref.current) ref.current.value = ''
  }

  async function remove() {
    if (!url) return
    const p = url.split(`/${bucket}/`).pop()
    if (p) await supabase.storage.from(bucket).remove([p])
    onUpdated(null)
  }

  if (url) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ fontSize: 11, color: purple, fontWeight: 700, textDecoration: 'none',
          background: '#ede9fe', border: `1px solid #c4b5fd`, borderRadius: 5, padding: '2px 8px' }}>
        📄 {label}
      </a>
      {!disabled && (
        <button onClick={remove}
          style={{ fontSize: 10, color: red, background: redL, border: `1px solid #fca5a5`,
            borderRadius: 5, padding: '2px 6px', cursor: 'pointer' }}>✕</button>
      )}
    </div>
  )

  if (disabled) return <span style={{ fontSize: 11, color: gray }}>—</span>

  return (
    <>
      <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={upload}
        style={{ display: 'none' }} id={`ef-${path}`} />
      <label htmlFor={`ef-${path}`}
        style={{ fontSize: 11, color: gray, background: '#f9fafb', border: `1px dashed #d1d5db`,
          borderRadius: 5, padding: '2px 8px', cursor: 'pointer', display: 'inline-block' }}>
        {uploading ? '⏳…' : `📎 ${label}`}
      </label>
    </>
  )
}

// ── Blank new form ────────────────────────────────────────────────────────────
function blankForm(season = 'SS27', store_id = ''): Omit<ErrorForm, 'id' | 'logged_by' | 'created_at' | 'updated_at'> {
  return {
    season, store_id, brand: '', invoice_number: null, amount: null, email_sent: false, error_date: today(),
    status: 'pending', comments: null, final_date: null,
    invoice_file_url: null, error_file_url: null, credit_note_url: null,
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ErrorFormsPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [forms, setForms] = useState<ErrorForm[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok'|'err'>('ok')

  // ── Store IDs — read from Supabase app_config (source of truth) ───────────
  const [storeIds, setStoreIds] = useState<string[]>([])
  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'store_ids').maybeSingle().then(({ data }) => {
      if (data?.value) {
        try {
          const parsed: string[] = JSON.parse(data.value)
          if (parsed.length > 0) { setStoreIds(parsed); return }
        } catch {}
      }
      // Fallback: localStorage
      try {
        const saved = localStorage.getItem('qd_stores')
        if (saved) {
          const parsed: string[] = JSON.parse(saved)
          if (parsed.length > 0) { setStoreIds(parsed); return }
        }
      } catch {}
      // Last resort: distinct stores from users table
      supabase.from('users').select('store').limit(1000).then(({ data: ud }) => {
        const fromUsers = ud
          ? Array.from(new Set(ud.map((r: { store: string }) => r.store).filter(s => s && s !== 'ALL'))).sort() as string[]
          : []
        // Merge with hardcoded defaults so all known stores always appear
        const defaults = ['PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']
        const merged = Array.from(new Set([...defaults, ...fromUsers])).sort()
        setStoreIds(merged)
      })
    })
  }, [])

  // ── Season state ──────────────────────────────────────────────────────────
  const [season, setSeason] = useState('SS27')
  const [extraSeasons, setExtraSeasons] = useState<string[]>([])
  const [showSeasonPanel, setShowSeasonPanel] = useState(false)
  const [showNewSeason, setShowNewSeason] = useState(false)
  const [newSeasonInput, setNewSeasonInput] = useState('')
  const allSeasons = buildSeasons(extraSeasons)
  const [seasonCounts, setSeasonCounts] = useState<Record<string, { open: number; closed: number }>>({})

  useEffect(() => {
    if (!showSeasonPanel) return
    supabase.from('error_forms').select('season, final_date').then(({ data }) => {
      if (!data) return
      const counts: Record<string, { open: number; closed: number }> = {}
      data.forEach(r => {
        if (!counts[r.season]) counts[r.season] = { open: 0, closed: 0 }
        if (r.final_date) counts[r.season].closed++
        else counts[r.season].open++
      })
      setSeasonCounts(counts)
    })
  }, [showSeasonPanel])

  // Filter state
  const [filterStatus, setFilterStatus] = useState<'all'|'open'|'finalized'>('open')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [search, setSearch] = useState('')

  // Modal
  const [modal, setModal] = useState<'none'|'new'|'edit'>('none')
  const [editForm, setEditForm] = useState<ErrorForm | null>(null)

  // Form state
  const [form, setForm] = useState(blankForm())
  const [brandInput, setBrandInput] = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<string[]>([])
  const [storeSearch, setStoreSearch] = useState('')
  const [showStoreDrop, setShowStoreDrop] = useState(false)

  // Right-click context menu
  type CtxMenu = { x: number; y: number; form: ErrorForm }
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [delPassword, setDelPassword] = useState('')
  const [showDelConfirm, setShowDelConfirm] = useState(false)

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3000)
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchForms = useCallback(async (s?: string) => {
    setLoading(true)
    let q = supabase
      .from('error_forms')
      .select('*')
      .eq('season', s ?? season)
      .order('created_at', { ascending: false })
    // Non-admin users only see their own store
    if (user && user.store !== 'ALL') {
      q = q.eq('store_id', user.store)
    }
    const { data, error } = await q
    if (error) { setToast('❌ ' + error.message); setToastType('err') }
    else setForms(data ?? [])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, user])

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const u = getSession()
    if (!u) { router.replace('/'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    if (user) fetchForms()
  }, [user, season, fetchForms])

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = forms.filter(f => {
    if (filterStatus === 'open' && f.final_date) return false
    if (filterStatus === 'finalized' && !f.final_date) return false
    if (filterBrand && f.brand !== filterBrand) return false
    if (filterStore && f.store_id !== filterStore) return false
    if (search) {
      const q = search.toLowerCase()
      if (!f.brand.toLowerCase().includes(q) &&
          !(f.comments ?? '').toLowerCase().includes(q) &&
          !(f.status).toLowerCase().includes(q) &&
          !f.store_id.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Create season ─────────────────────────────────────────────────────────
  async function createSeason() {
    const val = newSeasonInput.trim().toUpperCase()
    if (!val) return
    if (allSeasons.includes(val)) { showToast('Season already exists', 'err'); return }
    setExtraSeasons(prev => [...prev, val])
    setSeason(val)
    setNewSeasonInput('')
    setShowNewSeason(false)
    setShowSeasonPanel(false)
  }

  // ── Save new ──────────────────────────────────────────────────────────────
  async function saveNew() {
    if (!user) return
    if (!form.brand) { showToast('⚠️ Brand is required', 'err'); return }
    if (!form.store_id) { showToast('⚠️ Store is required', 'err'); return }
    setSaving(true)
    const { error } = await supabase.from('error_forms').insert({
      ...form,
      season,
      store_id: form.store_id,
      log_date: safeDate(today()),
      error_date: form.error_date ? safeDate(form.error_date) : null,
      final_date: form.final_date ? safeDate(form.final_date) : null,
      logged_by: user.userid,
    })
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
    showToast('✅ Error form created')
    setSaving(false)
    setModal('none')
    fetchForms()
  }

  // ── Save edit ─────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!editForm || !user) return
    setSaving(true)
    const { error } = await supabase.from('error_forms').update({
      brand: editForm.brand,
      store_id: editForm.store_id,
      amount: editForm.amount,
      email_sent: editForm.email_sent,
      error_date: editForm.error_date ? safeDate(editForm.error_date) : null,
      status: editForm.status,
      comments: editForm.comments,
      final_date: editForm.final_date ? safeDate(editForm.final_date) : null,
      invoice_number: editForm.invoice_number || null,
      invoice_file_url: editForm.invoice_file_url,
      error_file_url: editForm.error_file_url,
      credit_note_url: editForm.credit_note_url,
      updated_at: new Date().toISOString(),
    }).eq('id', editForm.id)
    if (error) { showToast('❌ ' + error.message, 'err'); setSaving(false); return }
    showToast('✅ Saved')
    setSaving(false)
    setModal('none')
    fetchForms()
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function deleteForm(id: string) {
    await supabase.from('error_forms').delete().eq('id', id)
    showToast('🗑 Deleted')
    fetchForms()
  }

  // ── Open edit modal ───────────────────────────────────────────────────────
  function openEdit(f: ErrorForm) {
    setEditForm({ ...f, error_date: f.error_date?.slice(0,10) ?? null, final_date: f.final_date?.slice(0,10) ?? null })
    setModal('edit')
  }

  // ── Open new modal ────────────────────────────────────────────────────────
  function openNew() {
    const defaultStore = user?.store !== 'ALL' ? (user?.store ?? '') : ''
    setForm(blankForm(season, defaultStore))
    setBrandInput('')
    setBrandSuggestions([])
    setModal('new')
  }

  const isAdmin = user?.store === 'ALL'

  if (!user) return null

  // ── Unique brands for filter ───────────────────────────────────────────────
  const brandsInUse = Array.from(new Set(forms.map(f => f.brand))).sort()

  // ── Counts ────────────────────────────────────────────────────────────────
  const openCount = forms.filter(f => !f.final_date).length
  const finalCount = forms.filter(f => !!f.final_date).length

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'Inter, sans-serif' }}>
      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          background: toastType === 'err' ? '#dc2626' : '#166534',
          color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* ── Season slide-out panel ── */}
      {showSeasonPanel && (
        <div className="season-overlay" onClick={() => setShowSeasonPanel(false)}>
          <div className="season-panel" onClick={e => e.stopPropagation()}>
            <div className="sp-head">
              <span style={{ fontWeight: 800, fontSize: 15 }}>Seasons</span>
              <button onClick={() => setShowSeasonPanel(false)}
                style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '0 16px 6px', borderBottom: `1px solid #f3f4f6` }}>
                <span style={{ fontSize: 10, color: '#b45309', background: '#fef3c7', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>Open</span>
                <span style={{ fontSize: 10, color: '#166534', background: '#dcfce7', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>Final</span>
              </div>
              {allSeasons.map(s => {
                const sc = seasonCounts[s]
                return (
                  <div key={s} className="sp-season-row"
                    style={{ background: s === season ? '#fef2f2' : 'transparent',
                      color: s === season ? redD : '#374151',
                      borderLeft: s === season ? `3px solid ${redD}` : '3px solid transparent' }}
                    onClick={() => { setSeason(s); setShowSeasonPanel(false) }}>
                    <span style={{ fontWeight: s === season ? 800 : 500 }}>{s}</span>
                    <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      {sc ? (
                        <>
                          <span title="Open" style={{ fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', borderRadius: 4, padding: '1px 5px' }}>{sc.open}</span>
                          <span title="Finalized" style={{ fontSize: 10, fontWeight: 700, color: '#166534', background: '#dcfce7', borderRadius: 4, padding: '1px 5px' }}>{sc.closed}</span>
                        </>
                      ) : (
                        <span style={{ fontSize: 10, color: '#d1d5db' }}>—</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${border}` }}>
              {!showNewSeason ? (
                <button onClick={() => setShowNewSeason(true)}
                  style={{ width: '100%', background: '#f9fafb', color: '#374151', border: `1px dashed #d1d5db`,
                    borderRadius: 7, padding: '7px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  + Add Season
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={newSeasonInput} onChange={e => setNewSeasonInput(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter') createSeason(); if (e.key === 'Escape') { setShowNewSeason(false); setNewSeasonInput('') } }}
                    placeholder="e.g. AW29" autoFocus maxLength={6}
                    style={{ flex: 1, background: '#fff', border: `1px solid #d1d5db`, borderRadius: 6,
                      padding: '5px 8px', fontSize: 12, color: '#111', outline: 'none', fontFamily: 'Inter, sans-serif' }} />
                  <button onClick={createSeason}
                    style={{ background: redD, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ background: redD, color: '#fff', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowSeasonPanel(true)}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 14, cursor: 'pointer' }}
            title="Switch season">
            ☰
          </button>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ← Home
          </button>
        </div>
        {/* Centered title */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '0.05em' }}>⚠ ERROR FORMS</div>
          <div style={{ fontSize: 10, opacity: 0.75, fontWeight: 500 }}>
            {season} · {openCount} open · {finalCount} finalized
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Season badge */}
          <button onClick={() => setShowSeasonPanel(true)}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.05em' }}>
            {season}
          </button>
          <button onClick={openNew}
            style={{ background: '#fff', color: redD, border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            + New
          </button>
        </div>
      </div>

      {/* ── Filters bar ── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '10px 20px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', maxWidth: 960, margin: '0 auto', justifyContent: 'center' }}>
          {/* Status dropdown — first */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all'|'open'|'finalized')}
            style={{ ...inp, width: 120, flex: '0 0 auto', fontWeight: 700 }}>
            <option value="open">Open</option>
            <option value="all">All</option>
            <option value="finalized">Finalized</option>
          </select>
          {/* Search — season-book style */}
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: gray, fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search brand, store, comments…"
              style={{ ...inp, paddingLeft: 28, width: '100%' }} />
            {search && (
              <button onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: gray, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
            )}
          </div>
          <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
            style={{ ...inp, width: 150, flex: '0 0 auto' }}>
            <option value="">All Brands</option>
            {brandsInUse.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {isAdmin && (
            <select value={filterStore} onChange={e => setFilterStore(e.target.value)}
              style={{ ...inp, width: 120, flex: '0 0 auto' }}>
              <option value="">All Stores</option>
              {Array.from(new Set(forms.map(f => f.store_id))).filter(Boolean).sort().map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {(filterBrand || filterStore) && (
            <button onClick={() => { setFilterBrand(''); setFilterStore('') }}
              style={{ fontSize: 11, color: gray, background: '#f3f4f6', border: `1px solid ${border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
              Clear
            </button>
          )}
          <span style={{ fontSize: 11, color: gray }}>
            {filtered.length} form{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Right-click context menu ── */}
      {ctxMenu && (
        <div style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 3000,
          background: '#fff', border: `1px solid ${border}`, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 140, overflow: 'hidden' }}
          onMouseLeave={() => { setCtxMenu(null); setShowDelConfirm(false); setDelPassword('') }}>
          <div onClick={() => { openEdit(ctxMenu.form); setCtxMenu(null) }}
            style={{ padding: '10px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, color: '#374151',
              borderBottom: `1px solid ${border}` }}
            onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
            ✏️ Edit
          </div>
          {!showDelConfirm ? (
            <div onClick={() => setShowDelConfirm(true)}
              style={{ padding: '10px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, color: red }}
              onMouseEnter={e => e.currentTarget.style.background = redL}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
              🗑 Delete
            </div>
          ) : (
            <div style={{ padding: '10px 12px', borderTop: `1px solid ${border}` }}>
              <div style={{ fontSize: 11, color: gray, marginBottom: 6 }}>Enter password to delete</div>
              <input type="password" value={delPassword} onChange={e => setDelPassword(e.target.value)}
                placeholder="Password" autoFocus
                style={{ ...inp, marginBottom: 6 }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (delPassword === 'delete') { deleteForm(ctxMenu.form.id); setCtxMenu(null); setShowDelConfirm(false); setDelPassword('') }
                    else { showToast('❌ Wrong password', 'err') }
                  }
                  if (e.key === 'Escape') { setCtxMenu(null); setShowDelConfirm(false); setDelPassword('') }
                }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setShowDelConfirm(false); setDelPassword('') }}
                  style={{ flex: 1, background: '#e5e7eb', border: 'none', borderRadius: 5, padding: '4px 0', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => {
                  if (delPassword === 'delete') { deleteForm(ctxMenu.form.id); setCtxMenu(null); setShowDelConfirm(false); setDelPassword('') }
                  else showToast('❌ Wrong password', 'err')
                }}
                  style={{ flex: 1, background: redD, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ padding: '16px 24px', overflowX: 'auto' }}
        onClick={() => { if (ctxMenu) { setCtxMenu(null); setShowDelConfirm(false); setDelPassword('') } }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: gray, padding: 40, fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: gray, padding: 40, fontSize: 13 }}>
            {filterStatus === 'open' ? 'No open error forms.' : 'No forms found.'}
          </div>
        ) : (
          <table style={{ width: '100%', maxWidth: 960, margin: '0 auto', borderCollapse: 'collapse', fontSize: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', borderRadius: 10, overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: redD, color: '#fff' }}>
                <th style={th}>Store</th>
                <th style={th}>Brand</th>
                <th style={th}>Amount</th>
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                <th style={th}>Email</th>
                <th style={th}>Invoice</th>
                <th style={th}>Error Form</th>
                <th style={th}>Credit Note</th>
                <th style={th}>Comments</th>
                <th style={th}>Finalized</th>
                <th style={th}>By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => {
                const sc = STATUS_COLORS[f.status]
                const isFinalized = !!f.final_date
                const isResolved = f.status !== 'pending'
                const rowBg = isFinalized ? '#f0fdf4' : isResolved ? '#f0fdf4' : (i % 2 === 0 ? '#fff' : '#fafafa')
                return (
                  <tr key={f.id}
                    style={{ background: rowBg, borderBottom: `1px solid ${border}` }}
                    onClick={() => openEdit(f)}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, form: f }); setShowDelConfirm(false); setDelPassword('') }}
                    className="ef-row">
                    <td style={{ ...td, color: '#1d4ed8', fontWeight: 700 }}>
                      {f.store_id || '—'}
                    </td>
                    <td style={td}><span style={{ fontWeight: 700, color: redD }}>{f.brand}</span></td>
                    <td style={td}>{f.amount != null ? fmt$(f.amount) : '—'}</td>
                    <td style={td}>{fmtDate(f.error_date)}</td>
                    <td style={{ ...td, color: sc.color, fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[f.status]}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {f.email_sent ? <span style={{ color: '#166534', fontWeight: 700 }}>✓</span> : <span style={{ color: gray }}>—</span>}
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      {f.invoice_file_url
                        ? <a href={f.invoice_file_url} target="_blank" rel="noopener noreferrer" style={{ color: purple, fontWeight: 700, fontSize: 11 }}>📄 View</a>
                        : <span style={{ color: gray }}>—</span>}
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      {f.error_file_url
                        ? <a href={f.error_file_url} target="_blank" rel="noopener noreferrer" style={{ color: purple, fontWeight: 700, fontSize: 11 }}>📄 View</a>
                        : <span style={{ color: gray }}>—</span>}
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      {f.credit_note_url
                        ? <a href={f.credit_note_url} target="_blank" rel="noopener noreferrer" style={{ color: purple, fontWeight: 700, fontSize: 11 }}>📄 View</a>
                        : <span style={{ color: gray }}>—</span>}
                    </td>
                    <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: gray }}>
                      {f.comments ?? '—'}
                    </td>
                    <td style={td}>
                      {isFinalized
                        ? <span style={{ color: '#166534', fontWeight: 700 }}>{fmtDate(f.final_date)}</span>
                        : <span style={{ color: '#b45309', fontWeight: 600 }}>Open</span>}
                    </td>
                    <td style={td}>{displayUser(f.logged_by)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── New / Edit Modal ── */}
      {(modal === 'new' || modal === 'edit') && (() => {
        const isEdit = modal === 'edit'
        const ef = isEdit ? editForm! : null
        function upd(patch: Partial<typeof form>) {
          if (isEdit) setEditForm(prev => prev ? { ...prev, ...patch } : prev)
          else setForm(prev => ({ ...prev, ...patch }))
        }
        const vals = isEdit ? editForm! : form
        const fileBase = isEdit ? ef!.id : 'new-' + Date.now()

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              {/* Modal header */}
              <div style={{ background: redD, color: '#fff', padding: '14px 20px', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{isEdit ? `Edit — ${ef!.brand}` : '+ New Error Form'}</div>
                  {isEdit && <div style={{ fontSize: 10, opacity: 0.75 }}>{ef!.store_id} · by {displayUser(ef!.logged_by)}</div>}
                </div>
                <button onClick={() => setModal('none')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>

              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Row 0: Store */}
                <div>
                  <label style={lbl}>Store ID *</label>
                  {(!isAdmin && modal === 'edit') ? (
                    <div style={{ ...inp, width: 220, background: '#f9fafb', color: gray }}>{vals.store_id || '—'}</div>
                  ) : (() => {
                    const filteredStores = storeIds.filter(s =>
                      !storeSearch || s.toLowerCase().includes(storeSearch.toLowerCase())
                    )
                    return (
                      <div style={{ position: 'relative', width: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${vals.store_id ? redD : '#d1d5db'}`,
                          borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
                          <input
                            value={showStoreDrop ? storeSearch : (vals.store_id || '')}
                            onChange={e => { setStoreSearch(e.target.value); setShowStoreDrop(true); if (!e.target.value) upd({ store_id: '' }) }}
                            onFocus={() => { setStoreSearch(''); setShowStoreDrop(true) }}
                            onBlur={() => setTimeout(() => setShowStoreDrop(false), 150)}
                            placeholder="Search store…"
                            style={{ flex: 1, border: 'none', outline: 'none', padding: '5px 8px', fontSize: 12,
                              fontFamily: 'Inter, sans-serif', color: '#111', background: 'transparent' }}
                          />
                          {vals.store_id && (
                            <button onClick={() => { upd({ store_id: '' }); setStoreSearch('') }}
                              style={{ background: 'none', border: 'none', color: gray, cursor: 'pointer', padding: '0 6px', fontSize: 14, lineHeight: 1 }}>✕</button>
                          )}
                        </div>
                        {showStoreDrop && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
                            border: `1px solid ${border}`, borderRadius: 6, zIndex: 20,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                            {filteredStores.length === 0 ? (
                              <div style={{ padding: '8px 12px', fontSize: 12, color: gray }}>No stores found</div>
                            ) : filteredStores.map(s => (
                              <div key={s}
                                onMouseDown={() => { upd({ store_id: s }); setStoreSearch(''); setShowStoreDrop(false) }}
                                style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                                  background: vals.store_id === s ? '#fef2f2' : '#fff',
                                  color: vals.store_id === s ? redD : '#111',
                                  fontWeight: vals.store_id === s ? 700 : 400,
                                  borderBottom: `1px solid #f3f4f6` }}
                                onMouseEnter={e => { if (vals.store_id !== s) e.currentTarget.style.background = '#f9fafb' }}
                                onMouseLeave={e => { if (vals.store_id !== s) e.currentTarget.style.background = '#fff' }}>
                                {s}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {!isAdmin && modal === 'new' && (
                    <div style={{ fontSize: 10, color: gray, marginTop: 2 }}>Defaults to your store</div>
                  )}
                </div>

                {/* Row 1: Brand + Amount + Date */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
                  <div style={{ position: 'relative' }}>
                    <label style={lbl}>Brand *</label>
                    <input value={isEdit ? vals.brand : brandInput}
                      onChange={e => {
                        const v = e.target.value
                        if (isEdit) upd({ brand: v })
                        else {
                          setBrandInput(v)
                          upd({ brand: v })
                          setBrandSuggestions(v.length > 0 ? BRAND_LIST.filter(b => b.toLowerCase().includes(v.toLowerCase())).slice(0, 8) : [])
                        }
                      }}
                      placeholder="Type brand name…"
                      style={inp} autoFocus={!isEdit} />
                    {!isEdit && brandSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
                        border: `1px solid ${border}`, borderRadius: 6, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 180, overflowY: 'auto' }}>
                        {brandSuggestions.map(b => (
                          <div key={b} onClick={() => { setBrandInput(b); upd({ brand: b }); setBrandSuggestions([]) }}
                            style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid #f3f4f6` }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                            {b}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={lbl}>Invoice #</label>
                    <input value={vals.invoice_number ?? ''} onChange={e => upd({ invoice_number: e.target.value || null })} placeholder="Optional" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Amount ($)</label>
                    <input type="number" step="0.01" value={vals.amount ?? ''} onChange={e => upd({ amount: e.target.value ? parseFloat(e.target.value) : null })} placeholder="0.00" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Error Date</label>
                    <input type="date" value={vals.error_date ?? ''} onChange={e => upd({ error_date: e.target.value })} style={inp} />
                  </div>
                </div>

                {/* Row 2: Status + Email Sent */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Resolution Status</label>
                    <select value={vals.status} onChange={e => upd({ status: e.target.value as EFStatus })} style={inp}>
                      <option value="pending">Pending</option>
                      <option value="credit">Credit</option>
                      <option value="refund">Refund</option>
                      <option value="item_received">Item Received</option>
                      <option value="invoice_fixed">Invoice Fixed</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={vals.email_sent} onChange={e => upd({ email_sent: e.target.checked })}
                        style={{ width: 16, height: 16, accentColor: redD }} />
                      Email Sent
                    </label>
                  </div>
                </div>

                {/* Row 3: Final date */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Final Date (Finalized)</label>
                    <input type="date" value={vals.final_date ?? ''} onChange={e => upd({ final_date: e.target.value || null })} style={inp} />
                    <div style={{ fontSize: 10, color: gray, marginTop: 2 }}>Set a date to mark as finalized</div>
                  </div>
                </div>

                {/* Row 4: Comments */}
                <div>
                  <label style={lbl}>Comments</label>
                  <textarea value={vals.comments ?? ''} onChange={e => upd({ comments: e.target.value || null })}
                    placeholder="Add any notes…" rows={2}
                    style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
                </div>

                {/* Row 5: Attachments */}
                <div style={{ background: '#f9fafb', border: `1px solid ${border}`, borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10 }}>📎 Attachments</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                    {[
                      { label: 'Invoice', key: 'invoice_file_url' as const, slot: 'inv' },
                      { label: 'Error Form', key: 'error_file_url' as const, slot: 'err' },
                      { label: 'Credit Note', key: 'credit_note_url' as const, slot: 'cn1' },
                    ].map(({ label, key, slot }) => (
                      <div key={key} style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: gray, marginBottom: 5 }}>{label}</div>
                        {isEdit ? (
                          <FileAttach
                            label={label} url={vals[key] as string | null}
                            bucket="invoices" path={`ef-${fileBase}-${slot}`}
                            onUpdated={async url => {
                              upd({ [key]: url } as any)
                              if (isEdit) {
                                await supabase.from('error_forms').update({ [key]: url }).eq('id', ef!.id)
                                showToast(url ? '📎 Attached' : '🗑 Removed')
                              }
                            }}
                          />
                        ) : (
                          <FileAttach
                            label={label} url={vals[key] as string | null}
                            bucket="invoices" path={`ef-${fileBase}-${slot}`}
                            onUpdated={url => upd({ [key]: url } as any)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                  <button onClick={() => setModal('none')} disabled={saving}
                    style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  {isEdit && isAdmin && (
                    <button onClick={() => { deleteForm(ef!.id); setModal('none') }}
                      style={{ background: redL, color: red, border: `1px solid #fca5a5`, borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Delete
                    </button>
                  )}
                  <button onClick={isEdit ? saveEdit : saveNew} disabled={saving}
                    style={{ background: redD, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Form'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      <style>{`
        .ef-row { cursor: pointer; transition: background 0.1s; }
        .ef-row:hover { background: #fef2f2 !important; }
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
          border-bottom: 1px solid #f3f4f6; background: ${redD}; color: #fff;
        }
        .sp-season-row {
          padding: 10px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;
          font-size: 13px; transition: background 0.1s; border-bottom: 1px solid #f3f4f6; color: #374151;
        }
        .sp-season-row:hover { background: #fef2f2 !important; }
        @media (max-width: 768px) {
          table { font-size: 11px; }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11,
  whiteSpace: 'nowrap', letterSpacing: '0.03em',
}
const td: React.CSSProperties = {
  padding: '8px 10px', verticalAlign: 'middle', fontSize: 12,
}

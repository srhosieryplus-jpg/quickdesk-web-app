'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const STORES = ['PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']

interface ICEntry {
  id: string
  store: string
  userid: string
  order_num: string
  status: 'Pending' | 'Pushed In'
  po_num: string
  qty_pushed: number
  note: string
  in_push_log: boolean
  note_pushed: boolean
  saved_at: string
  pushed_at: string | null
}

interface AutoCSVRow {
  id: string
  invoice_num: string
  po_num: string
  store: string
  qty_total: number
  exported_at: string
}

const purple = '#7c3aed'
const purpleD = '#6d28d9'
const border = '#d4c8f0'
const purpleLight = '#f5f3ff'

export default function ICLogPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [entries, setEntries] = useState<ICEntry[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok'|'err'>('ok')

  // Add form
  const [newStore, setNewStore] = useState('')
  const [newOrder, setNewOrder] = useState('')
  const [newNote, setNewNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ICEntry | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [attachModal, setAttachModal] = useState<{ entry: ICEntry } | null>(null)
  const [attachSearch, setAttachSearch] = useState('')
  const [attachRows, setAttachRows] = useState<AutoCSVRow[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [attachSaving, setAttachSaving] = useState(false)
  const [pullY, setPullY] = useState(0)
  const [pulling, setPulling] = useState(false)
  const touchStartY = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  const fetchEntries = useCallback(async (user?: User): Promise<ICEntry[]> => {
    const u = user || currentUser
    if (!u) return []
    setLoading(true)
    let query = supabase.from('ic_log').select('*').order('saved_at', { ascending: false })
    if (u.store && u.store !== 'ALL') query = query.eq('store', u.store)
    const { data, error } = await query
    if (error) { showToast('❌ Could not load entries', 'err'); setLoading(false); return [] }
    const result = (data || []) as ICEntry[]
    setEntries(result)
    setLoading(false)
    return result
  }, [currentUser])

  // Auto-match: check autocsv_log for any pending entries
  const autoMatch = useCallback(async (entriesList: ICEntry[]) => {
    const pending = entriesList.filter(e => e.status === 'Pending')
    if (!pending.length) return

    const orderNums = pending.map(e => e.order_num)
    let didUpdate = false

    // 1) Try matching order_num against invoice_num (exact match, any time)
    const { data: invoiceMatches, error: invErr } = await supabase
      .from('autocsv_log')
      .select('*')
      .in('invoice_num', orderNums)

    console.log('[autoMatch] pending order_nums:', orderNums)
    console.log('[autoMatch] invoice matches:', invoiceMatches, invErr)

    const matchedEntryIds = new Set<string>()

    for (const match of invoiceMatches || []) {
      const entry = pending.find(e => e.order_num === match.invoice_num)
      if (!entry) continue
      await supabase.from('ic_log').update({
        status: 'Pushed In',
        po_num: match.po_num || '',
        qty_pushed: match.qty_total || 0,
        in_push_log: true,
        note_pushed: true,
        pushed_at: match.exported_at || null,
      }).eq('id', entry.id)
      matchedEntryIds.add(entry.id)
      didUpdate = true
    }

    // 2) For still-unmatched entries, try matching order_num against po_num
    const stillPending = pending.filter(e => !matchedEntryIds.has(e.id))
    if (stillPending.length) {
      const { data: poMatches, error: poErr } = await supabase
        .from('autocsv_log')
        .select('*')
        .in('po_num', stillPending.map(e => e.order_num))
      console.log('[autoMatch] still-pending order_nums:', stillPending.map(e => e.order_num))
      console.log('[autoMatch] PO matches:', poMatches, poErr)

      for (const match of poMatches || []) {
        const entry = stillPending.find(e => e.order_num === match.po_num)
        if (!entry) continue
        await supabase.from('ic_log').update({
          status: 'Pushed In',
          po_num: match.po_num || '',
          qty_pushed: match.qty_total || 0,
          in_push_log: true,
          note_pushed: true,
          pushed_at: match.exported_at || null,
        }).eq('id', entry.id)
        didUpdate = true
      }
    }

    if (didUpdate) fetchEntries()
  }, [currentUser, fetchEntries])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    setNewStore(u.store !== 'ALL' ? u.store : 'PO')
    fetchEntries(u).then(loaded => {
      if (loaded && loaded.length) autoMatch(loaded)
    })
  }, [router])

  // ── return to selector after idle; re-check matches on tab focus ─────────
  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) {
          router.push('/selector')
        } else {
          // Tab came back — re-fetch and re-run auto-match so any
          // pushes that happened while away are picked up immediately
          fetchEntries().then(refreshed => {
            if (refreshed && refreshed.length) autoMatch(refreshed)
          })
        }
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [router, fetchEntries, autoMatch])

  // Run auto-match whenever the entries list itself changes (not just its length)
  const prevEntriesRef = useRef<string>('')
  useEffect(() => {
    const key = entries.map(e => e.id + e.status).join(',')
    if (key !== prevEntriesRef.current) {
      prevEntriesRef.current = key
      const pending = entries.filter(e => e.status === 'Pending')
      if (pending.length) autoMatch(entries)
    }
  }, [entries])

  async function addEntry(e: React.FormEvent) {
    e.preventDefault()
    const order = newOrder.trim()
    if (!order) { showToast('❌ Invoice # required', 'err'); return }
    if (!newStore) { showToast('❌ StoreID required', 'err'); return }
    setAdding(true)
    const payload = {
      store: newStore,
      userid: currentUser?.userid || '',
      order_num: order,
      note: newNote.trim(),
      status: 'Pending',
      po_num: '',
      qty_pushed: 0,
      in_push_log: false,
      note_pushed: false,
    }
    const { error } = await supabase.from('ic_log').insert(payload)
    if (error) { showToast(`❌ ${error.message || error.code || 'Insert failed'}`, 'err'); setAdding(false); return }
    setNewOrder(''); setNewNote('')
    setAdding(false)
    setShowAddModal(false)
    showToast('✅ Order logged')
    fetchEntries()
  }

  async function refresh() {
    setSaving(true)
    const refreshed = await fetchEntries()
    if (refreshed.length) await autoMatch(refreshed)
    setSaving(false)
    showToast('🔄 Refreshed')
  }

  async function deleteEntry(id: string) {
    const pw = prompt('Enter password to delete:')
    if (pw === null) return
    if (pw.toLowerCase() !== 'delete') { showToast('❌ Incorrect password', 'err'); return }
    await supabase.from('ic_log').delete().eq('id', id)
    setEntries(prev => prev.filter(e => e.id !== id))
    setContextMenu(null)
    showToast('🗑 Deleted')
  }

  function openEdit(id: string) {
    const entry = entries.find(e => e.id === id)
    if (!entry) return
    setEditingEntry(entry)
    setContextMenu(null)
  }

  async function openAttach(id: string) {
    const entry = entries.find(e => e.id === id)
    if (!entry) return
    setContextMenu(null)
    setAttachSearch('')
    setAttachRows([])
    setAttachModal({ entry })
    setAttachLoading(true)
    // Load recent autocsv_log rows for this store (last 60 days)
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('autocsv_log')
      .select('id, invoice_num, po_num, store, qty_total, exported_at')
      .eq('store', entry.store)
      .gte('exported_at', since)
      .order('exported_at', { ascending: false })
      .limit(200)
    setAttachRows((data || []) as AutoCSVRow[])
    setAttachLoading(false)
  }

  async function doAttach(row: AutoCSVRow) {
    if (!attachModal) return
    setAttachSaving(true)
    const { error } = await supabase.from('ic_log').update({
      status: 'Pushed In',
      po_num: row.po_num || '',
      qty_pushed: row.qty_total || 0,
      in_push_log: true,
      note_pushed: true,
      pushed_at: row.exported_at || null,
    }).eq('id', attachModal.entry.id)
    setAttachSaving(false)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setAttachModal(null)
    showToast('✅ Attached — entry marked Pushed In')
    fetchEntries()
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingEntry) return
    setAdding(true)
    const { error } = await supabase.from('ic_log').update({
      store: editingEntry.store,
      order_num: editingEntry.order_num,
      note: editingEntry.note,
    }).eq('id', editingEntry.id)
    setAdding(false)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setEditingEntry(null)
    showToast('✅ Updated')
    fetchEntries()
  }

  async function markPushedIn(id: string) {
    setContextMenu(null)
    const { error } = await supabase.from('ic_log').update({
      status: 'Pushed In',
      in_push_log: true,
    }).eq('id', id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    showToast('✅ Marked as Pushed In')
    fetchEntries()
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, id })
  }

  const filtered = entries.filter(e => {
    const q = filter.toLowerCase()
    return !q || e.store.toLowerCase().includes(q) || e.order_num.toLowerCase().includes(q) ||
      e.note.toLowerCase().includes(q) || e.userid.toLowerCase().includes(q) ||
      e.po_num.toLowerCase().includes(q) || (e.saved_at || '').includes(q)
  })

  function formatDate(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${String(d.getFullYear()).slice(2)} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  }

  const tdBase: React.CSSProperties = { padding: '3px 7px', fontSize: 11, verticalAlign: 'middle', borderBottom: '1px solid #e5e7eb' }

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .iclog-header { padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); }
        .iclog-center { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; pointer-events: none; }
        .iclog-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
        .iclog-store-inv { display: flex; align-items: center; gap: 6px; }
        .iclog-refresh { display: inline-block; }
        @media (max-width: 600px) {
          .iclog-center { order: 3; width: 100%; }
          .iclog-form { gap: 6px; }
          .iclog-form input, .iclog-form select { width: 100% !important; }
          .iclog-store-inv { width: 100%; }
          .iclog-refresh { display: none !important; }
        }
        .ic-table { border-collapse: collapse; font-size: 12px; width: 100%; }
        .ic-table th { padding: 7px 10px; text-align: left; font-size: 11px; font-weight: 700; color: #1e3a8a; background: #dbeafe; border-bottom: 2px solid #93c5fd; white-space: nowrap; }
        .ic-table td { padding: 5px 10px; font-size: 12px; vertical-align: middle; border-bottom: 1px solid #e5e7eb; }
        .ic-table-wrap { display: block; }
        .ic-cards { display: none; }
        .iclog-order-label { display: inline; }
        @media (max-width: 600px) {
          .ic-table-wrap { display: none; }
          .ic-cards { display: block; padding: 8px 12px; overflow-y: auto; }
          .iclog-order-label { display: none; }
        }
        @media (min-width: 601px) and (max-width: 700px) {
          .ic-table th, .ic-table td { padding: 4px 6px; font-size: 11px; }
          .ic-col-hide { display: none; }
        }
      `}</style>

      {/* Header */}
      <div className="iclog-header">
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>
            ← Home
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{currentUser?.userid}</span>
            {currentUser?.store ? <> · {currentUser.store === 'ALL' ? 'All Stores' : currentUser.store}</> : ''}
          </span>
        </div>

        {/* Center */}
        <div className="iclog-center">
          <span style={{ fontSize: 18, color: purple }}>∞</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>INFINITY CLASSICS</span>
          <span className="iclog-order-label" style={{ color: '#c4b5fd', fontSize: 13 }}>— Order Log</span>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={refresh} disabled={saving} className="iclog-refresh"
            style={{ background: '#dcfce7', border: 'none', color: '#166534', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? '…' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Add form */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', justifyContent: 'center' }}>
        <form onSubmit={addEntry} style={{ width: '100%', maxWidth: 900, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ ...labelSt, color: purpleD }}>StoreID:</label>
          <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inputSt, width: 80 }}>
            {STORES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={{ ...labelSt, color: purpleD }}>Invoice #:</label>
          <input value={newOrder} onChange={e => setNewOrder(e.target.value)}
            placeholder="e.g. 2976440" style={{ ...inputSt, width: 120 }} />
          <label style={{ ...labelSt, color: purpleD }}>Note:</label>
          <input value={newNote} onChange={e => setNewNote(e.target.value)}
            placeholder="optional…" style={{ ...inputSt, flex: 1, minWidth: 100 }} />
          <button type="submit" disabled={adding}
            style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {adding ? '…' : '✓ Log Order'}
          </button>
        </form>
      </div>

      {/* Filter bar */}
      <div style={{ background: purpleLight, borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 900, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ ...labelSt, color: purpleD, fontWeight: 700 }}>Search:</label>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="store, order #, note, date…"
            style={{ ...inputSt, flex: 1 }} />
          <span style={{ fontSize: 12, color: '#9b8ec4', marginLeft: 'auto' }}>{filtered.length} entries</span>
        </div>
      </div>

      {/* Table — desktop */}
      <div className="ic-table-wrap" ref={scrollRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }} onClick={() => setContextMenu(null)}
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; setPulling(false) }}
        onTouchMove={e => {
          const el = scrollRef.current; if (!el) return
          const dy = e.touches[0].clientY - touchStartY.current
          if (el.scrollTop === 0 && dy > 0) { setPullY(Math.min(dy, 72)); setPulling(true) }
          else { setPullY(0); setPulling(false) }
        }}
        onTouchEnd={() => {
          if (pullY > 50) { refresh() }
          setPullY(0); setPulling(false)
        }}
      >
        {pulling && pullY > 10 && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: purple, opacity: Math.min(pullY / 50, 1) }}>
            {pullY > 50 ? '↑ Release to refresh' : '↓ Pull to refresh'}
          </div>
        )}
        {loading ? (
          <p style={{ padding: 24, color: '#9b8ec4', fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px 16px' }}>
          <div style={{ background: '#fff', border: '1px solid #93c5fd', overflow: 'auto', width: '100%', maxWidth: 900, alignSelf: 'flex-start' }}>
          <table className="ic-table">
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <th>Logged</th>
                <th>Pushed (CSV)</th>
                <th>User</th>
                <th>Store</th>
                <th>Invoice #</th>
                <th>Status</th>
                <th className="ic-col-hide">In Log</th>
                <th className="ic-col-hide">PO #</th>
                <th className="ic-col-hide">Qty</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No entries yet.</td></tr>
              )}
              {filtered.map((e, i) => {
                const pushed = e.status === 'Pushed In'
                const rowBg = pushed
                  ? (i % 2 === 0 ? '#dcfce7' : '#d1fae5')
                  : (i % 2 === 0 ? '#fff' : '#eff6ff')
                const textColor = pushed ? '#166534' : '#1f2937'
                const dimColor = pushed ? '#15803d' : '#6b7280'
                return (
                  <tr key={e.id} style={{ background: rowBg, cursor: 'context-menu' }}
                    onContextMenu={ev => handleRowRightClick(ev, e.id)}>
                    <td style={{ color: dimColor, whiteSpace: 'nowrap' }}>{formatDate(e.saved_at)}</td>
                    <td style={{ color: pushed ? '#15803d' : '#d1d5db', whiteSpace: 'nowrap', fontStyle: pushed && !e.pushed_at ? 'italic' : 'normal' }}>
                      {pushed ? (e.pushed_at ? formatDate(e.pushed_at) : '—') : ''}
                    </td>
                    <td style={{ color: pushed ? '#166534' : purple, fontWeight: 700 }}>{e.userid}</td>
                    <td style={{ color: textColor, fontWeight: 600 }}>{e.store}</td>
                    <td style={{ color: pushed ? '#14532d' : purpleD, fontWeight: 700 }}>{e.order_num}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                        background: pushed ? '#bbf7d0' : '#fef3c7',
                        color: pushed ? '#14532d' : '#92400e',
                        border: pushed ? '1px solid #86efac' : '1px solid #fcd34d',
                        whiteSpace: 'nowrap',
                      }}>
                        {pushed ? '✓ Pushed' : 'Pending'}
                      </span>
                    </td>
                    <td className="ic-col-hide" style={{ textAlign: 'center', color: pushed ? '#16a34a' : '#d1d5db' }}>
                      {pushed ? '✓' : ''}
                    </td>
                    <td className="ic-col-hide" style={{ color: textColor, fontWeight: pushed ? 600 : 400 }}>{e.po_num || '—'}</td>
                    <td className="ic-col-hide" style={{ color: textColor, fontWeight: pushed ? 600 : 400 }}>{pushed ? e.qty_pushed : '—'}</td>
                    <td style={{ color: dimColor, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.note || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          </div>
        )}
      </div>

      {/* Cards — mobile */}
      <div className="ic-cards" ref={scrollRef}
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; setPulling(false) }}
        onTouchMove={e => {
          const el = scrollRef.current; if (!el) return
          const dy = e.touches[0].clientY - touchStartY.current
          if (el.scrollTop === 0 && dy > 0) { setPullY(Math.min(dy, 72)); setPulling(true) }
          else { setPullY(0); setPulling(false) }
        }}
        onTouchEnd={() => {
          if (pullY > 50) { refresh() }
          setPullY(0); setPulling(false)
        }}
      >
        {pulling && pullY > 10 && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: purple, opacity: Math.min(pullY / 50, 1) }}>
            {pullY > 50 ? '↑ Release to refresh' : '↓ Pull to refresh'}
          </div>
        )}
        {loading ? (
          <p style={{ padding: 24, color: '#9b8ec4', fontSize: 13 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No entries yet.</p>
        ) : filtered.map(e => {
          const pushed = e.status === 'Pushed In'
          const cardBg = pushed ? '#dcfce7' : '#fff'
          const textColor = pushed ? '#14532d' : '#111827'
          const dimColor = pushed ? '#15803d' : '#6b7280'
          return (
            <div key={e.id} style={{ background: cardBg, border: `1px solid ${pushed ? '#86efac' : border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}
              onContextMenu={ev => handleRowRightClick(ev, e.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: pushed ? '#14532d' : purpleD, wordBreak: 'break-word' }}>{e.order_num}</div>
                  {e.note ? (
                    <div style={{ fontSize: 12, color: dimColor, marginTop: 3, wordBreak: 'break-word' }}>
                      <span style={{ fontWeight: 700 }}>Note: </span>{e.note}
                    </div>
                  ) : null}
                </div>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, flexShrink: 0,
                  background: pushed ? '#bbf7d0' : '#fef3c7',
                  color: pushed ? '#14532d' : '#92400e',
                  border: pushed ? '1px solid #86efac' : '1px solid #fcd34d',
                }}>
                  {pushed ? '✓ Pushed' : 'Pending'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: dimColor, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: pushed ? '#15803d' : purple }}>{e.userid}</span>
                <span>·</span>
                <span>{e.store}</span>
                <span>·</span>
                <span>Logged: {formatDate(e.saved_at)}</span>
                {e.po_num ? <><span>·</span><span>PO: {e.po_num}</span></> : null}
              </div>
              {pushed && (
                <div style={{ fontSize: 11, marginTop: 3, color: '#15803d', fontWeight: 600 }}>
                  📤 Pushed (CSV): {e.pushed_at ? formatDate(e.pushed_at) : '—'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div style={{
          position: 'fixed', top: contextMenu.y, left: contextMenu.x,
          background: '#fff', border: `1px solid ${border}`, borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 200, overflow: 'hidden', minWidth: 160,
        }} onClick={e => e.stopPropagation()}>
          <button onClick={() => openEdit(contextMenu.id)}
            style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: purpleD, fontWeight: 600, cursor: 'pointer' }}>
            ✏️ Edit
          </button>
          {entries.find(e => e.id === contextMenu.id)?.status === 'Pending' && (
            <>
              <div style={{ height: 1, background: border }} />
              <button onClick={() => markPushedIn(contextMenu.id)}
                style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: '#15803d', fontWeight: 600, cursor: 'pointer' }}>
                ✅ Mark as Pushed In
              </button>
            </>
          )}
          {currentUser?.store === 'ALL' && (
            <>
              <div style={{ height: 1, background: border }} />
              <button onClick={() => openAttach(contextMenu.id)}
                style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: '#0369a1', fontWeight: 600, cursor: 'pointer' }}>
                🔗 Attach to log entry…
              </button>
            </>
          )}
          <div style={{ height: 1, background: border }} />
          <button onClick={() => deleteEntry(contextMenu.id)}
            style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>
            🗑 Delete
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editingEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setEditingEntry(null) }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: purpleD, marginBottom: 18, textAlign: 'center' }}>Edit Entry</div>
            <form onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ ...labelSt, display: 'block', marginBottom: 4 }}>StoreID</label>
                <select value={editingEntry.store} onChange={e => setEditingEntry(prev => prev ? { ...prev, store: e.target.value } : prev)}
                  style={{ ...inputSt, width: '100%' }}>
                  {STORES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...labelSt, display: 'block', marginBottom: 4 }}>Invoice #</label>
                <input value={editingEntry.order_num}
                  onChange={e => setEditingEntry(prev => prev ? { ...prev, order_num: e.target.value } : prev)}
                  style={{ ...inputSt, width: '100%' }} />
              </div>
              <div>
                <label style={{ ...labelSt, display: 'block', marginBottom: 4 }}>Note</label>
                <input value={editingEntry.note}
                  onChange={e => setEditingEntry(prev => prev ? { ...prev, note: e.target.value } : prev)}
                  placeholder="optional…" style={{ ...inputSt, width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setEditingEntry(null)}
                  style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={adding}
                  style={{ flex: 2, background: purple, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1 }}>
                  {adding ? '…' : '✓ Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attach Modal */}
      {attachModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setAttachModal(null) }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 520, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '80vh' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0369a1' }}>🔗 Attach to AutoCSV Log Entry</div>
            <div style={{ fontSize: 12, color: '#374151' }}>
              IC entry: <span style={{ fontWeight: 700, color: purpleD }}>{attachModal.entry.order_num}</span>
              {' '}· Store: <span style={{ fontWeight: 700 }}>{attachModal.entry.store}</span>
            </div>
            <input
              autoFocus
              value={attachSearch}
              onChange={e => setAttachSearch(e.target.value)}
              placeholder="Search by invoice #, PO #…"
              style={{ ...inputSt, width: '100%', fontSize: 13 }}
            />
            <div style={{ overflowY: 'auto', flex: 1, border: `1px solid ${border}`, borderRadius: 8 }}>
              {attachLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>Loading…</div>
              ) : (() => {
                const q = attachSearch.toLowerCase()
                const rows = attachRows.filter(r =>
                  !q || r.invoice_num?.toLowerCase().includes(q) || r.po_num?.toLowerCase().includes(q)
                )
                if (!rows.length) return <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No entries found.</div>
                return rows.map((r, i) => (
                  <div key={r.id}
                    style={{ padding: '10px 14px', borderBottom: i < rows.length - 1 ? `1px solid ${border}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: i % 2 === 0 ? '#fff' : '#f5f3ff', cursor: 'pointer' }}
                    onClick={() => { if (!attachSaving) doAttach(r) }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>INV# {r.invoice_num}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        {r.store} · Qty: {r.qty_total}
                        {r.po_num ? ` · PO# ${r.po_num}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#374151', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>📤 {formatDate(r.exported_at)}</div>
                    </div>
                  </div>
                ))
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setAttachModal(null)}
                style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#3b1f8c', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const labelSt: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }
const inputSt: React.CSSProperties = {
  padding: '5px 8px', border: '1.5px solid #d1d5db', borderRadius: 5,
  fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#111', outline: 'none',
  background: '#f9fafb',
}

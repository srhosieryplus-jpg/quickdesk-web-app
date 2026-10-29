'use client'
import { useEffect, useState, useCallback } from 'react'
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

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  const fetchEntries = useCallback(async (user?: User) => {
    const u = user || currentUser
    if (!u) return
    setLoading(true)
    let query = supabase.from('ic_log').select('*').order('saved_at', { ascending: false })
    if (u.store && u.store !== 'ALL') query = query.eq('store', u.store)
    const { data, error } = await query
    if (error) { showToast('❌ Could not load entries', 'err') }
    else setEntries((data || []) as ICEntry[])
    setLoading(false)
  }, [currentUser])

  // Auto-match: check autocsv_log for any pending entries
  const autoMatch = useCallback(async (entriesList: ICEntry[]) => {
    const pending = entriesList.filter(e => e.status === 'Pending')
    if (!pending.length) return

    const orderNums = pending.map(e => e.order_num)
    const { data: matches } = await supabase
      .from('autocsv_log')
      .select('*')
      .in('invoice_num', orderNums)

    if (!matches || !matches.length) return

    for (const match of matches) {
      const entry = pending.find(e => e.order_num === match.invoice_num && e.store === match.store)
      if (!entry) continue
      await supabase.from('ic_log').update({
        status: 'Pushed In',
        po_num: match.po_num || '',
        qty_pushed: match.qty_total || 0,
        in_push_log: true,
        note_pushed: true,
      }).eq('id', entry.id)
    }

    if (matches.length) fetchEntries()
  }, [currentUser, fetchEntries])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    setNewStore(u.store !== 'ALL' ? u.store : 'PO')
    fetchEntries(u).then(() => {
      // run auto-match after load
    })
  }, [router])

  useEffect(() => {
    if (entries.length) autoMatch(entries)
  }, [entries.length])

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
    await fetchEntries()
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

  const tdBase: React.CSSProperties = { padding: '5px 10px', fontSize: 12, verticalAlign: 'middle', borderBottom: '1px solid #e5e7eb' }

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', borderBottom: `1px solid ${border}`,
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)',
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
          <span style={{ fontSize: 20, color: purple }}>∞</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>INFINITY CLASSICS</span>
          <span style={{ color: '#c4b5fd', fontSize: 14 }}>— Order Log</span>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={refresh} disabled={saving}
            style={{ background: '#dcfce7', border: 'none', color: '#166534', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? '…' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Add form */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '10px 20px' }}>
        <form onSubmit={addEntry} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={labelSt}>StoreID:</label>
            <select value={newStore} onChange={e => setNewStore(e.target.value)} style={inputSt}>
              {STORES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 16, color: '#9b8ec4', margin: '0 2px' }}>—</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={labelSt}>Invoice #:</label>
            <input value={newOrder} onChange={e => setNewOrder(e.target.value)}
              placeholder="e.g. 2976440" style={{ ...inputSt, width: 130 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={labelSt}>Note:</label>
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              placeholder="optional…" style={{ ...inputSt, width: 160 }} />
          </div>
          <button type="submit" disabled={adding}
            style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1 }}>
            {adding ? '…' : '✓ Log Order'}
          </button>
        </form>
      </div>

      {/* Filter bar */}
      <div style={{ background: purpleLight, borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 900, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ ...labelSt, color: purpleD }}>Search:</label>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="store, order #, note, date…"
            style={{ ...inputSt, width: 200 }} />
          <span style={{ fontSize: 12, color: '#9b8ec4', marginLeft: 'auto' }}>{filtered.length} entries</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }} onClick={() => setContextMenu(null)}>
        {loading ? (
          <p style={{ padding: 24, color: '#9b8ec4', fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', maxWidth: 900 }}>
            <thead>
              <tr style={{ background: '#e8e4f8', position: 'sticky', top: 0, zIndex: 1 }}>
                {['Date','User','Store','Invoice #','Status','In Push Log','PO #','Qty Pushed','Note'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: purpleD, borderBottom: `2px solid ${border}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No entries yet.</td></tr>
              )}
              {filtered.map((e, i) => {
                const pushed = e.status === 'Pushed In'
                const rowBg = pushed
                  ? (i % 2 === 0 ? '#14532d' : '#166534')
                  : (i % 2 === 0 ? '#fff' : '#faf8ff')
                const textColor = pushed ? '#86efac' : '#1f2937'
                const dimColor = pushed ? '#4ade80' : '#6b7280'
                return (
                  <tr key={e.id} style={{ background: rowBg, cursor: 'context-menu' }}
                    onContextMenu={ev => handleRowRightClick(ev, e.id)}>
                    <td style={{ ...tdBase, color: dimColor, whiteSpace: 'nowrap' }}>{formatDate(e.saved_at)}</td>
                    <td style={{ ...tdBase, color: pushed ? '#86efac' : purple, fontWeight: 700 }}>{e.userid}</td>
                    <td style={{ ...tdBase, color: textColor, fontWeight: 600 }}>{e.store}</td>
                    <td style={{ ...tdBase, color: pushed ? '#fff' : purpleD, fontWeight: 700 }}>{e.order_num}</td>
                    <td style={{ ...tdBase }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: pushed ? '#166534' : '#fef3c7',
                        color: pushed ? '#86efac' : '#92400e',
                        border: pushed ? '1px solid #4ade80' : '1px solid #fcd34d',
                      }}>
                        {pushed ? '[Pushed In]' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ ...tdBase, textAlign: 'center', color: pushed ? '#4ade80' : '#d1d5db' }}>
                      {pushed ? '✓' : ''}
                    </td>
                    <td style={{ ...tdBase, color: pushed ? '#fff' : '#374151', fontWeight: pushed ? 600 : 400 }}>{e.po_num || ''}</td>
                    <td style={{ ...tdBase, color: pushed ? '#fff' : '#374151', fontWeight: pushed ? 600 : 400 }}>{pushed ? e.qty_pushed : ''}</td>
                    <td style={{ ...tdBase, color: dimColor }}>{e.note}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div style={{
          position: 'fixed', top: contextMenu.y, left: contextMenu.x,
          background: '#fff', border: `1px solid ${border}`, borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 200, overflow: 'hidden', minWidth: 120,
        }} onClick={e => e.stopPropagation()}>
          <button onClick={() => openEdit(contextMenu.id)}
            style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: purpleD, fontWeight: 600, cursor: 'pointer' }}>
            ✏️ Edit
          </button>
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

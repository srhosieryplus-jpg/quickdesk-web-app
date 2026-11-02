'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const purple      = '#7c3aed'
const purpleD     = '#6d28d9'
const purpleLight = '#f5f3ff'
const border      = '#d4c8f0'
const gray        = '#6b7280'

interface Task {
  id: string; store: string; location: string; task: string
  note: string; done: boolean; logged_by: string; saved_at: string
}
interface SeasonLog {
  id: string; season_type: string; store: string; vendor: string
  invoice: string; po_num: string; note: string; logged_by: string; saved_at: string
}
interface ICEntry {
  id: string; store: string; userid: string; order_num: string
  status: 'Pending' | 'Pushed In'; po_num: string; qty_pushed: number
  note: string; saved_at: string
}
interface UPCSession {
  id: string; name: string; store: string; userid: string
  rows?: { upc: string; qty: number }[]; extra_cols?: string[]; saved_at: string
  status?: 'waiting' | 'ready' | 'complete'
}

type TabId = 'overview' | 'tasks' | 'season' | 'ic' | 'upc'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${String(d.getFullYear()).slice(2)} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

const inputSt: React.CSSProperties = {
  padding: '4px 8px', border: '1.5px solid #d1d5db', borderRadius: 5,
  fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#111', outline: 'none',
  background: '#f9fafb',
}

export default function ReportsPage() {
  const router = useRouter()
  const [user, setUser]       = useState<User | null>(null)
  const [tab, setTab]         = useState<TabId>('overview')
  const [filter, setFilter]   = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast]     = useState('')

  const [tasks, setTasks]   = useState<Task[]>([])
  const [season, setSeason] = useState<SeasonLog[]>([])
  const [ic, setIc]         = useState<ICEntry[]>([])
  const [upc, setUpc]       = useState<UPCSession[]>([])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchAll = useCallback(async (u: User) => {
    const store = u.store === 'ALL' ? null : u.store
    const q = (table: string, cols = '*') => {
      let r = supabase.from(table).select(cols).order('saved_at', { ascending: false })
      if (store) r = r.eq('store', store)
      return r
    }
    const [t, s, i, up] = await Promise.all([
      q('tasks'), q('season_log'), q('ic_log'),
      q('upc_sessions', 'id,name,store,userid,rows,extra_cols,saved_at,status'),
    ])
    setTasks(((t.data as unknown) as Task[]) || [])
    setSeason(((s.data as unknown) as SeasonLog[]) || [])
    setIc(((i.data as unknown) as ICEntry[]) || [])
    setUpc(((up.data as unknown) as UPCSession[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchAll(u)
  }, [router, fetchAll])

  async function refresh() {
    if (!user) return
    setRefreshing(true)
    await fetchAll(user)
    setRefreshing(false)
    showToast('🔄 Refreshed')
  }

  async function cycleUpcStatus(id: string, current: 'waiting' | 'ready' | 'complete') {
    const next = current === 'waiting' ? 'ready' : current === 'ready' ? 'complete' : 'waiting'
    const { error } = await supabase.from('upc_sessions').update({ status: next }).eq('id', id)
    if (error) { showToast('❌ ' + error.message); return }
    setUpc(prev => prev.map(r => r.id === id ? { ...r, status: next } : r))
    const label = next === 'complete' ? '✅ Marked complete' : next === 'ready' ? '👀 Marked ready' : '⏳ Reset to waiting'
    showToast(label)
  }

  const isAdmin = user?.store === 'ALL'
  const q = filter.toLowerCase()
  const filteredTasks  = tasks.filter(r =>
    (!pendingOnly || !r.done) &&
    (!q || r.task.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.logged_by?.toLowerCase().includes(q))
  )
  const filteredSeason = season.filter(r =>
    (!q || r.vendor.toLowerCase().includes(q) || r.invoice.toLowerCase().includes(q) || r.store.toLowerCase().includes(q))
  )
  const filteredIc = ic.filter(r =>
    (!pendingOnly || r.status === 'Pending') &&
    (!q || r.order_num.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.userid?.toLowerCase().includes(q))
  )
  const filteredUpc = upc.filter(r =>
    (!q || r.name.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.userid?.toLowerCase().includes(q))
  )

  function upcStatus(r: UPCSession): 'waiting' | 'ready' | 'complete' {
    if (r.status === 'complete') return 'complete'
    if (r.status === 'ready') return 'ready'
    // fallback: derive from rows for old records without status field
    const rows = r.rows || []
    const hasReal = rows.some(x => x.upc && x.upc !== '')
    return hasReal ? 'ready' : 'waiting'
  }

  // merged feed for overview
  type FeedItem = {
    id?: string; time: string; module: string; store: string; label: string; userid: string
    isPending: boolean
    status: string; statusColor: string; statusBg: string; statusBorder: string
    upcState?: 'waiting' | 'ready' | 'complete'
  }
  const allFeed: FeedItem[] = [
    ...tasks.map(r => ({
      time: r.saved_at, module: 'Task', store: r.store, label: r.task,
      userid: displayUser(r.logged_by),
      isPending: !r.done,
      status: r.done ? '✓ Done' : 'Open',
      statusColor: r.done ? '#166534' : '#92400e',
      statusBg:    r.done ? '#dcfce7' : '#fef3c7',
      statusBorder:r.done ? '#86efac' : '#fcd34d',
    })),
    ...season.map(r => ({
      time: r.saved_at, module: r.season_type || 'Season', store: r.store,
      label: `${r.vendor} — ${r.invoice}`, userid: displayUser(r.logged_by),
      isPending: false,
      status: 'Logged', statusColor: '#1e40af', statusBg: '#dbeafe', statusBorder: '#93c5fd',
    })),
    ...ic.map(r => ({
      time: r.saved_at, module: 'IC', store: r.store, label: r.order_num,
      userid: displayUser(r.userid),
      isPending: r.status === 'Pending',
      status: r.status === 'Pushed In' ? '✓ Pushed' : 'Pending',
      statusColor: r.status === 'Pushed In' ? '#166534' : '#92400e',
      statusBg:    r.status === 'Pushed In' ? '#dcfce7' : '#fef3c7',
      statusBorder:r.status === 'Pushed In' ? '#86efac' : '#fcd34d',
    })),
    ...upc.map(r => {
      const st = upcStatus(r)
      return {
        id: r.id, time: r.saved_at, module: 'UPC', store: r.store, label: r.name,
        userid: displayUser(r.userid),
        isPending: st === 'waiting' || st === 'ready',
        status: st === 'waiting' ? '⏳ Waiting' : st === 'ready' ? '👀 Ready' : '✓ Complete',
        statusColor: st === 'waiting' ? '#1e40af' : st === 'ready' ? '#92400e' : '#166534',
        statusBg:    st === 'waiting' ? '#dbeafe' : st === 'ready' ? '#fef3c7' : '#dcfce7',
        statusBorder:st === 'waiting' ? '#93c5fd' : st === 'ready' ? '#fcd34d' : '#86efac',
        upcState: st,
      }
    }),
  ].sort((a, b) => b.time.localeCompare(a.time))

  const feed = allFeed
    .filter(r => (!pendingOnly || r.isPending) && (!q || r.label.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.module.toLowerCase().includes(q) || r.userid.toLowerCase().includes(q)))

  if (!user) return null

  const hasPendingToggle = tab === 'overview' || tab === 'tasks' || tab === 'ic'

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; }
        .rpt-header { padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); }
        .rpt-center { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; pointer-events: none; }
        .rpt-table { border-collapse: collapse; width: 100%; font-size: 11px; }
        .rpt-table th { padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 800; color: ${purpleD}; border-bottom: 2px solid ${border}; white-space: nowrap; background: #e8e4f8; position: sticky; top: 0; z-index: 1; }
        .rpt-table td { padding: 3px 8px; font-size: 11px; vertical-align: middle; border-bottom: 1px solid #e5e7eb; height: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
        .rpt-table tr:hover td { filter: brightness(0.97); }
        @media (max-width: 700px) {
          .rpt-table th, .rpt-table td { padding: 3px 5px; font-size: 10px; }
          .ic-col-hide { display: none; }
        }
        .rpt-tab { padding: 8px 14px; font-size: 12px; font-weight: 500; border: none; border-bottom: 2px solid transparent; background: none; color: ${gray}; cursor: pointer; white-space: nowrap; }
        .rpt-tab.active { font-weight: 700; color: ${purple}; border-bottom-color: ${purple}; }
        .rpt-tab:hover:not(.active) { color: ${purpleD}; }
        .pending-toggle { display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; border: 1.5px solid; cursor: pointer; font-size: 11px; font-weight: 700; transition: all 0.15s; user-select: none; }
      `}</style>

      {/* Header */}
      <div className="rpt-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>
            ← Home
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{displayUser(user.userid)}</span>
            {user.store ? <> · {user.store === 'ALL' ? 'All Stores' : user.store}</> : ''}
          </span>
        </div>

        <div className="rpt-center">
          <span style={{ fontSize: 18, color: purple }}>📋</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>REPORTS</span>
          <span style={{ color: '#c4b5fd', fontSize: 13 }}>— All Modules</span>
        </div>

        <div style={{ flexShrink: 0 }}>
          <button onClick={refresh} disabled={refreshing}
            style={{ background: '#ede9fe', border: 'none', color: purpleD, borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {refreshing ? '…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: 'rgba(255,255,255,0.7)', borderBottom: `1px solid ${border}`, display: 'flex', paddingLeft: 4, overflowX: 'auto', flexShrink: 0 }}>
        {([
          ['overview', '⊞ Overview'],
          ['tasks',    '☑ Tasks'],
          ['season',   '✻ Season Logs'],
          ['ic',       '∞ IC Log'],
          ['upc',      '⬛ UPC Sessions'],
        ] as [TabId, string][]).map(([id, label]) => (
          <button key={id} className={`rpt-tab${tab === id ? ' active' : ''}`}
            onClick={() => { setTab(id); setPendingOnly(false) }}>
            {label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ background: purpleLight, borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ width: '100%', maxWidth: 960, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Search store, entry, user…"
            style={{ ...inputSt, flex: 1 }} />

          {hasPendingToggle && (
            <div className="pending-toggle"
              onClick={() => setPendingOnly(p => !p)}
              style={{
                background: pendingOnly ? '#fef3c7' : '#fff',
                borderColor: pendingOnly ? '#fcd34d' : border,
                color: pendingOnly ? '#92400e' : gray,
              }}>
              ☑ View Pending
            </div>
          )}

          <span style={{ fontSize: 11, color: '#9b8ec4', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            {tab === 'overview' ? `${feed.length} entries` :
             tab === 'tasks'    ? `${filteredTasks.length} entries` :
             tab === 'season'   ? `${filteredSeason.length} entries` :
             tab === 'ic'       ? `${filteredIc.length} entries` :
             `${filteredUpc.length} entries`}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {loading ? (
          <p style={{ padding: 32, color: '#9b8ec4', fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 8px 40px' }}>

            {/* OVERVIEW */}
            {tab === 'overview' && (
              <table className="rpt-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Module</th>
                    <th>Store</th>
                    <th>User</th>
                    <th>Entry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No activity found.</td></tr>
                  )}
                  {feed.map((item, i) => {
                    const isDone = !item.isPending && item.status !== 'Open'
                    const rowBg = (item.module === 'Task' && !item.isPending && item.status === '✓ Done') ||
                                  (item.module === 'IC' && !item.isPending)
                      ? (i % 2 === 0 ? '#14532d' : '#166534')
                      : (i % 2 === 0 ? '#fff' : '#faf8ff')
                    const isGreen = rowBg === '#14532d' || rowBg === '#166534'
                    return (
                      <tr key={i} style={{ background: rowBg }}>
                        <td style={{ color: isGreen ? '#4ade80' : gray, fontSize: 10 }}>{formatDate(item.time)}</td>
                        <td style={{ fontWeight: 700, color: isGreen ? '#86efac' : purpleD }}>{item.module}</td>
                        <td style={{ fontWeight: 700, color: isGreen ? '#86efac' : purpleD }}>{item.store === 'ALL' ? '—' : item.store}</td>
                        <td style={{ fontWeight: 700, color: isGreen ? '#86efac' : purple }}>{item.userid}</td>
                        <td style={{ color: isGreen ? '#fff' : '#111', maxWidth: 260 }}>{item.label}</td>
                        <td>
                          <span
                            onClick={isAdmin && item.module === 'UPC' && item.id && item.upcState ? () => cycleUpcStatus(item.id!, item.upcState!) : undefined}
                            title={isAdmin && item.module === 'UPC' ? 'Click to change status' : undefined}
                            style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: item.statusBg, color: item.statusColor, border: `1px solid ${item.statusBorder}`, whiteSpace: 'nowrap', cursor: isAdmin && item.module === 'UPC' ? 'pointer' : 'default' }}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* TASKS */}
            {tab === 'tasks' && (
              <table className="rpt-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Store</th>
                    <th>Task</th>
                    <th className="ic-col-hide">Note</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 && <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No tasks found.</td></tr>}
                  {filteredTasks.map((r, i) => {
                    const done = r.done
                    const rowBg = done ? (i%2===0 ? '#14532d' : '#166534') : (i%2===0 ? '#fff' : '#faf8ff')
                    const txt = done ? '#86efac' : '#1f2937'
                    const dim = done ? '#4ade80' : gray
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={{ color: dim, fontSize: 10 }}>{formatDate(r.saved_at)}</td>
                        <td style={{ color: done ? '#86efac' : purple, fontWeight: 700 }}>{displayUser(r.logged_by)}</td>
                        <td style={{ color: txt, fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: done ? '#fff' : '#111', maxWidth: 300 }}>{r.task}</td>
                        <td className="ic-col-hide" style={{ color: dim, maxWidth: 200 }}>{r.note || ''}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: done ? '#166534' : '#fef3c7',
                            color: done ? '#86efac' : '#92400e',
                            border: done ? '1px solid #4ade80' : '1px solid #fcd34d',
                          }}>
                            {done ? '✓ Done' : 'Open'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* SEASON LOGS */}
            {tab === 'season' && (
              <table className="rpt-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Store</th>
                    <th>Type</th>
                    <th>Vendor</th>
                    <th>Invoice</th>
                    <th className="ic-col-hide">PO #</th>
                    <th className="ic-col-hide">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSeason.length === 0 && <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No season logs found.</td></tr>}
                  {filteredSeason.map((r, i) => (
                    <tr key={r.id} style={{ background: i%2===0 ? '#fff' : '#faf8ff' }}>
                      <td style={{ color: gray, fontSize: 10 }}>{formatDate(r.saved_at)}</td>
                      <td style={{ color: purple, fontWeight: 700 }}>{displayUser(r.logged_by)}</td>
                      <td style={{ fontWeight: 600 }}>{r.store}</td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' }}>
                          {r.season_type}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: purpleD }}>{r.vendor}</td>
                      <td style={{ fontFamily: 'monospace' }}>{r.invoice || '—'}</td>
                      <td className="ic-col-hide" style={{ color: gray }}>{r.po_num || '—'}</td>
                      <td className="ic-col-hide" style={{ color: gray, maxWidth: 160 }}>{r.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* IC LOG */}
            {tab === 'ic' && (
              <table className="rpt-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Store</th>
                    <th>Invoice #</th>
                    <th>Status</th>
                    <th className="ic-col-hide">PO #</th>
                    <th className="ic-col-hide">Qty</th>
                    <th className="ic-col-hide">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIc.length === 0 && <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No IC entries found.</td></tr>}
                  {filteredIc.map((r, i) => {
                    const pushed = r.status === 'Pushed In'
                    const rowBg = pushed ? (i%2===0 ? '#14532d' : '#166534') : (i%2===0 ? '#fff' : '#faf8ff')
                    const txt = pushed ? '#86efac' : '#1f2937'
                    const dim = pushed ? '#4ade80' : gray
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={{ color: dim, fontSize: 10 }}>{formatDate(r.saved_at)}</td>
                        <td style={{ color: pushed ? '#86efac' : purple, fontWeight: 700 }}>{displayUser(r.userid)}</td>
                        <td style={{ color: txt, fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: pushed ? '#fff' : purpleD, fontWeight: 700, fontFamily: 'monospace' }}>{r.order_num}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: pushed ? '#166534' : '#fef3c7',
                            color: pushed ? '#86efac' : '#92400e',
                            border: pushed ? '1px solid #4ade80' : '1px solid #fcd34d',
                          }}>
                            {pushed ? '✓ Pushed' : 'Pending'}
                          </span>
                        </td>
                        <td className="ic-col-hide" style={{ color: pushed ? '#fff' : '#374151' }}>{r.po_num || ''}</td>
                        <td className="ic-col-hide" style={{ color: pushed ? '#fff' : '#374151', fontWeight: pushed ? 600 : 400 }}>{pushed ? r.qty_pushed : ''}</td>
                        <td className="ic-col-hide" style={{ color: dim, maxWidth: 160 }}>{r.note || ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* UPC SESSIONS */}
            {tab === 'upc' && (
              <table className="rpt-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Store</th>
                    <th>Invoice / Name</th>
                    <th className="ic-col-hide">Rows</th>
                    <th className="ic-col-hide">Total Qty</th>
                    <th>Status</th>
                    {isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredUpc.length === 0 && <tr><td colSpan={isAdmin ? 8 : 7} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No UPC sessions found.</td></tr>}
                  {filteredUpc.map((r, i) => {
                    const rows = r.rows || []
                    const totalQty = rows.reduce((s, x) => s + (x.qty || 0), 0)
                    const st = upcStatus(r)
                    const rowBg = st === 'complete'
                      ? (i%2===0 ? '#14532d' : '#166534')
                      : (i%2===0 ? '#fff' : '#faf8ff')
                    const isGreen = st === 'complete'
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={{ color: isGreen ? '#4ade80' : gray, fontSize: 10 }}>{formatDate(r.saved_at)}</td>
                        <td style={{ color: isGreen ? '#86efac' : purple, fontWeight: 700 }}>{displayUser(r.userid)}</td>
                        <td style={{ fontWeight: 600, color: isGreen ? '#86efac' : '#1f2937' }}>{r.store}</td>
                        <td style={{ color: isGreen ? '#fff' : purpleD, fontWeight: 700 }}>{r.name}</td>
                        <td className="ic-col-hide" style={{ textAlign: 'center', color: isGreen ? '#4ade80' : gray }}>{rows.length}</td>
                        <td className="ic-col-hide" style={{ textAlign: 'center', fontWeight: 700, color: isGreen ? '#86efac' : purple }}>{totalQty || '—'}</td>
                        <td>
                          <span
                            onClick={isAdmin ? () => cycleUpcStatus(r.id, st) : undefined}
                            title={isAdmin ? 'Click to change status' : undefined}
                            style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                              background: st === 'complete' ? '#166534' : st === 'ready' ? '#fef3c7' : '#dbeafe',
                              color:      st === 'complete' ? '#86efac' : st === 'ready' ? '#92400e' : '#1e40af',
                              border:     st === 'complete' ? '1px solid #4ade80' : st === 'ready' ? '1px solid #fcd34d' : '1px solid #93c5fd',
                              cursor: isAdmin ? 'pointer' : 'default',
                            }}>
                            {st === 'complete' ? '✓ Complete' : st === 'ready' ? '👀 Ready' : '⏳ Waiting'}
                          </span>
                        </td>
                        {isAdmin && <td />}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#3b1f8c', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  )
}

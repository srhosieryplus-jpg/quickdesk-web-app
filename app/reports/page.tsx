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
const green       = '#16a34a'
const amber       = '#d97706'
const blue        = '#2563eb'
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
}

type TabId = 'overview' | 'tasks' | 'season' | 'ic' | 'upc'

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${String(d.getFullYear()).slice(2)} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

const labelSt: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }
const inputSt: React.CSSProperties = {
  padding: '5px 8px', border: '1.5px solid #d1d5db', borderRadius: 5,
  fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#111', outline: 'none',
  background: '#f9fafb',
}

export default function ReportsPage() {
  const router = useRouter()
  const [user, setUser]       = useState<User | null>(null)
  const [tab, setTab]         = useState<TabId>('overview')
  const [filter, setFilter]   = useState('')
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
      q('upc_sessions', 'id,name,store,userid,rows,extra_cols,saved_at'),
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

  const q = filter.toLowerCase()
  const filteredTasks  = tasks.filter(r => !q || r.task.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.logged_by?.toLowerCase().includes(q))
  const filteredSeason = season.filter(r => !q || r.vendor.toLowerCase().includes(q) || r.invoice.toLowerCase().includes(q) || r.store.toLowerCase().includes(q))
  const filteredIc     = ic.filter(r => !q || r.order_num.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.userid?.toLowerCase().includes(q))
  const filteredUpc    = upc.filter(r => !q || r.name.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.userid?.toLowerCase().includes(q))

  const openTasks  = tasks.filter(t => !t.done).length
  const pendingIc  = ic.filter(i => i.status === 'Pending').length
  const cutoff     = new Date(Date.now() - 3 * 86400000).toISOString()
  const recentSeason = season.filter(s => s.saved_at > cutoff).length

  // merged feed for overview
  type FeedItem = { time: string; module: string; store: string; label: string; status: string; statusColor: string; statusBg: string; statusBorder: string }
  const feed: FeedItem[] = [
    ...tasks.slice(0, 8).map(r => ({ time: r.saved_at, module: 'Task', store: r.store, label: r.task,
      status: r.done ? '✓ Done' : 'Open',
      statusColor: r.done ? '#166534' : '#92400e',
      statusBg: r.done ? '#dcfce7' : '#fef3c7',
      statusBorder: r.done ? '#86efac' : '#fcd34d',
    })),
    ...season.slice(0, 8).map(r => ({ time: r.saved_at, module: r.season_type || 'Season', store: r.store, label: `${r.vendor} — ${r.invoice}`,
      status: 'Logged', statusColor: '#1e40af', statusBg: '#dbeafe', statusBorder: '#93c5fd',
    })),
    ...ic.slice(0, 8).map(r => ({ time: r.saved_at, module: 'IC', store: r.store, label: r.order_num,
      status: r.status === 'Pushed In' ? '✓ Pushed' : 'Pending',
      statusColor: r.status === 'Pushed In' ? '#166534' : '#92400e',
      statusBg: r.status === 'Pushed In' ? '#dcfce7' : '#fef3c7',
      statusBorder: r.status === 'Pushed In' ? '#86efac' : '#fcd34d',
    })),
    ...upc.slice(0, 8).map(r => {
      const rows = r.rows || []
      const hasPlaceholders = rows.some(x => !x.upc || (x as any)._isPlaceholder === 1)
      return { time: r.saved_at, module: 'UPC', store: r.store, label: r.name,
        status: hasPlaceholders ? '⏳ Awaiting' : '✓ Complete',
        statusColor: hasPlaceholders ? '#1e40af' : '#166534',
        statusBg: hasPlaceholders ? '#dbeafe' : '#dcfce7',
        statusBorder: hasPlaceholders ? '#93c5fd' : '#86efac',
      }
    }),
  ].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 30)

  const tabCount: Partial<Record<TabId, number>> = {
    tasks: openTasks || undefined,
    ic: pendingIc || undefined,
  }

  if (!user) return null

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .rpt-header { padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); }
        .rpt-center { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; pointer-events: none; }
        .ic-table { border-collapse: collapse; font-size: 11px; width: 100%; }
        .ic-table th { padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 700; color: ${purpleD}; border-bottom: 2px solid ${border}; white-space: nowrap; }
        .ic-table td { padding: 3px 7px; font-size: 11px; vertical-align: middle; border-bottom: 1px solid #e5e7eb; }
        @media (max-width: 700px) {
          .ic-table th, .ic-table td { padding: 3px 5px; font-size: 10px; }
          .ic-col-hide { display: none; }
        }
        .rpt-tab { padding: 8px 14px; font-size: 12px; font-weight: 500; border: none; border-bottom: 2px solid transparent; background: none; color: ${gray}; cursor: pointer; white-space: nowrap; }
        .rpt-tab.active { font-weight: 700; color: ${purple}; border-bottom-color: ${purple}; }
        .rpt-tab:hover:not(.active) { color: ${purpleD}; }
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
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{user.userid}</span>
            {user.store ? <> · {user.store === 'ALL' ? 'All Stores' : user.store}</> : ''}
          </span>
        </div>

        <div className="rpt-center">
          <span style={{ fontSize: 18, color: purple }}>📋</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>REPORTS</span>
          <span style={{ color: '#c4b5fd', fontSize: 13 }}>— All Modules</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={refresh} disabled={refreshing}
            style={{ background: '#dcfce7', border: 'none', color: '#166534', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {refreshing ? '…' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: 'rgba(255,255,255,0.7)', borderBottom: `1px solid ${border}`, display: 'flex', paddingLeft: 4, overflowX: 'auto', flexShrink: 0 }}>
        {([
          ['overview', '⊞ Overview'],
          ['tasks',    `☑ Tasks`],
          ['season',   '✻ Season Logs'],
          ['ic',       `∞ IC Log`],
          ['upc',      `⬛ UPC Sessions`],
        ] as [TabId, string][]).map(([id, label]) => {
          const cnt = tabCount[id]
          return (
            <button key={id} className={`rpt-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              {label}{cnt ? <span style={{ marginLeft: 4, background: id === 'ic' ? '#fef3c7' : purpleLight, color: id === 'ic' ? amber : purple, borderRadius: 8, padding: '0 5px', fontSize: 10, fontWeight: 800 }}>{cnt}</span> : ''}
            </button>
          )
        })}
      </div>

      {/* Filter bar */}
      <div style={{ background: purpleLight, borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ width: '100%', maxWidth: 960, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ ...labelSt, color: purpleD, fontWeight: 700 }}>Search:</label>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="store, name, order #, user…"
            style={{ ...inputSt, flex: 1 }} />
          <span style={{ fontSize: 12, color: '#9b8ec4', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {tab === 'overview' ? `${feed.length} recent` :
             tab === 'tasks' ? `${filteredTasks.length} entries` :
             tab === 'season' ? `${filteredSeason.length} entries` :
             tab === 'ic' ? `${filteredIc.length} entries` :
             `${filteredUpc.length} entries`}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {loading ? (
          <p style={{ padding: 32, color: '#9b8ec4', fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 8px 16px' }}>

            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div style={{ width: '100%', maxWidth: 960 }}>
                {/* stat row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, margin: '12px 0' }}>
                  {[
                    { label: 'Open Tasks', val: openTasks, color: openTasks ? '#92400e' : '#166534', bg: openTasks ? '#fef3c7' : '#dcfce7', onClick: () => setTab('tasks') },
                    { label: 'IC Pending',  val: pendingIc,  color: pendingIc ? '#92400e' : '#166534', bg: pendingIc ? '#fef3c7' : '#dcfce7', onClick: () => setTab('ic') },
                    { label: 'Season (3d)', val: recentSeason, color: '#1e40af', bg: '#dbeafe', onClick: () => setTab('season') },
                    { label: 'Total UPC Sessions', val: upc.length, color: purpleD, bg: '#ede9fe', onClick: () => setTab('upc') },
                  ].map(c => (
                    <div key={c.label} onClick={c.onClick} style={{
                      background: '#fff', border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.val}</div>
                      <div style={{ fontSize: 10, color: gray }}>{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* activity table */}
                <table className="ic-table">
                  <thead>
                    <tr style={{ background: '#e8e4f8', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th>Date</th>
                      <th>Module</th>
                      <th>Store</th>
                      <th>Entry</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No recent activity.</td></tr>
                    )}
                    {feed.map((item, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#faf8ff' }}>
                        <td style={{ color: gray, whiteSpace: 'nowrap' }}>{formatDate(item.time)}</td>
                        <td><span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#ede9fe', color: purpleD, border: `1px solid ${border}`, whiteSpace: 'nowrap' }}>{item.module}</span></td>
                        <td style={{ fontWeight: 600, color: purpleD }}>{item.store}</td>
                        <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: item.statusBg, color: item.statusColor, border: `1px solid ${item.statusBorder}`, whiteSpace: 'nowrap' }}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TASKS */}
            {tab === 'tasks' && (
              <table className="ic-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr style={{ background: '#e8e4f8', position: 'sticky', top: 0, zIndex: 1 }}>
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
                        <td style={{ color: dim, whiteSpace: 'nowrap' }}>{formatDate(r.saved_at)}</td>
                        <td style={{ color: done ? '#86efac' : purple, fontWeight: 700 }}>{r.logged_by}</td>
                        <td style={{ color: txt, fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: done ? '#fff' : '#111', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task}</td>
                        <td className="ic-col-hide" style={{ color: dim, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note || ''}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: done ? '#166534' : '#fef3c7',
                            color: done ? '#86efac' : '#92400e',
                            border: done ? '1px solid #4ade80' : '1px solid #fcd34d',
                            whiteSpace: 'nowrap',
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
              <table className="ic-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr style={{ background: '#e8e4f8', position: 'sticky', top: 0, zIndex: 1 }}>
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
                      <td style={{ color: gray, whiteSpace: 'nowrap' }}>{formatDate(r.saved_at)}</td>
                      <td style={{ color: purple, fontWeight: 700 }}>{r.logged_by}</td>
                      <td style={{ fontWeight: 600 }}>{r.store}</td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', whiteSpace: 'nowrap' }}>
                          {r.season_type}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: purpleD }}>{r.vendor}</td>
                      <td>{r.invoice || '—'}</td>
                      <td className="ic-col-hide" style={{ color: gray }}>{r.po_num || '—'}</td>
                      <td className="ic-col-hide" style={{ color: gray, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* IC LOG */}
            {tab === 'ic' && (
              <table className="ic-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr style={{ background: '#e8e4f8', position: 'sticky', top: 0, zIndex: 1 }}>
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
                        <td style={{ color: dim, whiteSpace: 'nowrap' }}>{formatDate(r.saved_at)}</td>
                        <td style={{ color: pushed ? '#86efac' : purple, fontWeight: 700 }}>{r.userid}</td>
                        <td style={{ color: txt, fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: pushed ? '#fff' : purpleD, fontWeight: 700 }}>{r.order_num}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: pushed ? '#166534' : '#fef3c7',
                            color: pushed ? '#86efac' : '#92400e',
                            border: pushed ? '1px solid #4ade80' : '1px solid #fcd34d',
                            whiteSpace: 'nowrap',
                          }}>
                            {pushed ? '✓ Pushed' : 'Pending'}
                          </span>
                        </td>
                        <td className="ic-col-hide" style={{ color: pushed ? '#fff' : '#374151' }}>{r.po_num || ''}</td>
                        <td className="ic-col-hide" style={{ color: pushed ? '#fff' : '#374151', fontWeight: pushed ? 600 : 400 }}>{pushed ? r.qty_pushed : ''}</td>
                        <td className="ic-col-hide" style={{ color: dim, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note || ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* UPC SESSIONS */}
            {tab === 'upc' && (
              <table className="ic-table" style={{ maxWidth: 960 }}>
                <thead>
                  <tr style={{ background: '#e8e4f8', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th>Date</th>
                    <th>User</th>
                    <th>Store</th>
                    <th>Invoice / Name</th>
                    <th className="ic-col-hide">Rows</th>
                    <th className="ic-col-hide">Total Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUpc.length === 0 && <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No UPC sessions found.</td></tr>}
                  {filteredUpc.map((r, i) => {
                    const rows = r.rows || []
                    const hasPlaceholders = rows.some(x => !x.upc || (x as any)._isPlaceholder === 1)
                    const totalQty = rows.reduce((s, x) => s + (x.qty || 0), 0)
                    const complete = !hasPlaceholders
                    return (
                      <tr key={r.id} style={{ background: i%2===0 ? '#fff' : '#faf8ff' }}>
                        <td style={{ color: gray, whiteSpace: 'nowrap' }}>{formatDate(r.saved_at)}</td>
                        <td style={{ color: purple, fontWeight: 700 }}>{r.userid}</td>
                        <td style={{ fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: purpleD, fontWeight: 700 }}>{r.name}</td>
                        <td className="ic-col-hide" style={{ textAlign: 'center', color: gray }}>{rows.length}</td>
                        <td className="ic-col-hide" style={{ textAlign: 'center', fontWeight: 700, color: purple }}>{totalQty || '—'}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: complete ? '#166534' : '#dbeafe',
                            color: complete ? '#86efac' : '#1e40af',
                            border: complete ? '1px solid #4ade80' : '1px solid #93c5fd',
                            whiteSpace: 'nowrap',
                          }}>
                            {complete ? '✓ Complete' : '⏳ Awaiting'}
                          </span>
                        </td>
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

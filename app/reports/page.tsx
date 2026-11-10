'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
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
  assigned_to: string | null
  completed_at: string | null
  completed_by: string | null
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
interface LogRequest {
  id: string; store: string; brand: string; invoice_no: string
  po_no: string | null; qty: number; note: string | null
  logged_by: string; created_at: string; season_type: 'SS' | 'AW'
}

type TabId = 'overview' | 'tasks' | 'season' | 'ic' | 'upc'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}

function formatDate(iso: string) {
  if (!iso) return { date: '', full: '' }
  const d = new Date(iso)
  const date = `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${String(d.getFullYear()).slice(2)}`
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  return { date, full: `${date} ${time}` }
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

  const [tasks, setTasks]       = useState<Task[]>([])
  const [allUsers, setAllUsers] = useState<{ userid: string; name: string | null }[]>([])
  const [season, setSeason]     = useState<SeasonLog[]>([])
  const [logRequests, setLogRequests] = useState<LogRequest[]>([])
  const [ic, setIc]             = useState<ICEntry[]>([])
  const [upc, setUpc]           = useState<UPCSession[]>([])
  const [pullY, setPullY]   = useState(0)
  const [pulling, setPulling] = useState(false)
  const touchStartY = useRef(0)
  const cardsRef = useRef<HTMLDivElement>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchAll = useCallback(async (u: User) => {
    const store = u.store === 'ALL' ? null : u.store
    const q = (table: string, cols = '*') => {
      let r = supabase.from(table).select(cols).order('saved_at', { ascending: false })
      if (store) r = r.eq('store', store)
      return r
    }
    const qFlag = (table: string) => {
      let r = supabase.from(table).select('id,store,brand,invoice_no,po_no,qty,note,logged_by,created_at').eq('flagged', true).order('created_at', { ascending: false })
      if (store) r = r.eq('store', store)
      return r
    }
    const [t, s, i, up, ss, aw] = await Promise.all([
      q('tasks'), q('season_log'), q('ic_log'),
      q('upc_sessions', 'id,name,store,userid,rows,extra_cols,saved_at,status'),
      qFlag('season_ss'), qFlag('season_aw'),
    ])
    setTasks(((t.data as unknown) as Task[]) || [])
    setSeason(((s.data as unknown) as SeasonLog[]) || [])
    setIc(((i.data as unknown) as ICEntry[]) || [])
    setUpc(((up.data as unknown) as UPCSession[]) || [])
    const ssRows = ((ss.data || []) as unknown as Omit<LogRequest, 'season_type'>[]).map(r => ({ ...r, season_type: 'SS' as const }))
    const awRows = ((aw.data || []) as unknown as Omit<LogRequest, 'season_type'>[]).map(r => ({ ...r, season_type: 'AW' as const }))
    setLogRequests([...ssRows, ...awRows].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    setLoading(false)
  }, [])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchAll(u)
    supabase.from('users').select('userid, name').order('userid').then(({ data }) => {
      if (data) setAllUsers(data as { userid: string; name: string | null }[])
    })
    const interval = setInterval(() => fetchAll(u), 30000)
    return () => clearInterval(interval)
  }, [router, fetchAll])

  async function refresh() {
    if (!user) return
    setRefreshing(true)
    await fetchAll(user)
    setRefreshing(false)
    showToast('🔄 Refreshed')
  }

  async function toggleTaskDone(id: string, currentDone: boolean) {
    const next = !currentDone
    const { error } = await supabase.from('tasks').update({ done: next }).eq('id', id)
    if (error) { showToast('❌ ' + error.message); return }
    setTasks(prev => prev.map(r => r.id === id ? { ...r, done: next } : r))
    showToast(next ? '✅ Marked done' : '↩ Marked open')
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
  const userNameMap = new Map(allUsers.map(u => [u.userid.toUpperCase(), u.name?.trim() || displayUser(u.userid)]))
  const q = filter.toLowerCase()
  const filteredTasks  = tasks.filter(r =>
    (!pendingOnly || !r.done) &&
    (!q || r.task.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.logged_by?.toLowerCase().includes(q) || r.assigned_to?.toLowerCase().includes(q))
  )
  const filteredSeason = season.filter(r =>
    (!q || r.vendor.toLowerCase().includes(q) || r.invoice.toLowerCase().includes(q) || r.store.toLowerCase().includes(q))
  )
  const filteredLogRequests = logRequests.filter(r =>
    (!q || r.brand?.toLowerCase().includes(q) || r.invoice_no?.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.logged_by?.toLowerCase().includes(q))
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
    ...logRequests.map(r => ({
      time: r.created_at, module: r.season_type, store: r.store,
      label: `${r.brand} — ${r.invoice_no || 'no invoice'}`, userid: displayUser(r.logged_by),
      isPending: true,
      status: '🏷️ Log Req', statusColor: '#78350f', statusBg: '#fde68a', statusBorder: '#fcd34d',
    })),
  ].sort((a, b) => b.time.localeCompare(a.time))

  const feed = allFeed
    .filter(r => (!pendingOnly || r.isPending) && (!q || r.label.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.module.toLowerCase().includes(q) || r.userid.toLowerCase().includes(q)))

  if (!user) return null

  const hasPendingToggle = tab === 'overview' || tab === 'tasks' || tab === 'ic'

  type CardItem = {
    id?: string; time: string; module: string; store: string; label: string
    sublabel?: string; userid: string; status: string
    statusColor: string; statusBg: string; statusBorder: string
    isGreen: boolean; isPending: boolean; upcState?: 'waiting'|'ready'|'complete'
    taskDone?: boolean
  }
  const mobileCards: CardItem[] = tab === 'overview' ? feed.map(item => ({
    id: item.id, time: item.time, module: item.module, store: item.store,
    label: item.label, userid: item.userid, status: item.status,
    statusColor: item.statusColor, statusBg: item.statusBg, statusBorder: item.statusBorder,
    isGreen: !item.isPending && item.status !== 'Open' && item.status !== '⏳ Waiting' && item.status !== '👀 Ready',
    isPending: item.isPending ?? false, upcState: item.upcState,
  })) : tab === 'tasks' ? filteredTasks.map(r => ({
    id: r.id, time: r.saved_at, module: 'Task', store: r.store, label: r.task,
    sublabel: r.note || undefined, userid: displayUser(r.logged_by),
    status: r.done ? '✓ Done' : 'Open',
    statusColor: r.done ? '#166534' : '#92400e',
    statusBg: r.done ? '#dcfce7' : '#fef3c7',
    statusBorder: r.done ? '#86efac' : '#fcd34d',
    isGreen: r.done, isPending: false, taskDone: r.done,
  })) : tab === 'season' ? [
    ...filteredSeason.map(r => ({
      id: r.id, time: r.saved_at, module: r.season_type || 'Season', store: r.store,
      label: `${r.vendor} — ${r.invoice}`, sublabel: r.note || undefined,
      userid: displayUser(r.logged_by),
      status: 'Logged', statusColor: '#1e40af', statusBg: '#dbeafe', statusBorder: '#93c5fd',
      isGreen: false, isPending: false,
    })),
    ...filteredLogRequests.map(r => ({
      id: r.id, time: r.created_at, module: r.season_type, store: r.store,
      label: `${r.brand} — ${r.invoice_no}`, sublabel: r.note || undefined,
      userid: displayUser(r.logged_by),
      status: '🏷️ Log Req', statusColor: '#78350f', statusBg: '#fde68a', statusBorder: '#fcd34d',
      isGreen: false, isPending: true,
    })),
  ].sort((a, b) => (b.time || '').localeCompare(a.time || '')) : tab === 'ic' ? filteredIc.map(r => ({
    id: r.id, time: r.saved_at, module: 'IC', store: r.store,
    label: r.order_num, sublabel: r.note || undefined, userid: displayUser(r.userid),
    status: r.status === 'Pushed In' ? '✓ Pushed' : 'Pending',
    statusColor: r.status === 'Pushed In' ? '#166534' : '#92400e',
    statusBg: r.status === 'Pushed In' ? '#dcfce7' : '#fef3c7',
    statusBorder: r.status === 'Pushed In' ? '#86efac' : '#fcd34d',
    isGreen: r.status === 'Pushed In', isPending: r.status === 'Pending',
  })) : filteredUpc.map(r => {
    const st = upcStatus(r)
    return {
      id: r.id, time: r.saved_at, module: 'UPC', store: r.store,
      label: r.name, userid: displayUser(r.userid),
      status: st === 'waiting' ? '⏳ Waiting' : st === 'ready' ? '👀 Ready' : '✓ Complete',
      statusColor: st === 'waiting' ? '#1e40af' : st === 'ready' ? '#92400e' : '#166534',
      statusBg: st === 'waiting' ? '#dbeafe' : st === 'ready' ? '#fef3c7' : '#dcfce7',
      statusBorder: st === 'waiting' ? '#93c5fd' : st === 'ready' ? '#fcd34d' : '#86efac',
      isGreen: st === 'complete', isPending: false, upcState: st,
    }
  })

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; }
        .rpt-header { padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); }
        .rpt-center { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; pointer-events: none; }
        .rpt-table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .rpt-table th { padding: 7px 10px; text-align: left; font-size: 11px; font-weight: 700; color: #1e3a8a; border-bottom: 2px solid #93c5fd; white-space: nowrap; background: #dbeafe; position: sticky; top: 0; z-index: 1; }
        .rpt-table td { padding: 5px 10px; font-size: 12px; vertical-align: middle; border-bottom: 1px solid #e5e7eb; height: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
        .rpt-table tr:hover td { filter: brightness(0.97); }
        .rpt-refresh { display: inline-block; }
        .rpt-all-modules { display: inline; }
        .rpt-body-table { display: block; }
        .rpt-body-cards { display: none; }
        @media (max-width: 700px) {
          .rpt-table th, .rpt-table td { padding: 3px 5px; font-size: 10px; }
          .ic-col-hide { display: none; }
          .rpt-time { display: none; }
          .rpt-refresh { display: none !important; }
          .rpt-all-modules { display: none !important; }
          .rpt-body-table { display: none; }
          .rpt-body-cards { display: block; padding: 8px 12px; overflow-y: auto; flex: 1; }
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
          <span className="rpt-all-modules" style={{ color: '#c4b5fd', fontSize: 13 }}>— All Modules</span>
        </div>

        <div className="rpt-refresh" style={{ flexShrink: 0 }}>
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
             tab === 'season'   ? `${filteredSeason.length + filteredLogRequests.length} entries` :
             tab === 'ic'       ? `${filteredIc.length} entries` :
             `${filteredUpc.length} entries`}
          </span>
        </div>
      </div>

      {/* Body — desktop table */}
      <div className="rpt-body-table" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {loading ? (
          <p style={{ padding: 32, color: '#9b8ec4', fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px 40px' }}>
          <div style={{ background: '#fff', border: '1px solid #93c5fd', overflow: 'auto', width: '100%', maxWidth: 960, alignSelf: 'flex-start' }}>

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
                    const rowBg = (item.module === 'Task' && item.status === '✓ Done') ||
                                  (item.module === 'IC' && !item.isPending) ||
                                  (item.module === 'UPC' && item.upcState === 'complete')
                      ? (i % 2 === 0 ? '#dcfce7' : '#d1fae5')
                      : (i % 2 === 0 ? '#fff' : '#eff6ff')
                    const isGreen = rowBg === '#dcfce7' || rowBg === '#d1fae5'
                    return (
                      <tr key={i} style={{ background: rowBg }}>
                        <td style={{ color: isGreen ? '#15803d' : gray, fontSize: 11 }}>{(() => { const f = formatDate(item.time); return <>{f.date}<span className="rpt-time"> {f.full.slice(-5)}</span></> })()}</td>
                        <td style={{ fontWeight: 700, color: isGreen ? '#166534' : purpleD }}>{item.module}</td>
                        <td style={{ fontWeight: 700, color: isGreen ? '#166534' : purpleD }}>{item.store === 'ALL' ? '—' : item.store}</td>
                        <td style={{ fontWeight: 700, color: isGreen ? '#166534' : purple }}>{item.userid}</td>
                        <td style={{ color: isGreen ? '#14532d' : '#111', maxWidth: 260 }}>{item.label}</td>
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
                    <th>Submitted By</th>
                    <th>Assigned To</th>
                    <th>Store</th>
                    <th>Task</th>
                    <th className="ic-col-hide">Note</th>
                    <th>Done</th>
                    <th className="ic-col-hide">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 && <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No tasks found.</td></tr>}
                  {filteredTasks.map((r, i) => {
                    const done = r.done
                    const rowBg = done ? (i%2===0 ? '#dcfce7' : '#d1fae5') : (i%2===0 ? '#fff' : '#eff6ff')
                    const txt = done ? '#166534' : '#1f2937'
                    const dim = done ? '#15803d' : gray
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={{ color: dim, fontSize: 11 }}>{(() => { const f = formatDate(r.saved_at); return <>{f.date}<span className="rpt-time"> {f.full.slice(-5)}</span></> })()}</td>
                        <td style={{ color: done ? '#166534' : purple, fontWeight: 700 }}>{userNameMap.get(r.logged_by?.toUpperCase()) || displayUser(r.logged_by)}</td>
                        <td style={{ color: r.assigned_to ? (done ? '#15803d' : '#7c3aed') : dim, fontWeight: r.assigned_to ? 700 : 400 }}>
                          {r.assigned_to ? (userNameMap.get(r.assigned_to.toUpperCase()) || displayUser(r.assigned_to)) : '—'}
                        </td>
                        <td style={{ color: txt, fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: done ? '#14532d' : '#111', maxWidth: 300 }}>{r.task}</td>
                        <td className="ic-col-hide" style={{ color: dim, maxWidth: 200 }}>{r.note || ''}</td>
                        <td>
                          <span
                            onClick={isAdmin ? () => toggleTaskDone(r.id, r.done) : undefined}
                            title={isAdmin ? 'Click to toggle done' : undefined}
                            style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                              background: done ? '#bbf7d0' : '#fef3c7',
                              color: done ? '#14532d' : '#92400e',
                              border: done ? '1px solid #86efac' : '1px solid #fcd34d',
                              cursor: isAdmin ? 'pointer' : 'default',
                            }}>
                            {done ? '✓ Done' : 'Open'}
                          </span>
                        </td>
                        <td className="ic-col-hide" style={{ fontSize: 11 }}>
                          {r.completed_at ? (
                            <div>
                              <div style={{ color: '#15803d', fontWeight: 700 }}>{(() => { const f = formatDate(r.completed_at!); return f.date })()}</div>
                              {r.completed_by && <div style={{ color: '#16a34a', fontSize: 10 }}>{userNameMap.get(r.completed_by.toUpperCase()) || displayUser(r.completed_by)}</div>}
                            </div>
                          ) : <span style={{ color: dim }}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* SEASON LOGS */}
            {tab === 'season' && (
              <>
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
                    <tr key={r.id} style={{ background: i%2===0 ? '#fff' : '#eff6ff' }}>
                      <td style={{ color: gray, fontSize: 10 }}>{(() => { const f = formatDate(r.saved_at); return <>{f.date}<span className="rpt-time"> {f.full.slice(-5)}</span></> })()}</td>
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

              {/* LOG REQUESTS from SS/AW */}
              {filteredLogRequests.length > 0 && (
                <>
                  <div style={{ padding: '10px 12px 4px', fontWeight: 700, fontSize: 12, color: '#b45309', background: '#fffbeb', borderTop: '2px solid #fcd34d', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🏷️ Create Log Requests</span>
                    <span style={{ background: '#fcd34d', color: '#78350f', borderRadius: 10, padding: '0 7px', fontSize: 10, fontWeight: 700 }}>{filteredLogRequests.length}</span>
                  </div>
                  <table className="rpt-table" style={{ maxWidth: 960 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>User</th>
                        <th>Store</th>
                        <th>Type</th>
                        <th>Brand</th>
                        <th>Invoice #</th>
                        <th className="ic-col-hide">PO #</th>
                        <th className="ic-col-hide">Qty</th>
                        <th className="ic-col-hide">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogRequests.map((r, i) => (
                        <tr key={r.id} style={{ background: i%2===0 ? '#fffbeb' : '#fef9ee' }}>
                          <td style={{ color: '#92400e', fontSize: 10 }}>{(() => { const f = formatDate(r.created_at); return <>{f.date}<span className="rpt-time"> {f.full.slice(-5)}</span></> })()}</td>
                          <td style={{ color: '#b45309', fontWeight: 700 }}>{displayUser(r.logged_by)}</td>
                          <td style={{ fontWeight: 600, color: '#78350f' }}>{r.store}</td>
                          <td>
                            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#fde68a', color: '#78350f', border: '1px solid #fcd34d' }}>
                              {r.season_type}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600, color: '#b45309' }}>{r.brand || '—'}</td>
                          <td style={{ fontFamily: 'monospace', color: '#78350f' }}>{r.invoice_no || '—'}</td>
                          <td className="ic-col-hide" style={{ color: '#92400e' }}>{r.po_no || '—'}</td>
                          <td className="ic-col-hide" style={{ color: '#92400e', fontWeight: 600 }}>{r.qty ?? '—'}</td>
                          <td className="ic-col-hide" style={{ color: '#b45309', maxWidth: 160 }}>{r.note || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              </>
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
                    const rowBg = pushed ? (i%2===0 ? '#dcfce7' : '#d1fae5') : (i%2===0 ? '#fff' : '#eff6ff')
                    const txt = pushed ? '#166534' : '#1f2937'
                    const dim = pushed ? '#15803d' : gray
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={{ color: dim, fontSize: 11 }}>{(() => { const f = formatDate(r.saved_at); return <>{f.date}<span className="rpt-time"> {f.full.slice(-5)}</span></> })()}</td>
                        <td style={{ color: pushed ? '#166534' : purple, fontWeight: 700 }}>{displayUser(r.userid)}</td>
                        <td style={{ color: txt, fontWeight: 600 }}>{r.store}</td>
                        <td style={{ color: pushed ? '#14532d' : purpleD, fontWeight: 700, fontFamily: 'monospace' }}>{r.order_num}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: pushed ? '#bbf7d0' : '#fef3c7',
                            color: pushed ? '#14532d' : '#92400e',
                            border: pushed ? '1px solid #86efac' : '1px solid #fcd34d',
                          }}>
                            {pushed ? '✓ Pushed' : 'Pending'}
                          </span>
                        </td>
                        <td className="ic-col-hide" style={{ color: txt }}>{r.po_num || '—'}</td>
                        <td className="ic-col-hide" style={{ color: txt, fontWeight: pushed ? 600 : 400 }}>{pushed ? r.qty_pushed : '—'}</td>
                        <td className="ic-col-hide" style={{ color: dim, maxWidth: 160 }}>{r.note || '—'}</td>
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
                      ? (i%2===0 ? '#dcfce7' : '#d1fae5')
                      : (i%2===0 ? '#fff' : '#eff6ff')
                    const isGreen = st === 'complete'
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={{ color: isGreen ? '#15803d' : gray, fontSize: 11 }}>{(() => { const f = formatDate(r.saved_at); return <>{f.date}<span className="rpt-time"> {f.full.slice(-5)}</span></> })()}</td>
                        <td style={{ color: isGreen ? '#166534' : purple, fontWeight: 700 }}>{displayUser(r.userid)}</td>
                        <td style={{ fontWeight: 600, color: isGreen ? '#166534' : '#1f2937' }}>{r.store}</td>
                        <td style={{ color: isGreen ? '#14532d' : purpleD, fontWeight: 700 }}>{r.name}</td>
                        <td className="ic-col-hide" style={{ textAlign: 'center', color: isGreen ? '#15803d' : gray }}>{rows.length}</td>
                        <td className="ic-col-hide" style={{ textAlign: 'center', fontWeight: 700, color: isGreen ? '#166634' : purple }}>{totalQty || '—'}</td>
                        <td>
                          <span
                            onClick={isAdmin ? () => cycleUpcStatus(r.id, st) : undefined}
                            title={isAdmin ? 'Click to change status' : undefined}
                            style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                              background: st === 'complete' ? '#bbf7d0' : st === 'ready' ? '#fef3c7' : '#dbeafe',
                              color:      st === 'complete' ? '#14532d' : st === 'ready' ? '#92400e' : '#1e40af',
                              border:     st === 'complete' ? '1px solid #86efac' : st === 'ready' ? '1px solid #fcd34d' : '1px solid #93c5fd',
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
          </div>
        )}
      </div>

      {/* Body — mobile cards */}
      <div className="rpt-body-cards"
        ref={cardsRef}
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; setPulling(false) }}
        onTouchMove={e => {
          const el = cardsRef.current
          if (!el) return
          const dy = e.touches[0].clientY - touchStartY.current
          if (el.scrollTop === 0 && dy > 0) { setPullY(Math.min(dy, 72)); setPulling(true) }
          else { setPullY(0); setPulling(false) }
        }}
        onTouchEnd={() => {
          if (pullY > 50 && user) { fetchAll(user); showToast('🔄 Refreshed') }
          setPullY(0); setPulling(false)
        }}
      >
        {pulling && pullY > 10 && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: purple, opacity: Math.min(pullY / 50, 1) }}>
            {pullY > 50 ? '↑ Release to refresh' : '↓ Pull to refresh'}
          </div>
        )}
        {loading ? (
          <p style={{ padding: 24, color: purple, fontSize: 13 }}>Loading…</p>
        ) : mobileCards.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No entries found.</p>
        ) : mobileCards.map((item, i) => (
          <div key={item.id || i} style={{
            background: item.isGreen ? '#dcfce7' : '#fff',
            border: `1px solid ${item.isGreen ? '#86efac' : border}`,
            borderRadius: 10, padding: '10px 12px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: item.isGreen ? '#14532d' : '#111', textDecoration: (item.module === 'Task' && item.status === '✓ Done') ? 'line-through' : 'none' }}>
                  {item.label}
                </div>
                {item.sublabel ? (
                  <div style={{ fontSize: 12, color: item.isGreen ? '#16a34a' : gray, marginTop: 4 }}>
                    <span style={{ fontWeight: 700 }}>Note:</span> {item.sublabel}
                  </div>
                ) : null}
              </div>
              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                background: item.statusBg, color: item.statusColor, border: `1px solid ${item.statusBorder}`,
                whiteSpace: 'nowrap', flexShrink: 0,
                cursor: isAdmin && (item.module === 'UPC' && item.upcState || item.module === 'Task') ? 'pointer' : 'default',
              }}
                onClick={
                  isAdmin && item.module === 'UPC' && item.id && item.upcState ? () => cycleUpcStatus(item.id!, item.upcState!) :
                  isAdmin && item.module === 'Task' && item.id ? () => toggleTaskDone(item.id!, item.taskDone ?? false) :
                  undefined
                }
              >
                {item.status}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 11, color: item.isGreen ? '#16a34a' : gray, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: item.isGreen ? '#15803d' : purple }}>{item.module}</span>
              <span>·</span>
              <span style={{ fontWeight: 700 }}>{item.userid}</span>
              <span>·</span>
              <span>{item.store === 'ALL' ? '—' : item.store}</span>
              <span>·</span>
              <span>{formatDate(item.time).date}</span>
            </div>
          </div>
        ))}
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

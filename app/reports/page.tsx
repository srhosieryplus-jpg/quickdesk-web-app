'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

// ── colours ──────────────────────────────────────────────────────────────────
const purple     = '#7c3aed'
const purpleD    = '#6d28d9'
const purpleLight= '#f5f3ff'
const border     = '#d4c8f0'
const teal       = '#0d9488'
const tealLight  = '#f0fdfa'
const blue       = '#2563eb'
const blueLight  = '#eff6ff'
const amber      = '#d97706'
const amberLight = '#fffbeb'
const red        = '#dc2626'
const green      = '#16a34a'
const gray       = '#6b7280'

// ── types ────────────────────────────────────────────────────────────────────
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

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 99,
      fontSize: 10, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const router = useRouter()
  const [user, setUser]           = useState<User | null>(null)
  const [tab, setTab]             = useState<TabId>('overview')
  const [filter, setFilter]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [toast, setToast]         = useState('')

  const [tasks, setTasks]         = useState<Task[]>([])
  const [season, setSeason]       = useState<SeasonLog[]>([])
  const [ic, setIc]               = useState<ICEntry[]>([])
  const [upc, setUpc]             = useState<UPCSession[]>([])

  const isAdmin = (u: User | null) => u?.store === 'ALL'

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchAll = useCallback(async (u: User) => {
    setLoading(true)
    const store = u.store === 'ALL' ? null : u.store

    const [t, s, ic_, upc_] = await Promise.all([
      supabase.from('tasks').select('*').order('saved_at', { ascending: false })
        .then(r => store ? supabase.from('tasks').select('*').eq('store', store).order('saved_at', { ascending: false }) : r),
      supabase.from('season_log').select('*').order('saved_at', { ascending: false })
        .then(r => store ? supabase.from('season_log').select('*').eq('store', store).order('saved_at', { ascending: false }) : r),
      supabase.from('ic_log').select('*').order('saved_at', { ascending: false })
        .then(r => store ? supabase.from('ic_log').select('*').eq('store', store).order('saved_at', { ascending: false }) : r),
      supabase.from('upc_sessions').select('id,name,store,userid,rows,extra_cols,saved_at').order('saved_at', { ascending: false })
        .then(r => store ? supabase.from('upc_sessions').select('id,name,store,userid,rows,extra_cols,saved_at').eq('store', store).order('saved_at', { ascending: false }) : r),
    ])

    setTasks((t.data as Task[]) || [])
    setSeason((s.data as SeasonLog[]) || [])
    setIc((ic_.data as ICEntry[]) || [])
    setUpc((upc_.data as UPCSession[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchAll(u)
  }, [router, fetchAll])

  const q = filter.toLowerCase()
  const filteredTasks  = tasks.filter(r => !q || r.task.toLowerCase().includes(q) || r.store.toLowerCase().includes(q) || r.logged_by.toLowerCase().includes(q))
  const filteredSeason = season.filter(r => !q || r.vendor.toLowerCase().includes(q) || r.invoice.toLowerCase().includes(q) || r.store.toLowerCase().includes(q))
  const filteredIc     = ic.filter(r => !q || r.order_num.toLowerCase().includes(q) || r.store.toLowerCase().includes(q))
  const filteredUpc    = upc.filter(r => !q || r.name.toLowerCase().includes(q) || r.store.toLowerCase().includes(q))

  // overview counts
  const openTasks   = tasks.filter(t => !t.done).length
  const pendingIc   = ic.filter(i => i.status === 'Pending').length
  const upcPending  = upc.filter(s => (s.rows || []).some(r => !r.upc)).length
  const recentDays  = 3
  const cutoff      = new Date(Date.now() - recentDays * 86400000).toISOString()
  const recentSeason = season.filter(s => s.saved_at > cutoff).length

  // ── styles ──────────────────────────────────────────────────────────────────
  const thSt: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 10,
    color: purpleD, borderBottom: `2px solid ${border}`, whiteSpace: 'nowrap',
    background: '#ede9fe', position: 'sticky', top: 0,
  }
  const tdSt: React.CSSProperties = {
    padding: '6px 10px', fontSize: 11, borderBottom: `1px solid #f3f0ff`,
    verticalAlign: 'middle', whiteSpace: 'nowrap',
  }
  const tabBtnSt = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
    border: 'none', borderBottom: active ? `2px solid ${purple}` : '2px solid transparent',
    background: 'none', color: active ? purple : gray, cursor: 'pointer',
    whiteSpace: 'nowrap',
  })
  const cardSt: React.CSSProperties = {
    background: '#fff', border: `1px solid ${border}`, borderRadius: 10,
    padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4,
  }

  if (!user) return null

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', display: 'flex', flexDirection: 'column' }}>

      {/* header */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => router.push('/selector')}
          style={{ background: 'none', border: 'none', color: gray, fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>
          ← Home
        </button>
        <span style={{ fontSize: 13, fontWeight: 800, color: purpleD }}>📋 Reports</span>
        <span style={{ fontSize: 11, color: gray }}>{isAdmin(user) ? 'All Stores' : user.store}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => user && fetchAll(user)}
          style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, color: purpleD, cursor: 'pointer' }}>
          ↺ Refresh
        </button>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…"
          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, outline: 'none', width: 120 }} />
      </div>

      {/* tabs */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, display: 'flex', paddingLeft: 8, flexShrink: 0, overflowX: 'auto' }}>
        {([
          ['overview', '⊞ Overview'],
          ['tasks',    `☑ Tasks${openTasks ? ` (${openTasks})` : ''}`],
          ['season',   '✻ Season Logs'],
          ['ic',       `∞ IC Log${pendingIc ? ` (${pendingIc})` : ''}`],
          ['upc',      `⬛ UPC Sessions${upcPending ? ` (${upcPending})` : ''}`],
        ] as [TabId, string][]).map(([id, label]) => (
          <button key={id} style={tabBtnSt(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* body */}
      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: gray, fontSize: 13 }}>Loading…</div>
        ) : (

          /* ── OVERVIEW ── */
          tab === 'overview' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto' }}>
              {/* stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                {[
                  { label: 'Open Tasks',      val: openTasks,    color: openTasks ? red : green,     bg: openTasks ? '#fef2f2' : '#f0fdf4',   onClick: () => setTab('tasks')  },
                  { label: 'IC Pending',       val: pendingIc,    color: pendingIc ? amber : green,   bg: pendingIc ? amberLight : '#f0fdf4',  onClick: () => setTab('ic')     },
                  { label: 'UPC Awaiting',     val: upcPending,   color: upcPending ? blue : green,   bg: upcPending ? blueLight : '#f0fdf4',  onClick: () => setTab('upc')    },
                  { label: `Season (${recentDays}d)`, val: recentSeason, color: teal, bg: tealLight,  onClick: () => setTab('season') },
                ].map(c => (
                  <div key={c.label} onClick={c.onClick} style={{ ...cardSt, cursor: 'pointer', borderColor: c.color + '44' }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: c.color }}>{c.val}</div>
                    <div style={{ fontSize: 11, color: gray }}>{c.label}</div>
                  </div>
                ))}
              </div>

              {/* recent activity feed */}
              <div style={{ ...cardSt }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: purpleD, marginBottom: 6 }}>Recent Activity</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {[
                    ...tasks.slice(0, 5).map(r => ({ time: r.saved_at, type: 'Task', label: r.task, store: r.store, badge: r.done ? <Badge text="Done" color={green} bg="#f0fdf4" /> : <Badge text="Open" color={red} bg="#fef2f2" /> })),
                    ...season.slice(0, 5).map(r => ({ time: r.saved_at, type: r.season_type, label: `${r.vendor} — ${r.invoice}`, store: r.store, badge: null })),
                    ...ic.slice(0, 5).map(r => ({ time: r.saved_at, type: 'IC', label: r.order_num, store: r.store, badge: r.status === 'Pending' ? <Badge text="Pending" color={amber} bg={amberLight} /> : <Badge text="Pushed" color={green} bg="#f0fdf4" /> })),
                    ...upc.slice(0, 5).map(r => ({ time: r.saved_at, type: 'UPC', label: r.name, store: r.store, badge: (r.rows || []).some(x => !x.upc) ? <Badge text="Awaiting" color={blue} bg={blueLight} /> : <Badge text="Complete" color={green} bg="#f0fdf4" /> })),
                  ]
                    .sort((a, b) => b.time.localeCompare(a.time))
                    .slice(0, 20)
                    .map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid #f3f0ff` }}>
                        <span style={{ fontSize: 10, color: gray, width: 110, flexShrink: 0 }}>{fmt(item.time)}</span>
                        <Badge text={item.type} color={purple} bg={purpleLight} />
                        <Badge text={item.store} color={purpleD} bg="#ede9fe" />
                        <span style={{ fontSize: 11, color: '#1f1f1f', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                        {item.badge}
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

          /* ── TASKS ── */
          ) : tab === 'tasks' ? (
            <div style={{ maxWidth: 900, margin: '0 auto' }}>
              <TableWrap>
                <thead>
                  <tr>
                    {['Date', 'Store', 'Task', 'Note', 'By', 'Status'].map(h => <th key={h} style={thSt}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(r => (
                    <tr key={r.id} style={{ background: r.done ? '#fafafa' : '#fff' }}>
                      <td style={{ ...tdSt, color: gray }}>{fmt(r.saved_at)}</td>
                      <td style={tdSt}><Badge text={r.store} color={purpleD} bg="#ede9fe" /></td>
                      <td style={{ ...tdSt, whiteSpace: 'normal', maxWidth: 320 }}>{r.task}</td>
                      <td style={{ ...tdSt, color: gray, whiteSpace: 'normal', maxWidth: 200 }}>{r.note || '—'}</td>
                      <td style={{ ...tdSt, color: gray }}>{r.logged_by}</td>
                      <td style={tdSt}>
                        {r.done
                          ? <Badge text="✓ Done" color={green} bg="#f0fdf4" />
                          : <Badge text="Open" color={red} bg="#fef2f2" />}
                      </td>
                    </tr>
                  ))}
                  {filteredTasks.length === 0 && <EmptyRow cols={6} />}
                </tbody>
              </TableWrap>
            </div>

          /* ── SEASON ── */
          ) : tab === 'season' ? (
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              <TableWrap>
                <thead>
                  <tr>
                    {['Date', 'Type', 'Store', 'Vendor', 'Invoice', 'PO #', 'Note', 'By'].map(h => <th key={h} style={thSt}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredSeason.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...tdSt, color: gray }}>{fmt(r.saved_at)}</td>
                      <td style={tdSt}><Badge text={r.season_type} color={blue} bg={blueLight} /></td>
                      <td style={tdSt}><Badge text={r.store} color={purpleD} bg="#ede9fe" /></td>
                      <td style={{ ...tdSt, fontWeight: 600 }}>{r.vendor}</td>
                      <td style={tdSt}>{r.invoice || '—'}</td>
                      <td style={tdSt}>{r.po_num || '—'}</td>
                      <td style={{ ...tdSt, color: gray, whiteSpace: 'normal', maxWidth: 200 }}>{r.note || '—'}</td>
                      <td style={{ ...tdSt, color: gray }}>{r.logged_by}</td>
                    </tr>
                  ))}
                  {filteredSeason.length === 0 && <EmptyRow cols={8} />}
                </tbody>
              </TableWrap>
            </div>

          /* ── IC LOG ── */
          ) : tab === 'ic' ? (
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              <TableWrap>
                <thead>
                  <tr>
                    {['Date', 'Store', 'Order #', 'PO #', 'Qty', 'Note', 'Status'].map(h => <th key={h} style={thSt}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredIc.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...tdSt, color: gray }}>{fmt(r.saved_at)}</td>
                      <td style={tdSt}><Badge text={r.store} color={purpleD} bg="#ede9fe" /></td>
                      <td style={{ ...tdSt, fontWeight: 600 }}>{r.order_num}</td>
                      <td style={tdSt}>{r.po_num || '—'}</td>
                      <td style={{ ...tdSt, textAlign: 'center' }}>{r.qty_pushed || '—'}</td>
                      <td style={{ ...tdSt, color: gray, whiteSpace: 'normal', maxWidth: 220 }}>{r.note || '—'}</td>
                      <td style={tdSt}>
                        {r.status === 'Pending'
                          ? <Badge text="Pending" color={amber} bg={amberLight} />
                          : <Badge text="Pushed In" color={green} bg="#f0fdf4" />}
                      </td>
                    </tr>
                  ))}
                  {filteredIc.length === 0 && <EmptyRow cols={7} />}
                </tbody>
              </TableWrap>
            </div>

          /* ── UPC SESSIONS ── */
          ) : tab === 'upc' ? (
            <div style={{ maxWidth: 900, margin: '0 auto' }}>
              <TableWrap>
                <thead>
                  <tr>
                    {['Date', 'Store', 'Invoice', 'By', 'Rows', 'Total Qty', 'Status'].map(h => <th key={h} style={thSt}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredUpc.map(r => {
                    const rows = r.rows || []
                    const totalQty = rows.reduce((s, x) => s + (x.qty || 0), 0)
                    const hasPlaceholders = rows.some(x => !x.upc)
                    return (
                      <tr key={r.id}>
                        <td style={{ ...tdSt, color: gray }}>{fmt(r.saved_at)}</td>
                        <td style={tdSt}><Badge text={r.store} color={purpleD} bg="#ede9fe" /></td>
                        <td style={{ ...tdSt, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ ...tdSt, color: gray }}>{r.userid}</td>
                        <td style={{ ...tdSt, textAlign: 'center' }}>{rows.length}</td>
                        <td style={{ ...tdSt, textAlign: 'center', fontWeight: 700, color: purple }}>{totalQty}</td>
                        <td style={tdSt}>
                          {hasPlaceholders
                            ? <Badge text="⏳ Awaiting scan" color={blue} bg={blueLight} />
                            : <Badge text="✓ Complete" color={green} bg="#f0fdf4" />}
                        </td>
                      </tr>
                    )
                  })}
                  {filteredUpc.length === 0 && <EmptyRow cols={7} />}
                </tbody>
              </TableWrap>
            </div>
          ) : null
        )}
      </div>

      {/* toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1f1f1f', color: '#fff', padding: '8px 18px', borderRadius: 99,
          fontSize: 12, fontWeight: 600, zIndex: 9999, pointerEvents: 'none',
        }}>{toast}</div>
      )}
    </div>
  )
}

// ── shared sub-components ─────────────────────────────────────────────────────
function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d4c8f0', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' }}>
        {children}
      </table>
    </div>
  )
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: 12 }}>
        No entries found.
      </td>
    </tr>
  )
}

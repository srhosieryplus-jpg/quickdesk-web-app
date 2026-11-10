'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Task, User } from '@/lib/types'

const teal = '#1e40af'
const tealD = '#1e3a8a'
const tealLight = '#eff6ff'
const border = '#93c5fd'

export default function TasksPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newAssignTo, setNewAssignTo] = useState('')
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [filter, setFilter] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [pullY, setPullY] = useState(0)
  const [pulling, setPulling] = useState(false)
  const touchStartY = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchTasks(u)
    fetchUsers()
  }, [router])

  async function fetchUsers() {
    const { data } = await supabase.from('users').select('userid, store').order('userid')
    if (data) setAllUsers(data as User[])
  }

  // ── return to selector after screen lock / idle ───────────────────────────
  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [router])

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchTasks(u: User) {
    setLoading(true)
    let q = supabase.from('tasks').select('*').order('saved_at', { ascending: false })
    if (u.store !== 'ALL') {
      const viewStores = [u.store, ...(u.admin_stores ?? [])].filter(Boolean)
      q = viewStores.length === 1 ? q.eq('store', viewStores[0]) : q.in('store', viewStores)
    }
    const { data, error } = await q
    if (error) showToast('❌ Could not load tasks', 'err')
    else setTasks((data as Task[]) || [])
    setLoading(false)
  }

  async function goHome() {
    // Save any pending state then navigate
    router.push('/selector')
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTask.trim() || !user) return
    setSaving(true)
    const { error } = await supabase.from('tasks').insert({
      store: user.store,
      location: user.location,
      task: newTask.trim(),
      note: newNote.trim(),
      done: false,
      logged_by: user.userid,
      assigned_to: newAssignTo || null,
    })
    if (error) { showToast('❌ Error saving task', 'err'); setSaving(false); return }
    setNewTask(''); setNewNote(''); setNewAssignTo('')
    showToast('✅ Task submitted')
    setSaving(false)
    fetchTasks(user)
  }

  async function toggleDone(t: Task) {
    if (!user) return
    const admin = user.store === 'ALL'
    const canToggle = admin || t.assigned_to?.toUpperCase() === user.userid?.toUpperCase()
    if (!canToggle) { showToast('❌ Only the assigned user or admin can mark this done', 'err'); return }
    await supabase.from('tasks').update({ done: !t.done }).eq('id', t.id)
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x))
  }

  async function deleteTask(id: string) {
    const pw = prompt('Enter password to delete:')
    if (pw === null) return
    if (pw.toLowerCase() !== 'delete') { showToast('❌ Incorrect password', 'err'); setContextMenu(null); return }
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(x => x.id !== id))
    setContextMenu(null)
    showToast('🗑 Task deleted')
  }

  function openEdit(id: string) {
    const t = tasks.find(x => x.id === id)
    if (!t) return
    setEditingTask(t)
    setContextMenu(null)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingTask) return
    setEditSaving(true)
    const { error } = await supabase.from('tasks').update({
      task: editingTask.task,
      note: editingTask.note,
    }).eq('id', editingTask.id)
    setEditSaving(false)
    if (error) { showToast('❌ Update failed', 'err'); return }
    setEditingTask(null)
    showToast('✅ Task updated')
    if (user) fetchTasks(user)
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, id })
  }

  function formatDate(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${String(d.getFullYear()).slice(2)}`
  }

  function formatDateTime(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    const date = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${String(d.getFullYear()).slice(2)}`
    const h = d.getHours() % 12 || 12
    const m = String(d.getMinutes()).padStart(2, '0')
    const ampm = d.getHours() >= 12 ? 'PM' : 'AM'
    return `${date} ${h}:${m} ${ampm}`
  }

  const isAdmin = user?.store === 'ALL'

  const filtered = tasks.filter(t => {
    if (!showCompleted && t.done) return false
    const q = filter.toLowerCase()
    if (!q) return true
    return t.task.toLowerCase().includes(q) ||
      (t.note || '').toLowerCase().includes(q) ||
      (t.logged_by || '').toLowerCase().includes(q) ||
      (t.store || '').toLowerCase().includes(q)
  })

  const tdSt: React.CSSProperties = {
    padding: '7px 12px', fontSize: 12, borderBottom: '1px solid #e5e7eb', verticalAlign: 'middle',
  }

  return (
    <div style={{ minHeight: '100vh', background: tealLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}
      onClick={() => setContextMenu(null)}>
      <style>{`
        .tasks-header { padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); }
        .tasks-center { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; pointer-events: none; }
        .tasks-form { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .tasks-form-row { display: flex; align-items: center; gap: 8px; }
        .tasks-time-col { display: inline; }
        .tasks-search { width: 100%; max-width: 900px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .tasks-search input[type=text] { flex: 1; min-width: 120px; }
        .tasks-refresh { display: inline-block; }
        .tasks-table-wrap { display: block; }
        .tasks-cards { display: none; }
        @media (max-width: 600px) {
          .tasks-center { order: 3; width: 100%; }
          .tasks-time-col { display: none !important; }
          .tasks-form { flex-direction: column; align-items: stretch; gap: 6px; }
          .tasks-form-row { width: 100%; }
          .tasks-form-row label { min-width: 44px; flex-shrink: 0; }
          .tasks-form-row input { flex: 1; min-width: 0 !important; width: auto !important; }
          .tasks-form-submit { width: 100%; }
          .tasks-refresh { display: none !important; }
          .tasks-table-wrap { display: none; }
          .tasks-cards { display: block; padding: 8px 12px; }
          .tasks-search-row label { display: none; }
          .tasks-filter-meta { margin-top: 0 !important; }
          .tasks-search-combined { display: flex !important; }
          .tasks-search-stacked { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <div className="tasks-header">
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={goHome}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}>
            ← Home
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 12, color: '#60a5fa' }}>
            <span style={{ fontWeight: 700, color: tealD }}>{displayUser(user?.userid)}</span>
            {user?.store ? <> · {user.store === 'ALL' ? 'All Stores' : user.store}</> : ''}
          </span>
        </div>

        {/* Center */}
        <div className="tasks-center">
          <span style={{ fontSize: 18, color: '#1d4ed8' }}>☑</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: tealD, letterSpacing: '0.06em' }}>Tasks</span>
        </div>

        {/* Right */}
        <div className="tasks-refresh" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => user && fetchTasks(user)}
            style={{ background: '#dbeafe', border: 'none', color: '#1e3a8a', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Submit form */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 16px', display: 'flex', justifyContent: 'center' }}>
        <form onSubmit={addTask} className="tasks-form" style={{ width: '100%', maxWidth: 900, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="tasks-form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
            <label style={{ ...labelSt, color: tealD, whiteSpace: 'nowrap' }}>Task:</label>
            <input value={newTask} onChange={e => setNewTask(e.target.value)}
              placeholder="Describe the task…"
              style={{ ...inputSt, flex: 1, minWidth: 0 }} />
          </div>
          <div className="tasks-form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
            <label style={{ ...labelSt, color: tealD, whiteSpace: 'nowrap' }}>Note:</label>
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              placeholder="optional…"
              style={{ ...inputSt, flex: 1, minWidth: 0, width: 140 }} />
          </div>
          <div className="tasks-form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
            <label style={{ ...labelSt, color: tealD, whiteSpace: 'nowrap' }}>Assign to:</label>
            <select value={newAssignTo} onChange={e => setNewAssignTo(e.target.value)}
              style={{ ...inputSt, flex: 1, minWidth: 0, width: 140 }}>
              <option value="">— Nobody —</option>
              {allUsers.filter(u => u.userid !== user?.userid).map(u => (
                <option key={u.userid} value={u.userid}>{displayUser(u.userid)}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={saving || !newTask.trim()} className="tasks-form-submit"
            style={{ background: teal, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: saving || !newTask.trim() ? 'default' : 'pointer', opacity: saving || !newTask.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
            {saving ? '…' : '✓ Submit Task'}
          </button>
        </form>
      </div>

      {/* Search bar */}
      <div style={{ background: tealLight, borderBottom: `1px solid ${border}`, padding: '6px 12px' }}>
        {/* Mobile: single row with search + checkbox */}
        <div className="tasks-search-combined" style={{ display: 'none', alignItems: 'center', gap: 8 }}>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Search tasks…"
            style={{ ...inputSt, flex: 1, fontSize: 13 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} style={{ cursor: 'pointer', width: 16, height: 16, accentColor: teal }} />
            Done
          </label>
        </div>
        {/* Desktop: stacked layout */}
        <div className="tasks-search-stacked" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 900, margin: '0 auto' }}>
          <div className="tasks-search-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ ...labelSt, color: tealD, fontWeight: 700 }}>Search:</label>
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="task, note, store, user…"
              style={{ ...inputSt, flex: 1 }} />
          </div>
          <div className="tasks-filter-meta" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} style={{ cursor: 'pointer' }} />
              Show completed
            </label>
            <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{filtered.length} tasks</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="tasks-table-wrap" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {loading ? (
          <p style={{ padding: 24, color: teal, fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', maxWidth: 900 }}>
              <thead>
                <tr style={{ background: '#dbeafe', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['Date', 'Submitted By', 'Assigned To', 'Store', 'Task', 'Note', 'Done'].map(h => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: tealD, borderBottom: `2px solid ${border}`, whiteSpace: 'nowrap' }}>
                      {h === 'Date' ? <><span>Date</span><span className="tasks-time-col"> / Time</span></> : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No tasks found.</td></tr>
                )}
                {filtered.map((t, i) => {
                  const rowBg = t.done
                    ? (i % 2 === 0 ? '#dcfce7' : '#d1fae5')
                    : (i % 2 === 0 ? '#fff' : '#eff6ff')
                  const textColor = t.done ? '#15803d' : '#111827'
                  const dimColor = t.done ? '#16a34a' : '#6b7280'
                  const isAssigned = t.assigned_to?.toUpperCase() === user?.userid?.toUpperCase()
                  const canCheck = isAdmin || isAssigned
                  return (
                    <tr key={t.id} style={{ background: rowBg, cursor: 'context-menu' }}
                      onContextMenu={ev => handleRowRightClick(ev, t.id)}>
                      <td style={{ ...tdSt, color: dimColor, whiteSpace: 'nowrap', fontSize: 11 }}>
                        {formatDate(t.saved_at)}<span className="tasks-time-col" style={{ color: dimColor, fontSize: 10 }}> {formatDateTime(t.saved_at).split(' ').slice(1).join(' ')}</span>
                      </td>
                      <td style={{ ...tdSt, color: t.done ? '#15803d' : '#1d4ed8', fontWeight: 700 }}>{displayUser(t.logged_by)}</td>
                      <td style={{ ...tdSt, color: t.assigned_to ? (t.done ? '#15803d' : '#7c3aed') : dimColor, fontWeight: t.assigned_to ? 700 : 400 }}>
                        {t.assigned_to ? displayUser(t.assigned_to) : '—'}
                      </td>
                      <td style={{ ...tdSt, color: textColor, fontWeight: 600 }}>{t.store}</td>
                      <td style={{ ...tdSt, color: textColor, textDecoration: t.done ? 'line-through' : 'none' }}>{t.task}</td>
                      <td style={{ ...tdSt, color: dimColor }}>{t.note || ''}</td>
                      <td style={{ ...tdSt, textAlign: 'center' }}>
                        {canCheck ? (
                          <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)}
                            style={{ cursor: 'pointer', width: 14, height: 14, accentColor: teal }} />
                        ) : (
                          t.done
                            ? <span style={{ color: '#15803d', fontWeight: 800, fontSize: 14 }}>✓</span>
                            : <span style={{ color: '#d1d5db' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="tasks-cards"
        ref={scrollRef}
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; setPulling(false) }}
        onTouchMove={e => {
          const el = scrollRef.current
          if (!el) return
          const dy = e.touches[0].clientY - touchStartY.current
          if (el.scrollTop === 0 && dy > 0) { setPullY(Math.min(dy, 72)); setPulling(true) }
          else { setPullY(0); setPulling(false) }
        }}
        onTouchEnd={() => {
          if (pullY > 50 && user) { fetchTasks(user); showToast('🔄 Refreshed') }
          setPullY(0); setPulling(false)
        }}
        style={{ overflowY: 'auto' }}
      >
        {pulling && pullY > 10 && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: teal, opacity: Math.min(pullY / 50, 1) }}>
            {pullY > 50 ? '↑ Release to refresh' : '↓ Pull to refresh'}
          </div>
        )}
        {loading ? (
          <p style={{ padding: 24, color: teal, fontSize: 13 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No tasks found.</p>
        ) : filtered.map((t, i) => {
          const cardBg = t.done ? '#dcfce7' : '#fff'
          const textColor = t.done ? '#15803d' : '#111827'
          const dimColor = t.done ? '#16a34a' : '#6b7280'
          const isAssigned = t.assigned_to?.toUpperCase() === user?.userid?.toUpperCase()
          const canCheck = isAdmin || isAssigned
          return (
            <div key={t.id} style={{ background: cardBg, border: `1px solid ${t.done ? '#86efac' : border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}
              onContextMenu={ev => handleRowRightClick(ev, t.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                {canCheck ? (
                  <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)}
                    style={{ cursor: 'pointer', width: 18, height: 18, accentColor: teal, flexShrink: 0, marginTop: 2 }} />
                ) : t.done ? (
                  <span style={{ color: '#15803d', fontWeight: 800, fontSize: 16, flexShrink: 0, marginTop: 1 }}>✓</span>
                ) : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: textColor, textDecoration: t.done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{t.task}</div>
                  {t.assigned_to && (
                    <div style={{ fontSize: 11, color: t.done ? '#15803d' : '#7c3aed', fontWeight: 700, marginTop: 2 }}>
                      → {displayUser(t.assigned_to)}
                    </div>
                  )}
                  {t.note ? (
                    <div style={{ fontSize: 12, color: dimColor, marginTop: 3, wordBreak: 'break-word' }}>
                      <span style={{ fontWeight: 700 }}>Note: </span>{t.note}
                    </div>
                  ) : null}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: dimColor }}>
                <span style={{ fontWeight: 700, color: t.done ? '#15803d' : '#1d4ed8' }}>{displayUser(t.logged_by)}</span>
                <span>·</span>
                <span>{t.store}</span>
                <span>·</span>
                <span>{formatDate(t.saved_at)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div style={{
          position: 'fixed', top: contextMenu.y, left: contextMenu.x,
          background: '#fff', border: `1px solid ${border}`, borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 200, overflow: 'hidden', minWidth: 120,
        }} onClick={e => e.stopPropagation()}>
          <button onClick={() => openEdit(contextMenu.id)}
            style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: tealD, fontWeight: 600, cursor: 'pointer' }}>
            ✏️ Edit
          </button>
          <div style={{ height: 1, background: border }} />
          <button onClick={() => deleteTask(contextMenu.id)}
            style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 13, color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>
            🗑 Delete
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editingTask && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setEditingTask(null) }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: tealD, marginBottom: 18, textAlign: 'center' }}>Edit Task</div>
            <form onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ ...labelSt, display: 'block', marginBottom: 4 }}>Task</label>
                <input value={editingTask.task}
                  onChange={e => setEditingTask(prev => prev ? { ...prev, task: e.target.value } : prev)}
                  style={{ ...inputSt, width: '100%' }} />
              </div>
              <div>
                <label style={{ ...labelSt, display: 'block', marginBottom: 4 }}>Note</label>
                <input value={editingTask.note || ''}
                  onChange={e => setEditingTask(prev => prev ? { ...prev, note: e.target.value } : prev)}
                  placeholder="optional…" style={{ ...inputSt, width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setEditingTask(null)}
                  style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={editSaving}
                  style={{ flex: 2, background: teal, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: editSaving ? 0.7 : 1 }}>
                  {editSaving ? '…' : '✓ Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: toastType === 'err' ? '#7f1d1d' : '#1e3a8a',
          color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
        }}>{toast}</div>
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

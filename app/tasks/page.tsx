'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Task, User } from '@/lib/types'

const teal = '#0d9488'
const tealD = '#0f766e'
const tealLight = '#f0fdfa'
const border = '#ccfbf1'

export default function TasksPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [filter, setFilter] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchTasks(u)
  }, [router])

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchTasks(u: User) {
    setLoading(true)
    let q = supabase.from('tasks').select('*').order('saved_at', { ascending: false })
    // Store filter: ALL sees everything, others see only their store
    if (u.store !== 'ALL') q = q.eq('store', u.store)
    const { data, error } = await q
    if (error) showToast('❌ Could not load tasks', 'err')
    else setTasks((data as Task[]) || [])
    setLoading(false)
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
    })
    if (error) { showToast('❌ Error saving task', 'err'); setSaving(false); return }
    setNewTask(''); setNewNote('')
    showToast('✅ Task added')
    setSaving(false)
    fetchTasks(user)
  }

  async function toggleDone(t: Task) {
    // Only admin (store === 'ALL') can mark done
    if (!user || user.store !== 'ALL') {
      showToast('❌ Only admin can mark tasks done', 'err'); return
    }
    const { error } = await supabase.from('tasks').update({ done: !t.done }).eq('id', t.id)
    if (error) { showToast('❌ Update failed', 'err'); return }
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x))
  }

  async function saveChanges() {
    showToast('✅ Changes saved')
    if (user) fetchTasks(user)
  }

  function formatDate(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
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
    padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #e5e7eb', verticalAlign: 'middle',
  }

  return (
    <div style={{ minHeight: '100vh', background: tealLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: tealLight, border: `1px solid ${border}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, color: teal, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            🏠 Home
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: tealD, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>☑</span> Tasks
          </span>
          {user && (
            <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>
              · <span style={{ fontWeight: 700, color: teal }}>{user.userid}</span>
              {user.store ? ` · ${user.store === 'ALL' ? 'All Stores' : user.store}` : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={saveChanges}
            style={{ background: teal, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            💾 Save Changes
          </button>
          <button onClick={() => user && fetchTasks(user)}
            style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: teal, cursor: 'pointer' }}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Submit form */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '12px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: teal, marginBottom: 8 }}>Submit a Task Request</div>
        <form onSubmit={addTask} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={labelSt}>Task:</label>
            <input value={newTask} onChange={e => setNewTask(e.target.value)}
              placeholder="Describe the task…"
              style={{ ...inputSt, width: 280 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={labelSt}>Note:</label>
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              placeholder="optional…"
              style={{ ...inputSt, width: 200 }} />
          </div>
          <button type="submit" disabled={saving || !newTask.trim()}
            style={{ background: teal, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 700, cursor: saving || !newTask.trim() ? 'default' : 'pointer', opacity: saving || !newTask.trim() ? 0.6 : 1 }}>
            {saving ? '…' : '✓ Submit Task'}
          </button>
        </form>
      </div>

      {/* Filter bar */}
      <div style={{ background: tealLight, borderBottom: `1px solid ${border}`, padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelSt}>Filter:</label>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="search tasks…"
            style={{ ...inputSt, width: 160 }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)}
            style={{ cursor: 'pointer' }} />
          Show completed
        </label>
        <span style={{ fontSize: 11, color: '#9b8ec4', marginLeft: 'auto' }}>{filtered.length} tasks</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', padding: '0 16px 16px' }}>
        {loading ? (
          <p style={{ padding: 24, color: teal, fontSize: 13 }}>Loading…</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
            <thead>
              <tr style={{ background: '#e6f7f5', position: 'sticky', top: 0, zIndex: 1 }}>
                {['Date', 'Submitted By', 'Store ID', 'Task', 'Note', 'Done'].map(h => (
                  <th key={h} style={{
                    padding: '7px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                    color: tealD, borderBottom: `2px solid ${border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No tasks found.</td></tr>
              )}
              {filtered.map((t, i) => {
                const rowBg = t.done
                  ? (i % 2 === 0 ? '#dcfce7' : '#d1fae5')
                  : (i % 2 === 0 ? '#fff' : '#f0fdfa')
                const textColor = t.done ? '#15803d' : '#111827'
                const dimColor = t.done ? '#16a34a' : '#6b7280'
                return (
                  <tr key={t.id} style={{ background: rowBg }}>
                    <td style={{ ...tdSt, color: dimColor, whiteSpace: 'nowrap', fontSize: 11 }}>{formatDate(t.saved_at)}</td>
                    <td style={{ ...tdSt, color: t.done ? '#15803d' : teal, fontWeight: 700 }}>{t.logged_by}</td>
                    <td style={{ ...tdSt, color: textColor, fontWeight: 600 }}>{t.store}</td>
                    <td style={{ ...tdSt, color: textColor, textDecoration: t.done ? 'line-through' : 'none' }}>{t.task}</td>
                    <td style={{ ...tdSt, color: dimColor }}>{t.note || ''}</td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      {isAdmin ? (
                        <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)}
                          style={{ cursor: 'pointer', width: 14, height: 14, accentColor: teal }} />
                      ) : (
                        t.done
                          ? <span style={{ color: teal, fontWeight: 800, fontSize: 14 }}>✓</span>
                          : <span style={{ color: '#d1d5db' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: toastType === 'err' ? '#7f1d1d' : '#134e4a',
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

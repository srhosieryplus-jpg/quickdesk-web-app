'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Task, User } from '@/lib/types'

export default function TasksPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchTasks(u)
  }, [router])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchTasks(u: User) {
    setLoading(true)
    let q = supabase.from('tasks').select('*').order('saved_at', { ascending: false })
    if (u.store !== 'ALL') q = q.eq('store', u.store)
    const { data } = await q
    setTasks(data as Task[] || [])
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
    if (error) { showToast('❌ Error saving task'); setSaving(false); return }
    setNewTask(''); setNewNote('')
    showToast('✅ Task added')
    setSaving(false)
    fetchTasks(user)
  }

  async function toggleDone(t: Task) {
    await supabase.from('tasks').update({ done: !t.done }).eq('id', t.id)
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x))
  }

  async function deleteTask(id: string) {
    if (!confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(x => x.id !== id))
    showToast('🗑 Task deleted')
  }

  const open = tasks.filter(t => !t.done)
  const done = tasks.filter(t => t.done)

  return (
    <div style={{ minHeight:'100vh', padding:20 }}>
      <div style={{ maxWidth:680, margin:'0 auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <button className="btn btn-ghost" style={{ fontSize:12 }} onClick={() => router.push('/selector')}>← Back</button>
          <h2 style={{ fontSize:18, fontWeight:700 }}>✅ Tasks</h2>
          {user && <span style={{ fontSize:12, color:'#888', marginLeft:'auto' }}>{user.store}</span>}
        </div>

        {/* Add task form */}
        <form onSubmit={addTask} className="card" style={{ marginBottom:20, display:'flex', flexDirection:'column', gap:10 }}>
          <h3 style={{ fontSize:13, color:'#aaa', fontWeight:600 }}>Add Task</h3>
          <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="Task description…" />
          <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Note (optional)" />
          <button className="btn btn-primary" type="submit" disabled={saving || !newTask.trim()} style={{ alignSelf:'flex-start' }}>
            {saving ? 'Saving…' : '+ Add'}
          </button>
        </form>

        {/* Open tasks */}
        {loading ? (
          <p style={{ color:'#888', fontSize:13 }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize:12, color:'#888', marginBottom:8 }}>OPEN ({open.length})</p>
            {open.length === 0 && <p style={{ color:'#555', fontSize:13, marginBottom:16 }}>No open tasks.</p>}
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
              {open.map(t => (
                <TaskRow key={t.id} task={t} onToggle={toggleDone} onDelete={deleteTask} />
              ))}
            </div>

            {done.length > 0 && (
              <>
                <p style={{ fontSize:12, color:'#888', marginBottom:8 }}>DONE ({done.length})</p>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {done.map(t => (
                    <TaskRow key={t.id} task={t} onToggle={toggleDone} onDelete={deleteTask} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete }: {
  task: Task
  onToggle: (t: Task) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="card" style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
      <input type="checkbox" checked={task.done} onChange={() => onToggle(task)}
        style={{ width:16, height:16, marginTop:2, cursor:'pointer', flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:13, textDecoration: task.done ? 'line-through' : 'none', color: task.done ? '#555' : '#e8e8e8' }}>
          {task.task}
        </p>
        {task.note && <p style={{ fontSize:12, color:'#888', marginTop:2 }}>{task.note}</p>}
        <p style={{ fontSize:11, color:'#555', marginTop:4 }}>
          {task.logged_by} · {new Date(task.saved_at).toLocaleDateString()}
        </p>
      </div>
      <button onClick={() => onDelete(task.id)} style={{ background:'none', border:'none', color:'#555', cursor:'pointer', fontSize:15, padding:'0 2px' }}>🗑</button>
    </div>
  )
}

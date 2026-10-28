'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { IcLog, User } from '@/lib/types'

const STATUSES = ['Pending','Pushed','Issue','Complete']

export default function IcLogPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [logs, setLogs] = useState<IcLog[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ order_num:'', status:'Pending', po_num:'', qty_pushed:'', note:'' })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchLogs(u)
  }, [router])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function fetchLogs(u: User) {
    setLoading(true)
    let q = supabase.from('ic_log').select('*').order('saved_at', { ascending: false })
    if (u.store !== 'ALL') q = q.eq('store', u.store)
    const { data } = await q
    setLogs(data as IcLog[] || [])
    setLoading(false)
  }

  async function addLog(e: React.FormEvent) {
    e.preventDefault()
    if (!form.order_num.trim() || !user) return
    setSaving(true)
    const { error } = await supabase.from('ic_log').insert({
      store: user.store, logged_by: user.userid,
      order_num: form.order_num.trim(), status: form.status,
      po_num: form.po_num.trim(), qty_pushed: form.qty_pushed.trim(), note: form.note.trim(),
    })
    if (error) { showToast('❌ Error saving'); setSaving(false); return }
    setForm({ order_num:'', status:'Pending', po_num:'', qty_pushed:'', note:'' })
    showToast('✅ Entry added')
    setSaving(false)
    fetchLogs(user!)
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('ic_log').update({ status }).eq('id', id)
    setLogs(prev => prev.map(x => x.id === id ? { ...x, status } : x))
  }

  async function deleteLog(id: string) {
    if (!confirm('Delete?')) return
    await supabase.from('ic_log').delete().eq('id', id)
    setLogs(prev => prev.filter(x => x.id !== id))
    showToast('🗑 Deleted')
  }

  const visible = filter === 'All' ? logs : logs.filter(l => l.status === filter)

  return (
    <div style={{ minHeight:'100vh', padding:20, background:'#f0f2f5' }}>
      <div style={{ maxWidth:800, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <button className="btn btn-ghost" style={{ fontSize:12 }} onClick={() => router.push('/selector')}>← Back</button>
          <h2 style={{ fontSize:18, fontWeight:700, color:'#111' }}>📦 IC Log</h2>
          {user && <span style={{ fontSize:12, color:'#666', marginLeft:'auto' }}>{user.store}</span>}
        </div>

        <form onSubmit={addLog} style={{ background:'#fff', border:'1px solid #e2e6ea', borderRadius:10, padding:16, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', marginBottom:20, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
          <div style={{ gridColumn:'1/-1' }}><h3 style={{ fontSize:13, color:'#666', fontWeight:600 }}>Add Entry</h3></div>
          <input placeholder="Order # *" value={form.order_num} onChange={e => setForm(f=>({...f,order_num:e.target.value}))} />
          <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <input placeholder="PO #" value={form.po_num} onChange={e => setForm(f=>({...f,po_num:e.target.value}))} />
          <input placeholder="Qty Pushed" value={form.qty_pushed} onChange={e => setForm(f=>({...f,qty_pushed:e.target.value}))} />
          <input placeholder="Note" value={form.note} onChange={e => setForm(f=>({...f,note:e.target.value}))} style={{ gridColumn:'span 2' }} />
          <button className="btn btn-primary" type="submit" disabled={saving || !form.order_num.trim()} style={{ gridColumn:'1/-1', justifyContent:'center' }}>
            {saving ? 'Saving…' : '+ Add Entry'}
          </button>
        </form>

        <div style={{ display:'flex', gap:6, marginBottom:12 }}>
          {['All',...STATUSES].map(s => (
            <button key={s} onClick={() => setFilter(s)} className="btn"
              style={{ fontSize:11, padding:'4px 10px', background: filter===s ? '#2563eb' : '#e2e6ea', color: filter===s ? '#fff' : '#333' }}>
              {s}
            </button>
          ))}
        </div>

        {loading ? <p style={{ color:'#666', fontSize:13 }}>Loading…</p> : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {visible.length === 0 && <p style={{ color:'#999', fontSize:13 }}>No entries.</p>}
            {visible.map(log => (
              <div key={log.id} style={{ background:'#fff', border:'1px solid #e2e6ea', borderRadius:10, padding:14, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', display:'grid', gridTemplateColumns:'1fr 120px 1fr auto', gap:10, alignItems:'center' }}>
                <div>
                  <p style={{ fontSize:13, fontWeight:500, color:'#111' }}>{log.order_num}</p>
                  <p style={{ fontSize:11, color:'#666' }}>PO: {log.po_num || '—'} · Qty: {log.qty_pushed || '—'}</p>
                </div>
                <select value={log.status} onChange={e => updateStatus(log.id, e.target.value)} style={{ fontSize:12, padding:'4px 6px' }}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                <div>
                  {log.note && <p style={{ fontSize:12, color:'#666' }}>{log.note}</p>}
                  <p style={{ fontSize:11, color:'#999' }}>{log.logged_by} · {new Date(log.saved_at).toLocaleDateString()}</p>
                </div>
                <button onClick={() => deleteLog(log.id)} style={{ background:'none', border:'none', color:'#aaa', cursor:'pointer', fontSize:15 }}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

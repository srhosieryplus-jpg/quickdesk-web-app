'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { SeasonLog, User } from '@/lib/types'

function SeasonLogInner() {
  const router = useRouter()
  const params = useSearchParams()
  const seasonType = params.get('type') || 'SS'

  const [user, setUser] = useState<User | null>(null)
  const [logs, setLogs] = useState<SeasonLog[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ vendor:'', invoice:'', po_num:'', note:'' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
    fetchLogs(u)
  }, [router, seasonType])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function fetchLogs(u: User) {
    setLoading(true)
    let q = supabase.from('season_log').select('*').eq('season_type', seasonType).order('saved_at', { ascending: false })
    if (u.store !== 'ALL') q = q.eq('store', u.store)
    const { data } = await q
    setLogs(data as SeasonLog[] || [])
    setLoading(false)
  }

  async function addLog(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vendor.trim() || !user) return
    setSaving(true)
    const { error } = await supabase.from('season_log').insert({
      season_type: seasonType, store: user.store, location: user.location,
      vendor: form.vendor.trim(), invoice: form.invoice.trim(),
      po_num: form.po_num.trim(), note: form.note.trim(), logged_by: user.userid,
    })
    if (error) { showToast('❌ Error saving'); setSaving(false); return }
    setForm({ vendor:'', invoice:'', po_num:'', note:'' })
    showToast('✅ Entry added')
    setSaving(false)
    fetchLogs(user!)
  }

  async function deleteLog(id: string) {
    if (!confirm('Delete this entry?')) return
    await supabase.from('season_log').delete().eq('id', id)
    setLogs(prev => prev.filter(x => x.id !== id))
    showToast('🗑 Entry deleted')
  }

  const icon = seasonType === 'SS' ? '☀️' : '🍂'
  const label = seasonType === 'SS' ? 'Spring/Summer' : 'Autumn/Winter'

  return (
    <div style={{ minHeight:'100vh', padding:20, background:'#f0f2f5' }}>
      <div style={{ maxWidth:780, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <button className="btn btn-ghost" style={{ fontSize:12 }} onClick={() => router.push('/selector')}>← Back</button>
          <h2 style={{ fontSize:18, fontWeight:700, color:'#111' }}>{icon} Season Log — {label}</h2>
          {user && <span style={{ fontSize:12, color:'#666', marginLeft:'auto' }}>{user.store}</span>}
        </div>

        <form onSubmit={addLog} style={{ background:'#fff', border:'1px solid #e2e6ea', borderRadius:10, padding:16, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', marginBottom:20, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div style={{ gridColumn:'1/-1' }}><h3 style={{ fontSize:13, color:'#666', fontWeight:600 }}>Add Entry</h3></div>
          <input placeholder="Vendor *" value={form.vendor} onChange={e => setForm(f=>({...f,vendor:e.target.value}))} />
          <input placeholder="Invoice #" value={form.invoice} onChange={e => setForm(f=>({...f,invoice:e.target.value}))} />
          <input placeholder="PO #" value={form.po_num} onChange={e => setForm(f=>({...f,po_num:e.target.value}))} />
          <input placeholder="Note" value={form.note} onChange={e => setForm(f=>({...f,note:e.target.value}))} />
          <button className="btn btn-primary" type="submit" disabled={saving || !form.vendor.trim()} style={{ gridColumn:'1/-1', justifyContent:'center' }}>
            {saving ? 'Saving…' : '+ Add Entry'}
          </button>
        </form>

        {loading ? <p style={{ color:'#666', fontSize:13 }}>Loading…</p> : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {logs.length === 0 && <p style={{ color:'#999', fontSize:13 }}>No entries yet.</p>}
            {logs.map(log => (
              <div key={log.id} style={{ background:'#fff', border:'1px solid #e2e6ea', borderRadius:10, padding:14, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:10, alignItems:'center' }}>
                <div>
                  <p style={{ fontSize:13, fontWeight:500, color:'#111' }}>{log.vendor}</p>
                  <p style={{ fontSize:11, color:'#666' }}>{log.invoice || '—'}</p>
                </div>
                <div>
                  <p style={{ fontSize:12, color:'#666' }}>PO: {log.po_num || '—'}</p>
                  <p style={{ fontSize:12, color:'#888' }}>{log.store}</p>
                </div>
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

export default function SeasonLogPage() {
  return <Suspense fallback={<div style={{padding:20,color:'#666'}}>Loading…</div>}><SeasonLogInner /></Suspense>
}

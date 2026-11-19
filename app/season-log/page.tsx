'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { SeasonLog, User } from '@/lib/types'

// Match edit-sheet pink theme
const accent  = '#db2777'
const accentD = '#831843'
const accentB = '#f9a8d4'
const accentL = '#fdf2f8'
const gray    = '#9ca3af'

function SeasonLogInner() {
  const router = useRouter()
  const params = useSearchParams()
  const seasonType = params.get('type') || 'SS'

  const [user, setUser]       = useState<User | null>(null)
  const [logs, setLogs]       = useState<SeasonLog[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState('')
  const [form, setForm]       = useState({ vendor:'', invoice:'', po_num:'', note:'' })
  const [saving, setSaving]   = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 600)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

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
      season_type: seasonType,
      store: user.store,
      location: user.location,
      vendor: form.vendor.trim(),
      invoice: form.invoice.trim(),
      po_num: form.po_num.trim(),
      note: form.note.trim(),
      logged_by: user.userid,
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
  const isAdmin = user?.store === 'ALL'

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '7px 10px',
    border: `1px solid ${accentB}`, borderRadius: 7, fontSize: 13,
    fontFamily: 'inherit', outline: 'none', background: '#fff',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: 'Inter, sans-serif' }}>

      {/* Header — matches edit-sheet dark pink bar */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: accentD, color: '#fff' }}>
        <button onClick={() => router.push('/selector')}
          style={{ background: 'none', border: 'none', fontSize: 12, color: accentB, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
          ← Back
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>{icon} Season Log — {label}</h2>
        {user && <span style={{ fontSize: 12, color: accentB, marginLeft: 'auto' }}>{user.store === 'ALL' ? 'All Stores' : user.store}</span>}
      </div>

      <div style={{ maxWidth: isMobile ? '100%' : 820, margin: '0 auto', padding: isMobile ? '10px' : '16px' }}>

        {/* Add form */}
        <form onSubmit={addLog} style={{ background: '#fff', border: `1px solid ${accentB}`, borderRadius: 10, padding: 14, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: accentD, marginBottom: 10 }}>Add Entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input style={inp} placeholder="Brand *" value={form.vendor} onChange={e => setForm(f=>({...f,vendor:e.target.value}))} />
            <input style={inp} placeholder="Invoice #" value={form.invoice} onChange={e => setForm(f=>({...f,invoice:e.target.value}))} />
            <input style={inp} placeholder="PO #" value={form.po_num} onChange={e => setForm(f=>({...f,po_num:e.target.value}))} />
            <input style={inp} placeholder="Note" value={form.note} onChange={e => setForm(f=>({...f,note:e.target.value}))} />
          </div>
          <button type="submit" disabled={saving || !form.vendor.trim()}
            style={{ width: '100%', background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : '+ Add Entry'}
          </button>
        </form>

        {loading ? <p style={{ color: '#666', fontSize: 13 }}>Loading…</p> : (<>

          {logs.length === 0 && <p style={{ color: '#999', fontSize: 13 }}>No entries yet.</p>}

          {/* ── Mobile cards (matches edit-sheet es-brand-rows style) ── */}
          {isMobile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {logs.map((log, i) => (
                <div key={log.id}
                  style={{ background: i % 2 === 0 ? '#fff' : '#fdf8fb', border: `1px solid ${accentB}`, borderRadius: 8, padding: '8px 12px' }}>

                  {/* Top row: Store – Brand – Invoice# – PO# */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden', marginBottom: 5 }}>
                    {isAdmin && (
                      <>
                        <span style={{ fontSize: 14, fontWeight: 800, color: accent, whiteSpace: 'nowrap', flexShrink: 0 }}>{log.store}</span>
                        <span style={{ color: accentB, fontSize: 12, flexShrink: 0 }}>–</span>
                      </>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 800, color: accentD, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>
                      {log.vendor}
                    </span>
                    <span style={{ color: accentB, fontSize: 12, flexShrink: 0 }}>–</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: accent, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {log.invoice || '—'}
                    </span>
                    <span style={{ color: accentB, fontSize: 12, flexShrink: 0 }}>–</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: log.po_num ? accent : gray, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {log.po_num || '—'}
                    </span>
                  </div>

                  {/* Bottom row: logged-by+date pill left · delete right */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: accentD, background: accentL, border: `1px solid ${accentB}`, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                        {log.logged_by} · {new Date(log.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      {log.note && (
                        <span style={{ fontSize: 10, color: gray, fontStyle: 'italic' }}>{log.note}</span>
                      )}
                    </div>
                    <button onClick={() => deleteLog(log.id)}
                      style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 15, padding: '0 0 0 8px', flexShrink: 0 }}>
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Desktop table ── */}
          {!isMobile && (
            <div style={{ background: '#fff', border: `1px solid ${accentB}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: accentL, borderBottom: `1px solid ${accentB}` }}>
                    {isAdmin && <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: accentD, fontSize: 11 }}>Store</th>}
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: accentD, fontSize: 11 }}>Brand</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: accentD, fontSize: 11 }}>Invoice #</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: accentD, fontSize: 11 }}>PO #</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: accentD, fontSize: 11 }}>Note</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: accentD, fontSize: 11 }}>Logged</th>
                    <th style={{ padding: '8px 12px', width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={log.id} style={{ background: i % 2 === 0 ? '#fff' : '#fdf8fb', borderBottom: `1px solid #fce7f3` }}>
                      {isAdmin && <td style={{ padding: '8px 12px', fontWeight: 700, color: accent }}>{log.store}</td>}
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: accentD }}>{log.vendor}</td>
                      <td style={{ padding: '8px 12px', color: '#555' }}>{log.invoice || '—'}</td>
                      <td style={{ padding: '8px 12px', color: log.po_num ? accent : gray, fontWeight: log.po_num ? 600 : 400 }}>{log.po_num || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#888', fontStyle: log.note ? 'italic' : 'normal' }}>{log.note || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#888', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {log.logged_by} · {new Date(log.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <button onClick={() => deleteLog(log.id)}
                          style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 14 }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </>)}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: accentD, color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

export default function SeasonLogPage() {
  return <Suspense fallback={<div style={{padding:20,color:'#666'}}>Loading…</div>}><SeasonLogInner /></Suspense>
}

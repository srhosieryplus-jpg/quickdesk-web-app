'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id:'tasks',      label:'Tasks',        icon:'✅', path:'/tasks' },
  { id:'season_ss',  label:'Season SS',    icon:'☀️', path:'/season-log?type=SS' },
  { id:'season_aw',  label:'Season AW',    icon:'🍂', path:'/season-log?type=AW' },
  { id:'ic',         label:'IC Log',       icon:'📦', path:'/ic-log' },
  { id:'po_tracker', label:'PO Tracker',   icon:'📊', path:'/po-tracker' },
  { id:'qd',         label:'QuickDesk',    icon:'📋', path:'/quickdesk' },
  { id:'autocsv',    label:'Auto CSV',     icon:'📤', path:'/autocsv' },
  { id:'reports',    label:'Reports',      icon:'📈', path:'/reports' },
  { id:'settings',   label:'Settings',     icon:'⚙️', path:'/settings' },
]

export default function SelectorPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  if (!user) return null

  const modules = ALL_MODULES.filter(m => user.modules.includes(m.id))

  return (
    <div style={{ minHeight:'100vh', padding:20, background:'#f0f2f5' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28, maxWidth:700, margin:'0 auto 28px' }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:700, color:'#111' }}>📋 QuickDesk</h1>
          <p style={{ fontSize:12, color:'#666', marginTop:2 }}>
            {user.userid} · {user.store} · {user.location}
          </p>
        </div>
        <button className="btn btn-ghost" style={{ fontSize:12 }}
          onClick={() => { clearSession(); router.push('/') }}>
          Sign out
        </button>
      </div>
      <div style={{ maxWidth:700, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:12 }}>
        {modules.map(m => (
          <button key={m.id}
            onClick={() => router.push(m.path)}
            style={{
              display:'flex', flexDirection:'column', alignItems:'center',
              gap:8, padding:'20px 12px', cursor:'pointer',
              border:'1px solid #e2e6ea', background:'#ffffff',
              borderRadius:10, boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
              transition:'border-color 0.15s'
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor='#2563eb')}
            onMouseLeave={e => (e.currentTarget.style.borderColor='#e2e6ea')}
          >
            <span style={{ fontSize:28 }}>{m.icon}</span>
            <span style={{ fontSize:13, fontWeight:500, color:'#111' }}>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

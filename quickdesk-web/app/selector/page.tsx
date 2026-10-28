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

  // Same honeycomb logic as login
  const S = 28
  const W = S * Math.sqrt(3)
  const H = S * 2
  const cols = 32
  const rows = 22
  const hexes: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      hexes.push({ x: c * W + (r % 2 === 0 ? 0 : W / 2), y: r * H * 0.75 })
    }
  }
  function hexPoints(cx: number, cy: number) {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6
      return `${cx + S * Math.cos(a)},${cy + S * Math.sin(a)}`
    }).join(' ')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6' }}>
      <div style={{ padding: '24px 20px', maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Mini QD hex */}
            <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
              <polygon points="18,2 34,11 34,31 18,40 2,31 2,11" fill="rgba(124,58,237,0.08)" stroke="#7c3aed" strokeWidth="2" />
              <text x="18" y="22" textAnchor="middle" dominantBaseline="middle" fill="#5b21b6" fontSize="9" fontWeight="900" fontFamily="-apple-system,sans-serif" letterSpacing="1">QD</text>
            </svg>
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.06em' }}>QUICKDESK</h1>
              <p style={{ fontSize: 11, color: '#9b8ec4', marginTop: 1 }}>
                {user.userid} · {user.store} · {user.location}
              </p>
            </div>
          </div>
          <button
            onClick={() => { clearSession(); router.push('/') }}
            style={{ background: 'rgba(255,255,255,0.8)', border: '1.5px solid #d4c8f0', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 700, color: '#7c3aed', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>

        {/* Module grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: 14,
        }}>
          {modules.map(m => (
            <button
              key={m.id}
              onClick={() => router.push(m.path)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 10, padding: '22px 12px', cursor: 'pointer',
                border: '1.5px solid #d4c8f0',
                background: 'rgba(255,255,255,0.82)',
                borderRadius: 14,
                boxShadow: '0 2px 12px rgba(124,58,237,0.07)',
                backdropFilter: 'blur(6px)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#7c3aed'
                e.currentTarget.style.background = 'rgba(255,255,255,0.97)'
                e.currentTarget.style.boxShadow = '0 4px 18px rgba(124,58,237,0.15)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#d4c8f0'
                e.currentTarget.style.background = 'rgba(255,255,255,0.82)'
                e.currentTarget.style.boxShadow = '0 2px 12px rgba(124,58,237,0.07)'
              }}
            >
              <span style={{ fontSize: 30 }}>{m.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#5b21b6', letterSpacing: '0.02em' }}>{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

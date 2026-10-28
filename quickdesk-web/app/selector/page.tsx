'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id:'tasks',      label:'Tasks',        icon:'☑', path:'/tasks',               bg:'#b8f0e6', iconColor:'#1a6b5a' },
  { id:'season_ss',  label:'SS',           icon:'✦',  path:'/season-log?type=SS',  bg:'#fde68a', iconColor:'#92400e' },
  { id:'season_aw',  label:'AW',           icon:'✻',  path:'/season-log?type=AW',  bg:'#bfdbfe', iconColor:'#1e40af' },
  { id:'ic',         label:'IC Log',       icon:'∞',  path:'/ic-log',              bg:'#e9d5ff', iconColor:'#6b21a8' },
  { id:'po_tracker', label:'PO Tracker',   icon:'⊞',  path:'/po-tracker',          bg:'#fbcfe8', iconColor:'#9d174d' },
  { id:'qd',         label:'QuickDesk',    icon:'≡',  path:'/quickdesk',           bg:'#fca5a5', iconColor:'#7f1d1d' },
  { id:'autocsv',    label:'Auto CSV',     icon:'⚡', path:'/autocsv',             bg:'#fcd34d', iconColor:'#78350f' },
  { id:'reports',    label:'Reports',      icon:'⊡',  path:'/reports',             bg:'#6ee7b7', iconColor:'#065f46' },
  { id:'settings',   label:'Settings',     icon:'✿',  path:'/settings',            bg:'#e2e8f0', iconColor:'#334155' },
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
    <div style={{ minHeight: '100vh', background: '#eeeaf6' }}>

      {/* Header */}
      <div style={{
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #d4c8f0',
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(8px)',
      }}>
        {/* Left: logo + location */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
            <polygon points="11,1 21,7 21,19 11,25 1,19 1,7" fill="none" stroke="#7c3aed" strokeWidth="2" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>QUICKDESK</span>
          <span style={{ color: '#c4b5fd', fontSize: 16, fontWeight: 300, margin: '0 4px' }}>—</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#7c3aed' }}>{user.location || 'Admin'}</span>
        </div>

        {/* Right: user info + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <button
            onClick={() => { clearSession(); router.push('/') }}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}
          >Sign Out</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontSize: 14 }}>👤</span>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{user.userid}</span>
            <span>·</span>
            <span>{user.store === 'ALL' ? 'All Stores' : user.store}</span>
          </div>
        </div>
      </div>

      {/* Page title */}
      <div style={{ padding: '28px 28px 16px', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#3b1f8c', marginBottom: 4 }}>Select a Module</h2>
        <p style={{ fontSize: 12, color: '#9b8ec4' }}>— choose a module to begin</p>
      </div>

      {/* Module grid */}
      <div style={{
        padding: '0 28px 40px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 140px)',
        gap: 14,
        maxWidth: 720,
        margin: '0 auto',
        justifyContent: 'center',
      }}>
        {modules.map(m => (
          <button
            key={m.id}
            onClick={() => router.push(m.path)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '22px 12px',
              cursor: 'pointer',
              border: 'none',
              background: m.bg,
              borderRadius: 16,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              transition: 'transform 0.12s, box-shadow 0.12s',
              aspectRatio: '1',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-3px)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            <span style={{ fontSize: 28, color: m.iconColor, lineHeight: 1 }}>{m.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: m.iconColor, letterSpacing: '0.02em', textAlign: 'center' }}>
              {m.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

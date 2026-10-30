'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id:'tasks',      label:'Tasks',              icon:'☑',  path:'/tasks',               bg:'#b8f0e6', iconColor:'#1a6b5a' },
  { id:'season_ss',  label:'SS',                 icon:'sun', path:'/season-log?type=SS',  bg:'#fde68a', iconColor:'#92400e' },
  { id:'season_aw',  label:'AW',                 icon:'✻',  path:'/season-log?type=AW',  bg:'#bfdbfe', iconColor:'#1e40af' },
  { id:'ic',         label:'Infinity Classics',  icon:'∞',  path:'/ic-log',              bg:'#e9d5ff', iconColor:'#6b21a8' },
  { id:'po_tracker', label:'PO Tracker',         icon:'⊞',  path:'/po-tracker',          bg:'#fbcfe8', iconColor:'#9d174d' },
  { id:'qd',         label:'UPC Scanner',        icon:'barcode', path:'/quickdesk',       bg:'#fca5a5', iconColor:'#7f1d1d' },
  { id:'autocsv',    label:'Auto CSV',           icon:'⚡', path:'/autocsv',             bg:'#fcd34d', iconColor:'#78350f' },
  { id:'reports',    label:'Reports',            icon:'clipboard', path:'/reports', bg:'#6ee7b7', iconColor:'#065f46' },
  { id:'settings',   label:'Settings',           icon:'✿',  path:'/settings',            bg:'#e2e8f0', iconColor:'#334155' },
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
      <style>{`
        .qs-header {
          padding: 14px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
          border-bottom: 1px solid #d4c8f0;
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(8px);
        }
        .qs-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          justify-content: center;
        }
        .module-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(100px, 140px));
          gap: 14px;
          padding: 0 20px 40px;
          max-width: 720px;
          margin: 0 auto;
          justify-content: center;
        }
        @media (max-width: 600px) {
          .qs-logo { order: 3; width: 100%; justify-content: center; }
          .module-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            padding: 0 12px 32px;
          }
        }
        @media (max-width: 380px) {
          .module-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .mod-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 18px 8px;
          cursor: pointer;
          border: none;
          border-radius: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          transition: transform 0.12s, box-shadow 0.12s;
          aspect-ratio: 1;
          width: 100%;
        }
        .mod-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        }
        .mod-btn:active { transform: scale(0.97); }
      `}</style>

      {/* Header */}
      <div className="qs-header">
        {/* Left: user info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9b8ec4', flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>👤</span>
          <span style={{ fontWeight: 700, color: '#5b21b6' }}>{user.userid}</span>
          <span>·</span>
          <span>{user.store === 'ALL' ? 'All Stores' : user.store}</span>
        </div>

        {/* Center: logo */}
        <div className="qs-logo">
          <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
            <polygon points="11,1 21,7 21,19 11,25 1,19 1,7" fill="none" stroke="#7c3aed" strokeWidth="2" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>QUICKDESK</span>
          <span style={{ color: '#c4b5fd', fontSize: 16, fontWeight: 300, margin: '0 4px' }}>—</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#7c3aed' }}>{user.location || 'Admin'}</span>
        </div>

        {/* Right: sign out */}
        <button
          onClick={() => { clearSession(); router.push('/') }}
          style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
        >Sign Out</button>
      </div>

      {/* Page title */}
      <div style={{ padding: '20px 20px 12px', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#3b1f8c', marginBottom: 4 }}>Select a Module</h2>
        <p style={{ fontSize: 12, color: '#9b8ec4' }}>— choose a module to begin</p>
      </div>

      {/* Module grid */}
      <div className="module-grid">
        {modules.map(m => (
          <button key={m.id} className="mod-btn" onClick={() => router.push(m.path)} style={{ background: m.bg }}>
            {m.icon === 'sun' ? (
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                {[0,45,90,135,180,225,270,315].map((deg, i) => {
                  const r = Math.PI * deg / 180
                  return <line key={i} x1={17+Math.cos(r)*12} y1={17+Math.sin(r)*12} x2={17+Math.cos(r)*16} y2={17+Math.sin(r)*16} stroke={m.iconColor} strokeWidth="2" strokeLinecap="round" />
                })}
                <circle cx="17" cy="17" r="6" fill={m.iconColor} />
                <circle cx="17" cy="17" r="4" fill="#fde68a" />
              </svg>
            ) : m.icon === 'clipboard' ? (
              <svg width="30" height="36" viewBox="0 0 30 36" fill="none">
                <rect x="2" y="5" width="26" height="29" rx="2" fill={m.iconColor} />
                <rect x="3.5" y="6.5" width="23" height="26" rx="1.5" fill="#f0fdf4" />
                <rect x="10" y="2" width="10" height="6" rx="2" fill={m.iconColor} />
                <rect x="12" y="1" width="6" height="4" rx="1.5" fill="#bbf7d0" />
                <rect x="7" y="14" width="16" height="2" rx="1" fill={m.iconColor} opacity="0.5" />
                <rect x="7" y="19" width="16" height="2" rx="1" fill={m.iconColor} opacity="0.5" />
                <rect x="7" y="24" width="10" height="2" rx="1" fill={m.iconColor} opacity="0.5" />
                <polyline points="7,13 9,15 13,11" stroke={m.iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : m.icon === 'barcode' ? (
              <svg width="42" height="30" viewBox="0 0 42 30" fill="none">
                {[[0,3],[4,1],[6,2],[9,1],[11,3],[15,1],[17,2],[20,1],[22,2],[25,3],[29,1],[31,2],[34,1],[36,3],[40,1]].map(([x,w],i) => (
                  <rect key={i} x={x} y={0} width={w} height={28} fill={m.iconColor} rx={0.5} />
                ))}
                <rect x={0} y={0} width={2} height={30} fill={m.iconColor} rx={0.5} />
                <rect x={20} y={0} width={1} height={30} fill={m.iconColor} rx={0.5} />
                <rect x={40} y={0} width={2} height={30} fill={m.iconColor} rx={0.5} />
              </svg>
            ) : (
              <span style={{ fontSize: 28, color: m.iconColor, lineHeight: 1 }}>{m.icon}</span>
            )}
            <span style={{ fontSize: 11, fontWeight: 800, color: m.iconColor, letterSpacing: '0.02em', textAlign: 'center' }}>
              {m.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

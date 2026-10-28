'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginUser, setSession } from '@/lib/auth'

function HexOutline({ x, y, size, opacity = 0.18 }: { x: number; y: number; size: number; opacity?: number }) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return `${x + size * Math.cos(a)},${y + size * Math.sin(a)}`
  }).join(' ')
  return <polygon points={pts} fill="none" stroke="#7c3aed" strokeWidth="1.5" opacity={opacity} />
}

export default function LoginPage() {
  const router = useRouter()
  const [userid, setUserid] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!userid.trim()) return
    setLoading(true)
    setErr('')
    const user = await loginUser(userid)
    if (!user) {
      setErr('User ID not found.')
      setLoading(false)
      return
    }
    setSession(user)
    router.push('/selector')
  }

  // Honeycomb grid positions (flat-top hexagons, tiled)
  const hexSize = 22
  const cols = 12
  const rows = 9
  const hexes: { x: number; y: number }[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * hexSize * 1.732 + (row % 2 === 0 ? 0 : hexSize * 0.866)
      const y = row * hexSize * 1.5
      hexes.push({ x: x + 20, y: y + 20 })
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: '#eeeaf6',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Honeycomb background */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} xmlns="http://www.w3.org/2000/svg">
        {hexes.map((h, i) => <HexOutline key={i} x={h.x} y={h.y} size={hexSize} opacity={0.15} />)}
      </svg>

      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center', position: 'relative', zIndex: 1 }}>

        {/* Logo — outlined hex with DESK inside */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <svg width="100" height="116" viewBox="0 0 100 116" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* outer hex outline */}
            <polygon
              points="50,4 96,28 96,88 50,112 4,88 4,28"
              fill="rgba(124,58,237,0.06)"
              stroke="#7c3aed"
              strokeWidth="2.5"
            />
            {/* inner hex outline */}
            <polygon
              points="50,16 84,34 84,82 50,100 16,82 16,34"
              fill="none"
              stroke="#7c3aed"
              strokeWidth="1"
              opacity="0.35"
            />
            <text
              x="50"
              y="62"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#5b21b6"
              fontSize="16"
              fontWeight="900"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              letterSpacing="3"
            >DESK</text>
          </svg>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '0.1em', color: '#5b21b6', marginBottom: 4 }}>
          QUICKDESK
        </h1>
        <p style={{ color: '#9b8ec4', fontSize: 13, marginBottom: 28 }}>Enter your User ID to continue</p>

        <form onSubmit={handleLogin} style={{
          background: 'rgba(255,255,255,0.92)',
          border: '1.5px solid #d4c8f0',
          borderRadius: 14,
          padding: '24px 28px',
          boxShadow: '0 4px 24px rgba(124,58,237,0.10)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          textAlign: 'left',
          backdropFilter: 'blur(6px)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: '#9b8ec4', display: 'block', marginBottom: 6, fontWeight: 700, letterSpacing: '0.06em' }}>
              USER ID
            </label>
            <input
              autoFocus
              value={userid}
              onChange={e => setUserid(e.target.value)}
              placeholder=""
              style={{
                textTransform: 'uppercase',
                background: '#f5f3ff',
                border: '1.5px solid #c4b5fd',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 15,
                color: '#3b1f8c',
                fontWeight: 700,
                width: '100%',
                outline: 'none',
                letterSpacing: '0.1em',
              }}
            />
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: 12 }}>{err}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '12px 0',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              width: '100%',
              letterSpacing: '0.04em',
              boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <p style={{ fontSize: 12, color: '#b8aed8', marginTop: 18 }}>
          Contact your manager to get a User ID
        </p>
      </div>
    </div>
  )
}

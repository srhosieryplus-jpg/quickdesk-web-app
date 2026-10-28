'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginUser, setSession } from '@/lib/auth'

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

  // Full-screen honeycomb — pointy-top hexagons tiled edge to edge
  const S = 28       // hex radius
  const W = S * Math.sqrt(3)
  const H = S * 2
  const cols = 32
  const rows = 22
  const hexes: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      hexes.push({
        x: c * W + (r % 2 === 0 ? 0 : W / 2),
        y: r * H * 0.75,
      })
    }
  }

  function hexPoints(cx: number, cy: number) {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6
      return `${cx + S * Math.cos(a)},${cy + S * Math.sin(a)}`
    }).join(' ')
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
      {/* Full background honeycomb with clear center */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="fadeCenter" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#eeeaf6" stopOpacity="1" />
            <stop offset="35%" stopColor="#eeeaf6" stopOpacity="1" />
            <stop offset="60%" stopColor="#eeeaf6" stopOpacity="0" />
          </radialGradient>
          <mask id="hexMask">
            <rect width="100%" height="100%" fill="white" />
            <rect width="100%" height="100%" fill="url(#fadeCenter)" />
          </mask>
        </defs>
        <g mask="url(#hexMask)">
          {hexes.map((h, i) => (
            <polygon
              key={i}
              points={hexPoints(h.x, h.y)}
              fill="none"
              stroke="#7c3aed"
              strokeWidth="1"
              opacity="0.18"
            />
          ))}
        </g>
      </svg>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 340, textAlign: 'center', position: 'relative', zIndex: 1 }}>

        {/* Hex logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <svg width="80" height="92" viewBox="0 0 80 92" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon
              points="40,3 77,23 77,69 40,89 3,69 3,23"
              fill="rgba(124,58,237,0.07)"
              stroke="#7c3aed"
              strokeWidth="2.5"
            />
            <polygon
              points="40,14 66,29 66,63 40,78 14,63 14,29"
              fill="none"
              stroke="#7c3aed"
              strokeWidth="1"
              opacity="0.3"
            />
            <text
              x="40" y="47"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#5b21b6"
              fontSize="19"
              fontWeight="900"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              letterSpacing="2"
            >QD</text>
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '0.1em', color: '#5b21b6', marginBottom: 3 }}>
          QUICKDESK
        </h1>
        <p style={{ color: '#9b8ec4', fontSize: 12, marginBottom: 22 }}>Enter your User ID to continue</p>

        <form onSubmit={handleLogin} style={{
          background: 'rgba(255,255,255,0.88)',
          border: '1.5px solid #d4c8f0',
          borderRadius: 14,
          padding: '20px 22px',
          boxShadow: '0 4px 28px rgba(124,58,237,0.12)',
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
          textAlign: 'left',
          backdropFilter: 'blur(8px)',
        }}>
          <div>
            <label style={{ fontSize: 10, color: '#9b8ec4', display: 'block', marginBottom: 5, fontWeight: 700, letterSpacing: '0.08em' }}>
              USER ID
            </label>
            <input
              autoFocus
              value={userid}
              onChange={e => setUserid(e.target.value)}
              style={{
                textTransform: 'uppercase',
                background: '#f5f3ff',
                border: '1.5px solid #c4b5fd',
                borderRadius: 7,
                padding: '8px 12px',
                fontSize: 13,
                color: '#3b1f8c',
                fontWeight: 700,
                width: '100%',
                outline: 'none',
                letterSpacing: '0.12em',
              }}
            />
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: 11, margin: 0 }}>{err}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              fontSize: 13,
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

        <p style={{ fontSize: 11, color: '#c4b5fd', marginTop: 16 }}>
          Contact your manager to get a User ID
        </p>
      </div>
    </div>
  )
}

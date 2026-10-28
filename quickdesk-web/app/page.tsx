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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: '#eeeaf6',
    }}>
      <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>

        {/* Hexagon logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <svg width="90" height="104" viewBox="0 0 90 104" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon
              points="45,2 88,26 88,78 45,102 2,78 2,26"
              fill="#7c3aed"
              stroke="#6d28d9"
              strokeWidth="2"
            />
            <text
              x="45"
              y="44"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="white"
              fontSize="11"
              fontWeight="800"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              letterSpacing="2"
            >QUICK</text>
            <text
              x="45"
              y="62"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="white"
              fontSize="11"
              fontWeight="800"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              letterSpacing="2"
            >DESK</text>
          </svg>
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '0.08em', color: '#5b21b6', marginBottom: 6 }}>
          QUICKDESK
        </h1>
        <p style={{ color: '#7c6fa0', fontSize: 13, marginBottom: 32 }}>Enter your User ID to continue</p>

        <form onSubmit={handleLogin} style={{
          background: '#fff',
          border: '1.5px solid #d4c8f0',
          borderRadius: 12,
          padding: '24px 28px',
          boxShadow: '0 2px 12px rgba(124,58,237,0.07)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          textAlign: 'left',
        }}>
          <div>
            <label style={{ fontSize: 12, color: '#7c6fa0', display: 'block', marginBottom: 6, fontWeight: 600 }}>
              User ID
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
                borderRadius: 6,
                padding: '9px 12px',
                fontSize: 14,
                color: '#3b1f8c',
                width: '100%',
                outline: 'none',
              }}
            />
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: 12 }}>{err}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '11px 0',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              width: '100%',
              letterSpacing: '0.03em',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <p style={{ fontSize: 12, color: '#a89cc8', marginTop: 20 }}>
          Contact your manager to get a User ID
        </p>
      </div>
    </div>
  )
}

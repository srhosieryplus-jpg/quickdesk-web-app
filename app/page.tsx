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
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:42, marginBottom:8 }}>📋</div>
          <h1 style={{ fontSize:24, fontWeight:700, letterSpacing:'-0.5px' }}>QuickDesk</h1>
          <p style={{ color:'#888', marginTop:4, fontSize:13 }}>Sign in with your User ID</p>
        </div>

        <form onSubmit={handleLogin} className="card" style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={{ fontSize:12, color:'#aaa', display:'block', marginBottom:4 }}>User ID</label>
            <input
              autoFocus
              value={userid}
              onChange={e => setUserid(e.target.value)}
              placeholder="e.g. SR"
              style={{ textTransform:'uppercase' }}
            />
          </div>
          {err && <p style={{ color:'#f87171', fontSize:12 }}>{err}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', justifyContent:'center' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

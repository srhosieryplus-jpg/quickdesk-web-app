'use client'
import { useRouter } from 'next/navigation'
export default function Page() {
  const router = useRouter()
  return (
    <div style={{ minHeight:'100vh', padding:20, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <p style={{ fontSize:32, marginBottom:12 }}>🚧</p>
        <p style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Coming Soon</p>
        <p style={{ fontSize:13, color:'#888', marginBottom:20 }}>This module is being built.</p>
        <button className="btn btn-ghost" onClick={() => router.push('/selector')}>← Back</button>
      </div>
    </div>
  )
}

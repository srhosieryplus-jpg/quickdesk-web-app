'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id: 'autocsv',    label: 'Auto CSV' },
  { id: 'qd',         label: 'UPC Scanner' },
  { id: 'reports',    label: 'Reports' },
  { id: 'season_ss',  label: 'SS Season' },
  { id: 'season_aw',  label: 'AW Season' },
  { id: 'ic',         label: 'Infinity Classics' },
  { id: 'po_tracker', label: 'PO Tracker' },
  { id: 'tasks',      label: 'Tasks' },
  { id: 'settings',   label: 'Settings' },
]

const STORES = ['ALL', 'HP1', 'HP2', 'HP3', 'COX', 'JCKSN', 'HB', 'KINGS', 'CONEY', 'SE13', 'TTC', 'TTP']
const LOCATIONS = ['Hosiery Plus', 'Tiptoe', 'Purple Orchid']
const DELETE_PASSWORD = 'star'

interface DBUser {
  id: string
  userid: string
  store: string
  location: string
  modules: string[]
}

const purple = '#7c3aed'
const purpleLight = '#eef0ff'
const border = '#d4c8f0'

export default function SettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [users, setUsers] = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')

  // Inline add form state
  const [newId, setNewId] = useState('')
  const [newStore, setNewStore] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [adding, setAdding] = useState(false)

  // Per-row dirty tracking: rowId -> modified modules[]
  const [dirty, setDirty] = useState<Record<string, string[]>>({})
  const [goingHome, setGoingHome] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    fetchUsers()
  }, [router])

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3200)
  }

  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('userid')
    if (error) { showToast('❌ Could not load users', 'err'); setLoading(false); return }
    setUsers(data as DBUser[] || [])
    setDirty({})
    setLoading(false)
  }

  function getModules(u: DBUser): string[] {
    return dirty[u.id] !== undefined ? dirty[u.id] : u.modules
  }

  function toggleModule(u: DBUser, modId: string) {
    const current = getModules(u)
    const next = current.includes(modId)
      ? current.filter(m => m !== modId)
      : [...current, modId]
    setDirty(d => ({ ...d, [u.id]: next }))
  }

  async function saveRow(u: DBUser) {
    const mods = getModules(u)
    const { error } = await supabase.from('users').update({ modules: mods }).eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err') }
    else {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, modules: mods } : x))
      setDirty(d => { const n = { ...d }; delete n[u.id]; return n })
    }
  }

  async function saveAllDirty() {
    const dirtyIds = Object.keys(dirty)
    if (!dirtyIds.length) return
    for (const id of dirtyIds) {
      const u = users.find(x => x.id === id)
      if (u) await saveRow(u)
    }
  }

  async function goHome() {
    setGoingHome(true)
    await saveAllDirty()
    setGoingHome(false)
    router.push('/selector')
  }

  async function deleteUser(u: DBUser) {
    if (u.userid === currentUser?.userid) { showToast('❌ Cannot delete your own account', 'err'); return }
    const pw = prompt(`Enter password to delete "${u.userid}":`)
    if (pw === null) return
    if (pw.toLowerCase() !== DELETE_PASSWORD) { showToast('❌ Incorrect password', 'err'); return }
    const { error } = await supabase.from('users').delete().eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.filter(x => x.id !== u.id))
    showToast('🗑 Deleted')
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    const uid = newId.trim().toUpperCase()
    const store = newStore.trim().toUpperCase()
    if (!uid || !store) { showToast('❌ User ID and Store required', 'err'); return }
    setAdding(true)
    const { data: existing } = await supabase.from('users').select('id').eq('userid', uid).maybeSingle()
    if (existing) { showToast(`❌ "${uid}" already exists`, 'err'); setAdding(false); return }
    const { error } = await supabase.from('users').insert({ userid: uid, store, location: newLocation, modules: [] })
    if (error) { showToast(`❌ ${error.message}`, 'err'); setAdding(false); return }
    showToast('✅ User added')
    setNewId(''); setNewStore(''); setNewLocation('')
    setAdding(false)
    fetchUsers()
  }

  const anyDirty = Object.keys(dirty).length > 0

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', fontFamily: 'Inter, sans-serif' }}>

      {/* Title bar */}
      <div style={{
        background: '#f0eef8', borderBottom: `1px solid ${border}`,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 18, color: purple }}>👥</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#3730a3', letterSpacing: '0.02em' }}>
          User Management
        </span>
        <span style={{ fontSize: 12, color: '#9b8ec4', marginLeft: 8 }}>
          {currentUser?.userid === 'SR' || currentUser?.userid === 'STAR'
            ? `'${currentUser.userid.toLowerCase()}' is the built-in admin (all access).`
            : ''}
        </span>
        <button onClick={goHome} disabled={goingHome}
          style={{ marginLeft: 'auto', background: anyDirty ? purple : 'none', color: anyDirty ? '#fff' : '#9b8ec4', border: anyDirty ? 'none' : 'none', borderRadius: 6, padding: anyDirty ? '5px 12px' : '0', fontSize: 13, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' }}>
          {goingHome ? '💾 Saving…' : anyDirty ? '💾 Save & Home' : '← Home'}
        </button>
      </div>

      {/* Inline Add User form */}
      <form onSubmit={addUser} style={{
        background: '#fff', borderBottom: `1px solid ${border}`,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelStyle}>User ID:</label>
          <input value={newId} onChange={e => setNewId(e.target.value.toUpperCase())}
            maxLength={10} style={{ ...inlineInput, width: 80, textTransform: 'uppercase', fontWeight: 700 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelStyle}>Store:</label>
          <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inlineInput, width: 90 }}>
            <option value="">—</option>
            {STORES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelStyle}>Location:</label>
          <select value={newLocation} onChange={e => setNewLocation(e.target.value)} style={{ ...inlineInput, width: 130 }}>
            <option value="">—</option>
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <button type="submit" disabled={adding}
          style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1 }}>
          {adding ? '…' : '+ Add User'}
        </button>
      </form>

      {/* Table — centered */}
      {loading ? (
        <p style={{ color: '#9b8ec4', fontSize: 13, padding: 24 }}>Loading…</p>
      ) : (
        <div style={{ overflowX: 'auto', display: 'flex', justifyContent: 'center', padding: '16px 16px' }}>
          <table style={{ borderCollapse: 'collapse', background: '#fff', tableLayout: 'auto', boxShadow: '0 2px 16px rgba(124,58,237,0.07)', borderRadius: 10, overflow: 'hidden', border: `1px solid ${border}` }}>
            <thead>
              <tr style={{ background: purpleLight, borderBottom: `1.5px solid ${border}` }}>
                <th style={{ ...thStyle, textAlign: 'center' }}>User ID</th>
                <th style={thStyle}>Store</th>
                <th style={{ ...thStyle, minWidth: 110 }}>Location</th>
                {ALL_MODULES.map(m => (
                  <th key={m.id} style={{ ...thStyle, textAlign: 'center', fontSize: 10, padding: '7px 6px', minWidth: 64, verticalAlign: 'middle' }}>{m.label}</th>
                ))}
                <th style={{ ...thStyle, width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={ALL_MODULES.length + 4} style={{ padding: 32, textAlign: 'center', color: '#b8aed8', fontSize: 13 }}>
                    No users yet. Use the form above to add one.
                  </td>
                </tr>
              )}
              {users.map((u, i) => {
                const mods = getModules(u)
                return (
                  <tr key={u.id} style={{
                    borderBottom: `1px solid ${border}`,
                    background: i % 2 === 0 ? '#fff' : '#faf8ff',
                  }}>
                    {/* User ID */}
                    <td style={{ ...tdStyle, fontWeight: 800, color: '#3730a3', fontSize: 12, letterSpacing: '0.04em', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {u.userid}
                    </td>
                    {/* Store — click to cycle */}
                    <td style={tdStyle}>
                      <span style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 5, padding: '2px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={async () => {
                          const idx = STORES.indexOf(u.store)
                          const next = STORES[(idx + 1) % STORES.length]
                          await supabase.from('users').update({ store: next }).eq('id', u.id)
                          setUsers(prev => prev.map(x => x.id === u.id ? { ...x, store: next } : x))
                        }}>
                        {u.store}
                      </span>
                    </td>
                    {/* Location — full name visible */}
                    <td style={{ ...tdStyle, minWidth: 110 }}>
                      <select
                        value={u.location || ''}
                        onChange={async e => {
                          const loc = e.target.value
                          await supabase.from('users').update({ location: loc }).eq('id', u.id)
                          setUsers(prev => prev.map(x => x.id === u.id ? { ...x, location: loc } : x))
                        }}
                        style={{
                          background: 'transparent', border: 'none', color: '#374151',
                          fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none',
                          fontFamily: 'Inter, sans-serif', width: '100%', minWidth: 110,
                        }}>
                        <option value="">—</option>
                        {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    {/* Module checkboxes */}
                    {ALL_MODULES.map(m => {
                      const checked = mods.includes(m.id)
                      return (
                        <td key={m.id} style={{ ...tdStyle, textAlign: 'center', padding: '7px 6px' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleModule(u, m.id)}
                            style={{ width: 13, height: 13, accentColor: purple, cursor: 'pointer' }} />
                        </td>
                      )
                    })}
                    {/* Delete */}
                    <td style={{ ...tdStyle, textAlign: 'center', padding: '7px 6px' }}>
                      <button onClick={() => deleteUser(u)} title="Delete user"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#dc2626', fontWeight: 900 }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '6px 16px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4' }}>
        {users.length} user{users.length !== 1 ? 's' : ''}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toastType === 'err' ? '#7f1d1d' : '#3b1f8c',
          color: '#fff', padding: '10px 18px', borderRadius: 8,
          fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap',
}

const inlineInput: React.CSSProperties = {
  background: '#fff', border: '1px solid #d1d5db', borderRadius: 5,
  padding: '4px 7px', fontSize: 12, color: '#111', outline: 'none',
  fontFamily: 'Inter, sans-serif',
}

const thStyle: React.CSSProperties = {
  padding: '7px 8px', textAlign: 'left',
  fontSize: 11, fontWeight: 700, color: '#6d28d9',
  letterSpacing: '0.02em', whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '7px 8px', fontSize: 12,
  color: '#333', verticalAlign: 'middle',
}'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id: 'autocsv',    label: 'Auto CSV' },
  { id: 'qd',         label: 'UPC Scanner' },
  { id: 'reports',    label: 'Reports' },
  { id: 'season_ss',  label: 'SS Season' },
  { id: 'season_aw',  label: 'AW Season' },
  { id: 'ic',         label: 'Infinity Classics' },
  { id: 'po_tracker', label: 'PO Tracker' },
  { id: 'tasks',      label: 'Tasks' },
  { id: 'settings',   label: 'Settings' },
]

const STORES = ['ALL', 'HP1', 'HP2', 'HP3', 'COX', 'JCKSN', 'HB', 'KINGS', 'CONEY', 'SE13', 'TTC', 'TTP']
const LOCATIONS = ['Hosiery Plus', 'Tiptoe', 'Purple Orchid']
const DELETE_PASSWORD = 'star'

interface DBUser {
  id: string
  userid: string
  store: string
  location: string
  modules: string[]
}

const purple = '#7c3aed'
const purpleLight = '#eef0ff'
const border = '#d4c8f0'

export default function SettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [users, setUsers] = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')

  // Inline add form state
  const [newId, setNewId] = useState('')
  const [newStore, setNewStore] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [adding, setAdding] = useState(false)

  // Per-row dirty tracking: rowId -> modified modules[]
  const [dirty, setDirty] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [goingHome, setGoingHome] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    fetchUsers()
  }, [router])

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3200)
  }

  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('userid')
    if (error) { showToast('❌ Could not load users', 'err'); setLoading(false); return }
    setUsers(data as DBUser[] || [])
    setDirty({})
    setLoading(false)
  }

  function getModules(u: DBUser): string[] {
    return dirty[u.id] !== undefined ? dirty[u.id] : u.modules
  }

  function toggleModule(u: DBUser, modId: string) {
    const current = getModules(u)
    const next = current.includes(modId)
      ? current.filter(m => m !== modId)
      : [...current, modId]
    setDirty(d => ({ ...d, [u.id]: next }))
  }

  async function saveRow(u: DBUser) {
    const mods = getModules(u)
    setSaving(u.id)
    const { error } = await supabase.from('users').update({ modules: mods }).eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err') }
    else {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, modules: mods } : x))
      setDirty(d => { const n = { ...d }; delete n[u.id]; return n })
    }
    setSaving(null)
  }

  async function saveAllDirty() {
    const dirtyIds = Object.keys(dirty)
    if (!dirtyIds.length) return
    for (const id of dirtyIds) {
      const u = users.find(x => x.id === id)
      if (u) await saveRow(u)
    }
  }

  async function goHome() {
    setGoingHome(true)
    await saveAllDirty()
    setGoingHome(false)
    router.push('/selector')
  }

  async function deleteUser(u: DBUser) {
    if (u.userid === currentUser?.userid) { showToast('❌ Cannot delete your own account', 'err'); return }
    const pw = prompt(`Enter password to delete "${u.userid}":`)
    if (pw === null) return
    if (pw.toLowerCase() !== DELETE_PASSWORD) { showToast('❌ Incorrect password', 'err'); return }
    const { error } = await supabase.from('users').delete().eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.filter(x => x.id !== u.id))
    showToast('🗑 Deleted')
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    const uid = newId.trim().toUpperCase()
    const store = newStore.trim().toUpperCase()
    if (!uid || !store) { showToast('❌ User ID and Store required', 'err'); return }
    setAdding(true)
    const { data: existing } = await supabase.from('users').select('id').eq('userid', uid).maybeSingle()
    if (existing) { showToast(`❌ "${uid}" already exists`, 'err'); setAdding(false); return }
    const { error } = await supabase.from('users').insert({ userid: uid, store, location: newLocation, modules: [] })
    if (error) { showToast(`❌ ${error.message}`, 'err'); setAdding(false); return }
    showToast('✅ User added')
    setNewId(''); setNewStore(''); setNewLocation('')
    setAdding(false)
    fetchUsers()
  }

  const isDirty = (u: DBUser) => dirty[u.id] !== undefined
  const anyDirty = Object.keys(dirty).length > 0

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', fontFamily: 'Inter, sans-serif' }}>

      {/* Title bar */}
      <div style={{
        background: '#f0eef8', borderBottom: `1px solid ${border}`,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 18, color: purple }}>👥</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#3730a3', letterSpacing: '0.02em' }}>
          User Management
        </span>
        <span style={{ fontSize: 12, color: '#9b8ec4', marginLeft: 8 }}>
          {currentUser?.userid === 'SR' || currentUser?.userid === 'STAR'
            ? `'${currentUser.userid.toLowerCase()}' is the built-in admin (all access).`
            : ''}
        </span>
        <button onClick={goHome} disabled={goingHome}
          style={{ marginLeft: 'auto', background: anyDirty ? purple : 'none', color: anyDirty ? '#fff' : '#9b8ec4', border: anyDirty ? 'none' : 'none', borderRadius: 6, padding: anyDirty ? '5px 12px' : '0', fontSize: 13, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' }}>
          {goingHome ? '💾 Saving…' : anyDirty ? '💾 Save & Home' : '← Home'}
        </button>
      </div>

      {/* Inline Add User form */}
      <form onSubmit={addUser} style={{
        background: '#fff', borderBottom: `1px solid ${border}`,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelStyle}>User ID:</label>
          <input value={newId} onChange={e => setNewId(e.target.value.toUpperCase())}
            maxLength={10} style={{ ...inlineInput, width: 80, textTransform: 'uppercase', fontWeight: 700 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelStyle}>Store:</label>
          <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inlineInput, width: 90 }}>
            <option value="">—</option>
            {STORES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={labelStyle}>Location:</label>
          <select value={newLocation} onChange={e => setNewLocation(e.target.value)} style={{ ...inlineInput, width: 130 }}>
            <option value="">—</option>
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <button type="submit" disabled={adding}
          style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1 }}>
          {adding ? '…' : '+ Add User'}
        </button>
      </form>

      {/* Table — centered */}
      {loading ? (
        <p style={{ color: '#9b8ec4', fontSize: 13, padding: 24 }}>Loading…</p>
      ) : (
        <div style={{ overflowX: 'auto', display: 'flex', justifyContent: 'center', padding: '16px 16px' }}>
          <table style={{ borderCollapse: 'collapse', background: '#fff', tableLayout: 'auto', boxShadow: '0 2px 16px rgba(124,58,237,0.07)', borderRadius: 10, overflow: 'hidden', border: `1px solid ${border}` }}>
            <thead>
              <tr style={{ background: purpleLight, borderBottom: `1.5px solid ${border}` }}>
                <th style={thStyle}>User ID</th>
                <th style={thStyle}>Store</th>
                <th style={{ ...thStyle, minWidth: 110 }}>Location</th>
                {ALL_MODULES.map(m => (
                  <th key={m.id} style={{ ...thStyle, textAlign: 'center', fontSize: 10, padding: '7px 6px', minWidth: 64 }}>{m.label}</th>
                ))}
                <th style={{ ...thStyle, width: 52 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={ALL_MODULES.length + 4} style={{ padding: 32, textAlign: 'center', color: '#b8aed8', fontSize: 13 }}>
                    No users yet. Use the form above to add one.
                  </td>
                </tr>
              )}
              {users.map((u, i) => {
                const mods = getModules(u)
                const rowDirty = isDirty(u)
                return (
                  <tr key={u.id} style={{
                    borderBottom: `1px solid ${border}`,
                    background: i % 2 === 0 ? '#fff' : '#faf8ff',
                  }}>
                    {/* User ID */}
                    <td style={{ ...tdStyle, fontWeight: 800, color: '#3730a3', fontSize: 12, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {u.userid}
                    </td>
                    {/* Store — click to cycle */}
                    <td style={tdStyle}>
                      <span style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 5, padding: '2px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={async () => {
                          const idx = STORES.indexOf(u.store)
                          const next = STORES[(idx + 1) % STORES.length]
                          await supabase.from('users').update({ store: next }).eq('id', u.id)
                          setUsers(prev => prev.map(x => x.id === u.id ? { ...x, store: next } : x))
                        }}>
                        {u.store}
                      </span>
                    </td>
                    {/* Location — full name visible */}
                    <td style={{ ...tdStyle, minWidth: 110 }}>
                      <select
                        value={u.location || ''}
                        onChange={async e => {
                          const loc = e.target.value
                          await supabase.from('users').update({ location: loc }).eq('id', u.id)
                          setUsers(prev => prev.map(x => x.id === u.id ? { ...x, location: loc } : x))
                        }}
                        style={{
                          background: 'transparent', border: 'none', color: '#374151',
                          fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none',
                          fontFamily: 'Inter, sans-serif', width: '100%', minWidth: 110,
                        }}>
                        <option value="">—</option>
                        {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    {/* Module checkboxes */}
                    {ALL_MODULES.map(m => {
                      const checked = mods.includes(m.id)
                      return (
                        <td key={m.id} style={{ ...tdStyle, textAlign: 'center', padding: '7px 6px' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleModule(u, m.id)}
                            style={{ width: 13, height: 13, accentColor: purple, cursor: 'pointer' }} />
                        </td>
                      )
                    })}
                    {/* Save / Delete */}
                    <td style={{ ...tdStyle, textAlign: 'center', padding: '7px 6px' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                        <button onClick={() => saveRow(u)} disabled={saving === u.id || !rowDirty}
                          title="Save changes"
                          style={{ background: 'none', border: 'none', cursor: rowDirty ? 'pointer' : 'default', fontSize: 15, color: rowDirty ? '#1e40af' : '#c4b5fd', opacity: saving === u.id ? 0.5 : 1, transition: 'color 0.15s' }}>
                          💾
                        </button>
                        <button onClick={() => deleteUser(u)} title="Delete user"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#dc2626', fontWeight: 900 }}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '6px 16px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4' }}>
        {users.length} user{users.length !== 1 ? 's' : ''}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toastType === 'err' ? '#7f1d1d' : '#3b1f8c',
          color: '#fff', padding: '10px 18px', borderRadius: 8,
          fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap',
}

const inlineInput: React.CSSProperties = {
  background: '#fff', border: '1px solid #d1d5db', borderRadius: 5,
  padding: '4px 7px', fontSize: 12, color: '#111', outline: 'none',
  fontFamily: 'Inter, sans-serif',
}

const thStyle: React.CSSProperties = {
  padding: '7px 8px', textAlign: 'left',
  fontSize: 11, fontWeight: 700, color: '#6d28d9',
  letterSpacing: '0.02em', whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '7px 8px', fontSize: 12,
  color: '#333', verticalAlign: 'middle',
}

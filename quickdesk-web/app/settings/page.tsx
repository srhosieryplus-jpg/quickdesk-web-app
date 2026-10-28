'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id: 'tasks',      label: 'Tasks' },
  { id: 'season_ss',  label: 'Season SS' },
  { id: 'season_aw',  label: 'Season AW' },
  { id: 'ic',         label: 'IC Log' },
  { id: 'po_tracker', label: 'PO Tracker' },
  { id: 'qd',         label: 'QuickDesk' },
  { id: 'autocsv',    label: 'Auto CSV' },
  { id: 'reports',    label: 'Reports' },
  { id: 'settings',   label: 'Settings' },
]

interface DBUser {
  id: string
  userid: string
  store: string
  location: string
  modules: string[]
}

const emptyForm = { userid: '', store: '', location: '', modules: [] as string[] }

export default function SettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [users, setUsers] = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    if (!u.modules.includes('settings')) { router.push('/selector'); return }
    setCurrentUser(u)
    fetchUsers()
  }, [router])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function fetchUsers() {
    setLoading(true)
    const { data } = await supabase.from('users').select('*').order('userid')
    setUsers(data as DBUser[] || [])
    setLoading(false)
  }

  function toggleModule(modId: string) {
    setForm(f => ({
      ...f,
      modules: f.modules.includes(modId)
        ? f.modules.filter(m => m !== modId)
        : [...f.modules, modId]
    }))
  }

  function startEdit(u: DBUser) {
    setForm({ userid: u.userid, store: u.store, location: u.location, modules: [...u.modules] })
    setEditingId(u.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelForm() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(false)
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault()
    if (!form.userid.trim() || !form.store.trim()) return
    setSaving(true)
    const payload = {
      userid: form.userid.trim().toUpperCase(),
      store: form.store.trim().toUpperCase(),
      location: form.location.trim(),
      modules: form.modules,
    }
    if (editingId) {
      const { error } = await supabase.from('users').update(payload).eq('id', editingId)
      if (error) { showToast('❌ Error updating user'); setSaving(false); return }
      showToast('✅ User updated')
    } else {
      const { error } = await supabase.from('users').insert(payload)
      if (error) { showToast('❌ Error creating user'); setSaving(false); return }
      showToast('✅ User created')
    }
    cancelForm()
    setSaving(false)
    fetchUsers()
  }

  async function deleteUser(u: DBUser) {
    if (!confirm(`Delete user "${u.userid}"? This cannot be undone.`)) return
    await supabase.from('users').delete().eq('id', u.id)
    setUsers(prev => prev.filter(x => x.id !== u.id))
    showToast('🗑 User deleted')
  }

  const purple = '#7c3aed'
  const purpleLight = '#f5f3ff'
  const border = '#d4c8f0'

  return (
    <div style={{ minHeight: '100vh', padding: 20, background: '#eeeaf6' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => router.push('/selector')}
            style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#5b21b6', fontWeight: 600 }}
          >← Back</button>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#5b21b6', letterSpacing: '0.04em' }}>⚙️ Settings — User Management</h2>
          <button
            onClick={() => { cancelForm(); setShowForm(true) }}
            style={{ marginLeft: 'auto', background: purple, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >+ New User</button>
        </div>

        {/* Form */}
        {showForm && (
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: '0 2px 12px rgba(124,58,237,0.08)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#5b21b6', marginBottom: 16 }}>
              {editingId ? 'Edit User' : 'Create New User'}
            </h3>
            <form onSubmit={saveUser}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#7c6fa0', fontWeight: 600, display: 'block', marginBottom: 4 }}>USER ID *</label>
                  <input
                    value={form.userid}
                    onChange={e => setForm(f => ({ ...f, userid: e.target.value }))}
                    placeholder="e.g. SR"
                    style={{ textTransform: 'uppercase', background: purpleLight, border: `1.5px solid ${border}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3b1f8c', width: '100%', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#7c6fa0', fontWeight: 600, display: 'block', marginBottom: 4 }}>STORE *</label>
                  <input
                    value={form.store}
                    onChange={e => setForm(f => ({ ...f, store: e.target.value }))}
                    placeholder="e.g. NYC or ALL"
                    style={{ textTransform: 'uppercase', background: purpleLight, border: `1.5px solid ${border}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3b1f8c', width: '100%', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#7c6fa0', fontWeight: 600, display: 'block', marginBottom: 4 }}>LOCATION</label>
                  <input
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="e.g. Admin"
                    style={{ background: purpleLight, border: `1.5px solid ${border}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3b1f8c', width: '100%', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: '#7c6fa0', fontWeight: 600, display: 'block', marginBottom: 8 }}>MODULE ACCESS</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ALL_MODULES.map(m => {
                    const on = form.modules.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleModule(m.id)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 20,
                          border: `1.5px solid ${on ? purple : border}`,
                          background: on ? purple : '#fff',
                          color: on ? '#fff' : '#7c6fa0',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >{m.label}</button>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="submit"
                  disabled={saving || !form.userid.trim() || !form.store.trim()}
                  style={{ background: purple, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
                >{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create User'}</button>
                <button
                  type="button"
                  onClick={cancelForm}
                  style={{ background: '#fff', color: '#7c6fa0', border: `1px solid ${border}`, borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Users table */}
        {loading ? (
          <p style={{ color: '#7c6fa0', fontSize: 13 }}>Loading users…</p>
        ) : (
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(124,58,237,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: purpleLight }}>
                  <th style={th}>User ID</th>
                  <th style={th}>Store</th>
                  <th style={th}>Location</th>
                  <th style={th}>Modules</th>
                  <th style={{ ...th, width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#a89cc8', fontSize: 13 }}>No users found.</td></tr>
                )}
                {users.map((u, i) => (
                  <tr key={u.id} style={{ borderTop: `1px solid ${border}`, background: i % 2 === 0 ? '#fff' : '#faf8ff' }}>
                    <td style={td}><span style={{ fontWeight: 700, color: '#5b21b6' }}>{u.userid}</span></td>
                    <td style={td}>{u.store}</td>
                    <td style={td}>{u.location || '—'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {u.modules.map(m => {
                          const mod = ALL_MODULES.find(x => x.id === m)
                          return mod ? (
                            <span key={m} style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                              {mod.label}
                            </span>
                          ) : null
                        })}
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => startEdit(u)}
                          style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >Edit</button>
                        <button
                          onClick={() => deleteUser(u)}
                          style={{ background: '#fff5f5', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#3b1f8c', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(124,58,237,0.25)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: '#7c3aed',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const td: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 13,
  color: '#333',
  verticalAlign: 'middle',
}

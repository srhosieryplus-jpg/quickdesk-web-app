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

const STORES = ['ALL', 'NYC', 'LA', 'CHI', 'MIA', 'DAL', 'SF', 'BOS', 'ATL', 'SEA']
const LOCATIONS = ['Admin', 'Manager', 'Sales', 'Stock', 'Cashier', 'Supervisor', 'Other']

interface DBUser {
  id: string
  userid: string
  store: string
  location: string
  modules: string[]
}

const emptyForm = { userid: '', store: '', location: '', modules: [] as string[] }

const purple = '#7c3aed'
const purpleLight = '#f5f3ff'
const border = '#d4c8f0'

export default function SettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [users, setUsers] = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok'|'err'>('ok')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    fetchUsers()
  }, [router])

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('userid')
    if (error) { showToast('❌ Could not load users', 'err'); setLoading(false); return }
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
    const uid = form.userid.trim().toUpperCase()
    const store = form.store.trim().toUpperCase()
    if (!uid || !store) { showToast('❌ User ID and Store are required', 'err'); return }
    setSaving(true)

    const payload = {
      userid: uid,
      store,
      location: form.location.trim(),
      modules: form.modules,
    }

    if (editingId) {
      const { error } = await supabase.from('users').update(payload).eq('id', editingId)
      if (error) { showToast(`❌ ${error.message}`, 'err'); setSaving(false); return }
      showToast('✅ User updated')
    } else {
      // Check for duplicate userid
      const { data: existing } = await supabase.from('users').select('id').eq('userid', uid).maybeSingle()
      if (existing) { showToast(`❌ User ID "${uid}" already exists`, 'err'); setSaving(false); return }
      const { error } = await supabase.from('users').insert(payload)
      if (error) { showToast(`❌ ${error.message}`, 'err'); setSaving(false); return }
      showToast('✅ User created')
    }

    cancelForm()
    setSaving(false)
    fetchUsers()
  }

  async function deleteUser(u: DBUser) {
    if (u.userid === currentUser?.userid) { showToast('❌ Cannot delete your own account', 'err'); return }
    if (!confirm(`Delete user "${u.userid}"? This cannot be undone.`)) return
    const { error } = await supabase.from('users').delete().eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.filter(x => x.id !== u.id))
    showToast('🗑 User deleted')
  }

  return (
    <div style={{ minHeight: '100vh', padding: 20, background: '#eeeaf6' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#5b21b6', fontWeight: 600 }}>
            ← Back
          </button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#5b21b6', letterSpacing: '0.04em' }}>⚙️ User Management</h2>
            <p style={{ fontSize: 12, color: '#9b8ec4', marginTop: 1 }}>{users.length} user{users.length !== 1 ? 's' : ''} registered</p>
          </div>
          <button onClick={() => { cancelForm(); setShowForm(true) }}
            style={{ marginLeft: 'auto', background: purple, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)' }}>
            + New User
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, padding: 24, marginBottom: 24, boxShadow: '0 4px 20px rgba(124,58,237,0.10)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: '#5b21b6', marginBottom: 18, letterSpacing: '0.04em' }}>
              {editingId ? '✏️ Edit User' : '➕ Create New User'}
            </h3>
            <form onSubmit={saveUser}>
              {/* Row 1: basic fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '160px 160px 1fr', gap: 14, marginBottom: 18 }}>
                <div>
                  <label style={labelStyle}>USER ID *</label>
                  <input
                    value={form.userid}
                    onChange={e => setForm(f => ({ ...f, userid: e.target.value.toUpperCase() }))}
                    placeholder="e.g. SR"
                    maxLength={10}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>STORE *</label>
                  <select
                    value={form.store}
                    onChange={e => setForm(f => ({ ...f, store: e.target.value }))}
                    style={selectStyle}
                  >
                    <option value="">— Select —</option>
                    {STORES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>LOCATION / ROLE</label>
                  <select
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    style={selectStyle}
                  >
                    <option value="">— Select —</option>
                    {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              {/* Module toggles */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ ...labelStyle, display: 'block', marginBottom: 10 }}>MODULE ACCESS</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ALL_MODULES.map(m => {
                    const on = form.modules.includes(m.id)
                    return (
                      <button key={m.id} type="button" onClick={() => toggleModule(m.id)}
                        style={{
                          padding: '6px 16px', borderRadius: 20,
                          border: `1.5px solid ${on ? purple : border}`,
                          background: on ? purple : '#fff',
                          color: on ? '#fff' : '#9b8ec4',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          transition: 'all 0.12s',
                        }}>
                        {m.label}
                      </button>
                    )
                  })}
                </div>
                <p style={{ fontSize: 11, color: '#b8aed8', marginTop: 8 }}>{form.modules.length} module{form.modules.length !== 1 ? 's' : ''} selected</p>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={saving}
                  style={{ background: purple, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create User'}
                </button>
                <button type="button" onClick={cancelForm}
                  style={{ background: '#fff', color: '#9b8ec4', border: `1px solid ${border}`, borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Users Table */}
        {loading ? (
          <p style={{ color: '#9b8ec4', fontSize: 13, padding: 20 }}>Loading users…</p>
        ) : (
          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 16px rgba(124,58,237,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                  <th style={thStyle}>User ID</th>
                  <th style={thStyle}>Store</th>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Modules</th>
                  <th style={{ ...thStyle, textAlign: 'right', paddingRight: 20 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#b8aed8', fontSize: 13 }}>
                      No users yet. Click <strong>+ New User</strong> to add one.
                    </td>
                  </tr>
                )}
                {users.map((u, i) => (
                  <tr key={u.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${border}`, background: i % 2 === 0 ? '#fff' : '#faf8ff', transition: 'background 0.1s' }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 800, color: '#5b21b6', fontSize: 14, letterSpacing: '0.05em' }}>{u.userid}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                        {u.store}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#666' }}>{u.location || '—'}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {u.modules.length === 0 && <span style={{ color: '#c4b5fd', fontSize: 12 }}>No access</span>}
                        {u.modules.map(m => {
                          const mod = ALL_MODULES.find(x => x.id === m)
                          return mod ? (
                            <span key={m} style={{ background: '#ede9fe', color: '#6d28d9', borderRadius: 10, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>
                              {mod.label}
                            </span>
                          ) : null
                        })}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', paddingRight: 16 }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => startEdit(u)}
                          style={{ background: purpleLight, color: purple, border: `1px solid ${border}`, borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          Edit
                        </button>
                        <button onClick={() => deleteUser(u)}
                          style={{ background: '#fff5f5', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          ✕
                        </button>
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
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toastType === 'err' ? '#7f1d1d' : '#3b1f8c',
          color: '#fff', padding: '12px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#9b8ec4', fontWeight: 700,
  letterSpacing: '0.06em', display: 'block', marginBottom: 5,
}

const inputStyle: React.CSSProperties = {
  background: '#f5f3ff', border: '1.5px solid #c4b5fd',
  borderRadius: 7, padding: '9px 12px', fontSize: 13,
  color: '#3b1f8c', fontWeight: 700, width: '100%', outline: 'none',
  letterSpacing: '0.05em',
}

const selectStyle: React.CSSProperties = {
  background: '#f5f3ff', border: '1.5px solid #c4b5fd',
  borderRadius: 7, padding: '9px 12px', fontSize: 13,
  color: '#3b1f8c', fontWeight: 600, width: '100%', outline: 'none',
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 800, color: '#7c3aed',
  letterSpacing: '0.08em', textTransform: 'uppercase',
}

const tdStyle: React.CSSProperties = {
  padding: '13px 16px', fontSize: 13,
  color: '#333', verticalAlign: 'middle',
}

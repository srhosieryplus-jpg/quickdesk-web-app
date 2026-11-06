'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'
import { VENDOR_DATA, VendorRow } from '@/lib/vendors'

const ALL_MODULES = [
  { id: 'autocsv',    label: 'Auto CSV' },
  { id: 'qd',         label: 'UPC Scanner' },
  { id: 'reports',    label: 'Reports' },
  { id: 'season_ss',   label: 'SS Season' },
  { id: 'season_aw',   label: 'AW Season' },
  { id: 'season_book', label: 'Season Book' },
  { id: 'ic',          label: 'Infinity Classics' },
  { id: 'po_tracker',  label: 'PO Tracker' },
  { id: 'tasks',       label: 'Tasks' },
  { id: 'hair_acc',    label: 'Hair Acc' },
  { id: 'error_forms', label: 'Error Forms' },
  { id: 'settings',    label: 'Settings' },
]

const DEFAULT_STORES = ['ALL','PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']
const LOCATIONS = ['Hosiery Plus','Tiptoe','Purple Orchid']
const DELETE_PASSWORD = 'star'

interface DBUser { id: string; userid: string; store: string; location: string; modules: string[] }
interface CtxMenu { x: number; y: number; kind: 'user'; userId: string }
interface VCtxMenu { x: number; y: number; kind: 'vendor'; idx: number }


const purple = '#7c3aed'
const purpleD = '#6d28d9'
const purpleLight = '#f3f0ff'
const border = '#d4c8f0'

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6d28d9', whiteSpace: 'nowrap' }
const cellInput: React.CSSProperties = { background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: '#111', fontFamily: 'Inter, sans-serif', width: '100%', padding: 0 }
const inlineInput: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', borderRadius: 5, padding: '3px 7px', fontSize: 12, color: '#111', outline: 'none', fontFamily: 'Inter, sans-serif' }

export default function SettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [users, setUsers] = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [tab, setTab] = useState<'users' | 'vendors' | 'stores'>('users')
  const [goingHome, setGoingHome] = useState(false)
  const [dirty, setDirty] = useState<Record<string, string[]>>({})

  // User tab
  const [newId, setNewId] = useState('')
  const [newStore, setNewStore] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [adding, setAdding] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [editUser, setEditUser] = useState<DBUser | null>(null)
  const [userSearch, setUserSearch] = useState('')

  // Stores tab
  const [stores, setStores] = useState<string[]>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('qd_stores') : null
      return saved ? JSON.parse(saved) : DEFAULT_STORES
    } catch { return DEFAULT_STORES }
  })
  const [newStoreId, setNewStoreId] = useState('')

  // Vendor tab
  const [vendors, setVendors] = useState<VendorRow[]>(VENDOR_DATA)
  const [vendorSearch, setVendorSearch] = useState('')
  const [vCtxMenu, setVCtxMenu] = useState<VCtxMenu | null>(null)
  const [editVendor, setEditVendor] = useState<{ idx: number; vendor_id: string; brand: string } | null>(null)
  const [newVendorId, setNewVendorId] = useState('')
  const [newBrand, setNewBrand] = useState('')

  const ctxRef = useRef<HTMLDivElement>(null)

  function saveStores(next: string[]) {
    setStores(next)
    try { localStorage.setItem('qd_stores', JSON.stringify(next)) } catch {}
  }

  function addStore(e: React.FormEvent) {
    e.preventDefault()
    const s = newStoreId.trim().toUpperCase()
    if (!s) return
    if (stores.includes(s)) { showToast(`❌ "${s}" already exists`, 'err'); return }
    saveStores([...stores, s])
    setNewStoreId('')
    showToast(`✅ Store "${s}" added`)
  }

  function removeStore(s: string) {
    if (s === 'ALL') { showToast('❌ Cannot remove ALL', 'err'); return }
    saveStores(stores.filter(x => x !== s))
    showToast(`🗑 Store "${s}" removed`)
  }

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    fetchUsers()
  }, [router])

  // ── return to selector after screen lock / idle ───────────────────────────
  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [router])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null); setVCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('userid')
    if (error) { showToast('❌ Could not load users', 'err'); setLoading(false); return }
    setUsers(data as DBUser[] || [])
    setDirty({})
    setLoading(false)
  }

  function getModules(u: DBUser) { return dirty[u.id] !== undefined ? dirty[u.id] : u.modules }

  function toggleModule(u: DBUser, modId: string) {
    const cur = getModules(u)
    setDirty(d => ({ ...d, [u.id]: cur.includes(modId) ? cur.filter(m => m !== modId) : [...cur, modId] }))
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
    for (const id of Object.keys(dirty)) {
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

  async function deleteUser(userId: string) {
    if (userId === currentUser?.userid) { showToast('❌ Cannot delete your own account', 'err'); return }
    const pw = prompt(`Enter password to delete "${userId}":`)
    if (pw === null) return
    if (pw.toLowerCase() !== DELETE_PASSWORD) { showToast('❌ Incorrect password', 'err'); return }
    const u = users.find(x => x.userid === userId)
    if (!u) return
    const { error } = await supabase.from('users').delete().eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.filter(x => x.userid !== userId))
    showToast('🗑 Deleted')
  }

  async function saveEditUser() {
    if (!editUser) return
    const { error } = await supabase.from('users').update({
      userid: editUser.userid, store: editUser.store, location: editUser.location
    }).eq('id', editUser.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.map(x => x.id === editUser.id ? { ...x, ...editUser } : x))
    setEditUser(null)
    showToast('✅ Saved')
  }

  // Vendor helpers
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.toLowerCase().trim()
    // Always hide rows with no vendor_id unless searching explicitly for blank
    const base = vendors.filter(v => v.vendor_id && v.vendor_id.trim())
    if (!q) return base
    return base.filter(v => v.vendor_id.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q))
  }, [vendors, vendorSearch])

  function addVendorRow(e: React.FormEvent) {
    e.preventDefault()
    const vid = newVendorId.trim()
    const br = newBrand.trim()
    if (!vid || !br) { showToast('❌ Both fields required', 'err'); return }
    setVendors(prev => [...prev, { vendor_id: vid, brand: br }])
    setNewVendorId(''); setNewBrand('')
    showToast('✅ Row added')
  }

  function saveEditVendor() {
    if (!editVendor) return
    setVendors(prev => prev.map((v, i) => i === editVendor.idx ? { vendor_id: editVendor.vendor_id, brand: editVendor.brand } : v))
    setEditVendor(null)
    showToast('✅ Saved')
  }

  function deleteVendorRow(idx: number) {
    // find actual index in full vendors array — filteredVendors[idx] matches by value
    const target = filteredVendors[idx]
    setVendors(prev => {
      const fullIdx = prev.findIndex(v => v === target)
      if (fullIdx === -1) return prev
      return prev.filter((_, i) => i !== fullIdx)
    })
    showToast('🗑 Removed')
  }

  const anyDirty = Object.keys(dirty).length > 0

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      <style>{`
        * { box-sizing: border-box; }
        .ss-table { border-collapse: collapse; width: 100%; }
        .ss-table th { background: ${purpleLight}; color: ${purpleD}; font-size: 11px; font-weight: 700; padding: 5px 8px; border: 1px solid ${border}; text-align: left; white-space: nowrap; position: sticky; top: 0; z-index: 2; }
        .ss-table td { padding: 3px 8px; border: 1px solid #e8e0f8; font-size: 12px; color: #222; vertical-align: middle; height: 28px; }
        .ss-table tr:hover td { background: #f3f0ff !important; }
        .ss-table td.cell-check { text-align: center; width: 36px; padding: 2px 4px; }
        .ctx-menu { position: fixed; background: #fff; border: 1px solid ${border}; border-radius: 7px; box-shadow: 0 4px 18px rgba(124,58,237,0.18); z-index: 9999; min-width: 130px; overflow: hidden; }
        .ctx-item { padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; color: #333; }
        .ctx-item:hover { background: ${purpleLight}; color: ${purpleD}; }
        .ctx-item.danger:hover { background: #fef2f2; color: #dc2626; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 9998; display: flex; align-items: center; justify-content: center; }
        .modal { background: #fff; border-radius: 12px; padding: 24px; min-width: 300px; box-shadow: 0 8px 40px rgba(0,0,0,0.18); }
        .modal h3 { margin: 0 0 16px; font-size: 15px; color: ${purpleD}; }
        .modal label { font-size: 11px; font-weight: 700; color: #6d28d9; display: block; margin-bottom: 3px; }
        .modal input, .modal select { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 10px; font-size: 13px; margin-bottom: 12px; outline: none; }
        .modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
        .btn-cancel { background: #f3f4f6; color: #374151; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .btn-save { background: ${purple}; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .settings-tabs { display: flex; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.5); padding: 0 16px; }
        .settings-tab { padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; background: none; color: #9b8ec4; border-bottom: 3px solid transparent; }
        .settings-tab.active { color: ${purpleD}; border-bottom-color: ${purple}; }
        @media (max-width: 600px) { .settings-header-center { order: 3; width: 100%; } }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#eeeaf6' }}>
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={goHome} disabled={goingHome}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>
            {goingHome ? '💾 Saving…' : '← Home'}
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{displayUser(currentUser?.userid)}</span>
          </span>
        </div>
        <div className="settings-header-center" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="18" height="21" viewBox="0 0 22 26" fill="none"><polygon points="11,1 21,7 21,19 11,25 1,19 1,7" fill="none" stroke="#7c3aed" strokeWidth="2"/></svg>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>SETTINGS</span>
        </div>
        <div style={{ fontSize: 12, color: purple, fontWeight: 700, minWidth: 80, textAlign: 'right' }}>
          {anyDirty ? '● Unsaved' : ''}
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>👤 User IDs</button>
        <button className={`settings-tab ${tab === 'vendors' ? 'active' : ''}`} onClick={() => setTab('vendors')}>🏷 Vendors / Brands</button>
        <button className={`settings-tab ${tab === 'stores' ? 'active' : ''}`} onClick={() => setTab('stores')}>🏪 Store IDs</button>
      </div>
      </div>{/* end sticky header+tabs wrapper */}

      {/* ══ USER IDs TAB ══════════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <>
          {/* Add row */}
          <form onSubmit={addUser} style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={labelStyle}>User ID:</label>
            <input value={newId} onChange={e => setNewId(e.target.value.toUpperCase())} maxLength={10}
              placeholder="e.g. SARA" style={{ ...inlineInput, width: 80, textTransform: 'uppercase', fontWeight: 700 }} />
            <label style={labelStyle}>Store:</label>
            <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inlineInput, width: 88 }}>
              <option value="">—</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
            <label style={labelStyle}>Location:</label>
            <select value={newLocation} onChange={e => setNewLocation(e.target.value)} style={{ ...inlineInput, width: 130 }}>
              <option value="">—</option>
              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
            </select>
            <button type="submit" disabled={adding}
              style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1 }}>
              {adding ? '…' : '+ Add'}
            </button>
          </form>

          {/* Spreadsheet */}
          {loading ? (
            <p style={{ color: '#9b8ec4', padding: 24 }}>Loading…</p>
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '0 0 60px' }}>
              {/* User search */}
              <div style={{ padding: '8px 16px 4px' }}>
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="🔍 Search users…"
                  style={{ width: '100%', maxWidth: 280, background: '#f5f3ff', border: '1.5px solid #c4b5fd', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#3730a3', fontWeight: 600, outline: 'none', boxSizing: 'border-box' }}
                />
                {userSearch && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#9b8ec4' }}>
                    {users.filter(u => [u.userid, u.store, u.location].some(v => v?.toLowerCase().includes(userSearch.toLowerCase()))).length} result(s)
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ss-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28, textAlign: 'center' }}>#</th>
                      <th style={{ width: 90 }}>User ID</th>
                      <th style={{ width: 80 }}>Store</th>
                      <th style={{ width: 130 }}>Location</th>
                      {ALL_MODULES.map(m => (
                        <th key={m.id} style={{ width: 66, textAlign: 'center', fontSize: 10 }}>{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr><td colSpan={ALL_MODULES.length + 4} style={{ textAlign: 'center', color: '#b8aed8', padding: 28 }}>No users yet.</td></tr>
                    )}
                    {users.filter(u => !userSearch || [u.userid, u.store, u.location].some(v => v?.toLowerCase().includes(userSearch.toLowerCase()))).map((u, i) => {
                      const mods = getModules(u)
                      const isDirty = dirty[u.id] !== undefined
                      return (
                        <tr key={u.id}
                          style={{ background: isDirty ? '#fdf4ff' : i % 2 === 0 ? '#fff' : '#faf8ff', cursor: 'default' }}
                          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'user', userId: u.userid }); setVCtxMenu(null) }}>
                          <td style={{ textAlign: 'center', color: '#aaa', fontSize: 10 }}>{i + 1}</td>
                          <td style={{ fontWeight: 800, color: '#3730a3', fontSize: 12, letterSpacing: '0.04em' }}>
                            {u.userid}{isDirty && <span style={{ color: purple, marginLeft: 4 }}>●</span>}
                          </td>
                          <td>
                            <select value={u.store} onChange={async e => {
                              const next = e.target.value
                              await supabase.from('users').update({ store: next }).eq('id', u.id)
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, store: next } : x))
                            }} style={{ ...cellInput, cursor: 'pointer' }}>
                              {stores.map(s => <option key={s}>{s}</option>)}
                            </select>
                          </td>
                          <td>
                            <select value={u.location || ''} onChange={async e => {
                              const loc = e.target.value
                              await supabase.from('users').update({ location: loc }).eq('id', u.id)
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, location: loc } : x))
                            }} style={{ ...cellInput, cursor: 'pointer' }}>
                              <option value="">—</option>
                              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                            </select>
                          </td>
                          {ALL_MODULES.map(m => (
                            <td key={m.id} className="cell-check">
                              <input type="checkbox" checked={mods.includes(m.id)} onChange={() => toggleModule(u, m.id)}
                                style={{ width: 13, height: 13, accentColor: purple, cursor: 'pointer' }} />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {anyDirty && (
                <div style={{ padding: '8px 14px', background: '#fdf4ff', borderTop: `1px solid ${border}` }}>
                  <button onClick={saveAllDirty}
                    style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    💾 Save Module Changes
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ padding: '5px 14px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4', position: 'sticky', bottom: 0 }}>
            {users.length} user{users.length !== 1 ? 's' : ''} · Right-click a row to edit or delete
          </div>
        </>
      )}

      {/* ══ VENDORS / BRANDS TAB ═════════════════════════════════════════════ */}
      {tab === 'vendors' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Add row + search */}
          <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={labelStyle}>Search:</label>
            <input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}
              placeholder="vendor or brand…" style={{ ...inlineInput, flex: 1, minWidth: 120 }} />
            <form onSubmit={addVendorRow} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={labelStyle}>Vendor:</label>
              <input value={newVendorId} onChange={e => setNewVendorId(e.target.value)}
                placeholder="Vendor name" style={{ ...inlineInput, width: 140 }} />
              <label style={labelStyle}>Brand:</label>
              <input value={newBrand} onChange={e => setNewBrand(e.target.value)}
                placeholder="Brand name" style={{ ...inlineInput, width: 140 }} />
              <button type="submit"
                style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                + Add
              </button>
            </form>
          </div>

          {/* Spreadsheet */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 40px' }}>
            <div style={{ overflowX: 'auto', maxWidth: 700, margin: '0 auto', paddingTop: 8 }}>
              <table className="ss-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                  <tr>
                    <th style={{ width: 28, textAlign: 'center' }}>#</th>
                    <th>Vendor ID</th>
                    <th>Brand</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: '#9b8ec4', padding: 28 }}>No matches.</td></tr>
                  )}
                  {filteredVendors.map((v, i) => (
                    <tr key={i}
                      style={{ background: i % 2 === 0 ? '#fff' : '#faf8ff', cursor: 'default' }}
                      onContextMenu={e => { e.preventDefault(); setVCtxMenu({ x: e.clientX, y: e.clientY, kind: 'vendor', idx: i }); setCtxMenu(null) }}>
                      <td style={{ textAlign: 'center', color: '#aaa', fontSize: 10 }}>{i + 1}</td>
                      <td style={{ fontWeight: 700, color: purpleD }}>{v.vendor_id}</td>
                      <td style={{ color: '#374151' }}>{v.brand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ padding: '5px 14px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4', position: 'sticky', bottom: 0 }}>
            {filteredVendors.length} of {vendors.length} rows · Right-click a row to edit or delete
          </div>
        </div>
      )}

      {/* ══ STORE IDs TAB ════════════════════════════════════════════════════ */}
      {tab === 'stores' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Add store */}
          <form onSubmit={addStore} style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={labelStyle}>New Store ID:</label>
            <input value={newStoreId} onChange={e => setNewStoreId(e.target.value.toUpperCase())} maxLength={10}
              placeholder="e.g. BK1" style={{ ...inlineInput, width: 90, textTransform: 'uppercase', fontWeight: 700 }} />
            <button type="submit"
              style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + Add Store
            </button>
            <span style={{ fontSize: 11, color: '#9b8ec4', marginLeft: 8 }}>Store IDs are saved in your browser and used across User ID dropdowns.</span>
          </form>

          {/* Store list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 60px' }}>
            <div style={{ maxWidth: 480 }}>
              {stores.map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: `1px solid ${border}`, borderRadius: 7, padding: '7px 12px', marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, color: '#3730a3', fontSize: 13, letterSpacing: '0.06em' }}>{s}</span>
                  {s === 'ALL' ? (
                    <span style={{ fontSize: 11, color: '#b8aed8' }}>reserved</span>
                  ) : (
                    <button onClick={() => removeStore(s)}
                      style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '5px 14px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4', position: 'sticky', bottom: 0 }}>
            {stores.length} store{stores.length !== 1 ? 's' : ''} · Changes apply immediately to all dropdowns
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU (Users) ── */}
      {ctxMenu && (
        <div ref={ctxRef} className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="ctx-item" onClick={() => {
            const u = users.find(x => x.userid === ctxMenu.userId)
            if (u) setEditUser({ ...u })
            setCtxMenu(null)
          }}>✏️ Edit</div>
          <div className="ctx-item danger" onClick={() => {
            deleteUser(ctxMenu.userId)
            setCtxMenu(null)
          }}>🗑 Delete</div>
        </div>
      )}

      {/* ── CONTEXT MENU (Vendors) ── */}
      {vCtxMenu && (
        <div ref={ctxRef} className="ctx-menu" style={{ left: vCtxMenu.x, top: vCtxMenu.y }}>
          <div className="ctx-item" onClick={() => {
            const v = filteredVendors[vCtxMenu.idx]
            setEditVendor({ idx: vCtxMenu.idx, vendor_id: v.vendor_id, brand: v.brand })
            setVCtxMenu(null)
          }}>✏️ Edit</div>
          <div className="ctx-item danger" onClick={() => {
            deleteVendorRow(vCtxMenu.idx)
            setVCtxMenu(null)
          }}>🗑 Delete</div>
        </div>
      )}

      {/* ── EDIT USER MODAL ── */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit User: {editUser.userid}</h3>
            <label>User ID</label>
            <input value={editUser.userid} onChange={e => setEditUser(u => u ? { ...u, userid: e.target.value.toUpperCase() } : u)} maxLength={10} />
            <label>Store</label>
            <select value={editUser.store} onChange={e => setEditUser(u => u ? { ...u, store: e.target.value } : u)}>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
            <label>Location</label>
            <select value={editUser.location || ''} onChange={e => setEditUser(u => u ? { ...u, location: e.target.value } : u)}>
              <option value="">—</option>
              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
            </select>
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setEditUser(null)}>Cancel</button>
              <button className="btn-save" onClick={saveEditUser}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT VENDOR MODAL ── */}
      {editVendor && (
        <div className="modal-overlay" onClick={() => setEditVendor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Vendor Row</h3>
            <label>Vendor ID</label>
            <input value={editVendor.vendor_id} onChange={e => setEditVendor(v => v ? { ...v, vendor_id: e.target.value } : v)} />
            <label>Brand</label>
            <input value={editVendor.brand} onChange={e => setEditVendor(v => v ? { ...v, brand: e.target.value } : v)} />
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setEditVendor(null)}>Cancel</button>
              <button className="btn-save" onClick={saveEditVendor}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#3b1f8c', color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

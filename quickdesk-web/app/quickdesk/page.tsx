'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

const STORES = ['PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']
const DELETE_PASSWORD = 'delete'

interface ScanData { qty: number; [col: string]: string | number }
interface UPCSession {
  id?: string
  name: string
  store: string
  created_at?: string
  saved_at?: string
  order_list: string[]
  data: Record<string, ScanData>
  extra_cols: string[]
}

const purple = '#7c3aed'
const purpleD = '#6d28d9'
const purpleLight = '#f5f3ff'
const border = '#c4b5fd'

export default function QDPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [session, setSession] = useState<UPCSession | null>(null)
  const [savedSessions, setSavedSessions] = useState<(UPCSession & { id: string })[]>([])
  const [sortAsc, setSortAsc] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  // New session modal
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStore, setNewStore] = useState('PO')

  // Extra col prompt
  const [colPrompt, setColPrompt] = useState(false)
  const [colName, setColName] = useState('')
  const pendingScanRef = useRef<string>('')

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    loadSessions()
  }, [router])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function loadSessions() {
    const { data } = await supabase
      .from('upc_sessions')
      .select('*')
      .order('saved_at', { ascending: false })
    setSavedSessions((data || []) as (UPCSession & { id: string })[])
  }

  function startSession() {
    if (!newName.trim()) { showToast('Enter a session name'); return }
    const newSess: UPCSession = {
      name: newName.trim(),
      store: newStore,
      order_list: [],
      data: {},
      extra_cols: [],
    }
    // If user tried to scan before starting, process it now
    const pending = pendingScanRef.current
    if (pending) {
      newSess.order_list = [pending]
      newSess.data[pending] = { qty: 1 }
      pendingScanRef.current = ''
    }
    setSession(newSess)
    setShowModal(false)
    setNewName('')
    setTimeout(() => inputRef.current?.focus(), 100)
    showToast(`Session: ${newName.trim()}`)
  }

  function loadSessionData(s: UPCSession & { id: string }) {
    setSession({ ...s })
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function handleScan(upc: string) {
    upc = upc.trim()
    if (!session) { pendingScanRef.current = upc; setShowModal(true); return }
    if (!upc) return
    setSession(prev => {
      if (!prev) return prev
      const d = { ...prev.data }
      if (d[upc]) {
        d[upc] = { ...d[upc], qty: (d[upc].qty as number) + 1 }
      } else {
        const empty: ScanData = { qty: 1 }
        prev.extra_cols.forEach(c => { empty[c] = '' })
        d[upc] = empty
      }
      const order = d[upc].qty === 1 ? [...prev.order_list, upc] : prev.order_list
      return { ...prev, order_list: order, data: d }
    })
  }

  function updateQty(upc: string, val: string) {
    const q = parseInt(val, 10)
    if (isNaN(q) || q <= 0) { removeUpc(upc); return }
    setSession(prev => prev ? { ...prev, data: { ...prev.data, [upc]: { ...prev.data[upc], qty: q } } } : prev)
  }

  function updateExtra(upc: string, col: string, val: string) {
    setSession(prev => prev ? { ...prev, data: { ...prev.data, [upc]: { ...prev.data[upc], [col]: val } } } : prev)
  }

  function removeUpc(upc: string) {
    setSession(prev => {
      if (!prev) return prev
      const d = { ...prev.data }; delete d[upc]
      return { ...prev, order_list: prev.order_list.filter(u => u !== upc), data: d }
    })
  }

  function addExtraCol() {
    const n = colName.trim()
    if (!n) return
    if (session?.extra_cols.includes(n)) { showToast('Column already exists'); return }
    setSession(prev => {
      if (!prev) return prev
      const d = { ...prev.data }
      prev.order_list.forEach(upc => { d[upc] = { ...d[upc], [n]: '' } })
      return { ...prev, extra_cols: [...prev.extra_cols, n], data: d }
    })
    setColName('')
    setColPrompt(false)
  }

  function removeExtraCol(col: string) {
    if (!confirm(`Remove column "${col}"?`)) return
    setSession(prev => {
      if (!prev) return prev
      const d = { ...prev.data }
      prev.order_list.forEach(upc => { const r = { ...d[upc] }; delete r[col]; d[upc] = r })
      return { ...prev, extra_cols: prev.extra_cols.filter(c => c !== col), data: d }
    })
  }

  async function saveSession() {
    if (!session || !session.order_list.length) { showToast('Nothing to save yet'); return }
    setSaving(true)
    const payload = {
      name: session.name,
      store: session.store,
      order_list: session.order_list,
      data: session.data,
      extra_cols: session.extra_cols,
      saved_at: new Date().toISOString(),
    }
    if (session.id) {
      await supabase.from('upc_sessions').update(payload).eq('id', session.id)
    } else {
      const { data } = await supabase.from('upc_sessions').insert(payload).select().single()
      if (data) setSession(prev => prev ? { ...prev, id: data.id } : prev)
    }
    await loadSessions()
    setSaving(false)
    showToast('✓ Saved!')
  }

  async function deleteSession(s: UPCSession & { id: string }) {
    const pw = prompt(`Enter password to delete "${s.name}":`)
    if (pw === null) return
    if (pw.trim() !== DELETE_PASSWORD) { showToast('⚠ Wrong password'); return }
    if (!confirm(`Delete "${s.name}"?`)) return
    await supabase.from('upc_sessions').delete().eq('id', s.id)
    if (session?.id === s.id) setSession(null)
    loadSessions()
    showToast('🗑 Deleted')
  }

  function clearSession() {
    if (!session || !confirm('Clear all scans?')) return
    setSession(prev => prev ? { ...prev, order_list: [], data: {} } : prev)
  }

  function exportCSV(s?: UPCSession) {
    const src = s || session
    if (!src || !src.order_list.length) { showToast('Nothing to export'); return }
    const extra = src.extra_cols
    const headers = ['UPC', 'Qty', ...extra, 'Store ID', 'Session']
    const rows = src.order_list.map(upc => {
      const d = src.data[upc]
      return [upc, d.qty, ...extra.map(n => d[n] || ''), src.store, src.name]
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${src.name}_${src.store}.csv`
    a.click()
    showToast('✓ CSV downloaded!')
  }

  const totalQty = session ? Object.values(session.data).reduce((s, r) => s + (r.qty as number), 0) : 0
  const uniqueCount = session?.order_list.length ?? 0
  const rows = session ? (sortAsc ? session.order_list : [...session.order_list].reverse()) : []

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ background: '#e8e4f8', borderBottom: `2px solid ${border}`, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: purpleD }}>
          ▌▌▌ UPC SCANNER
          <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
            {session ? `${session.name} — ${session.store}` : 'No Active Session'}
          </span>
        </span>
        <div style={{ flex: 1 }} />
        <Btn color="primary" onClick={() => setShowModal(true)}>+ New Invoice #</Btn>
        <Btn color="yellow" onClick={saveSession} disabled={saving || !session?.order_list.length}>
          {saving ? '…' : '💾 Save'}
        </Btn>
        <Btn color="green" onClick={() => exportCSV()}>↓ Export CSV</Btn>
        <Btn color="ghost" onClick={() => router.push('/selector')}>← Home</Btn>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1, minHeight: 0, height: 'calc(100vh - 44px)' }}>

        {/* Left panel */}
        <div style={{ background: '#fff', borderRight: `1px solid ${border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>

          {/* Scan input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={labelSt}>Scan Barcode / UPC</label>
            <input ref={inputRef} type="text" placeholder="Scan or type code…"
              style={{ ...inputSt, fontSize: 11, fontWeight: 600, letterSpacing: '0.8px' }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value;
                  if (v) { handleScan(v); (e.target as HTMLInputElement).value = '' }
                }
              }} />
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[['Total Qty', totalQty], ['Unique', uniqueCount]].map(([lbl, num]) => (
              <div key={lbl as string} style={{ flex: 1, background: purpleLight, border: `1px solid ${border}`, borderRadius: 5, padding: '4px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: purple }}>{num}</div>
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
              </div>
            ))}
          </div>

          <hr style={{ border: 'none', borderTop: `1px solid ${border}` }} />

          {/* Custom columns */}
          <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: purpleD, marginBottom: 6 }}>Custom Columns</div>
            {session?.extra_cols.map(col => (
              <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: purpleD, flex: 1 }}>📌 {col}</span>
                <button onClick={() => removeExtraCol(col)}
                  style={{ background: '#fee2e2', border: 'none', color: '#dc2626', fontSize: 10, padding: '2px 5px', borderRadius: 3, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            {colPrompt ? (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input value={colName} onChange={e => setColName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addExtraCol()}
                  autoFocus placeholder="Column name…"
                  style={{ ...inputSt, flex: 1, fontSize: 11 }} />
                <button onClick={addExtraCol} style={{ ...btnSt('primary'), fontSize: 10, padding: '3px 8px' }}>Add</button>
                <button onClick={() => { setColPrompt(false); setColName('') }} style={{ ...btnSt('ghost'), fontSize: 10, padding: '3px 6px' }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setColPrompt(true)}
                style={{ width: '100%', ...btnSt('ghost'), justifyContent: 'center', fontSize: 11, padding: '3px 8px', marginTop: 2 }}>
                + Add Column
              </button>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: `1px solid ${border}` }} />

          {/* Saved sessions */}
          <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: purpleD, textTransform: 'uppercase', letterSpacing: '0.4px', flex: 1 }}>Saved Sessions</span>
              <button onClick={loadSessions} style={{ ...btnSt('ghost'), fontSize: 10, padding: '2px 6px' }}>🔄</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
              {savedSessions.length === 0 && (
                <div style={{ color: '#6b7280', fontSize: 11, padding: 6, textAlign: 'center' }}>No saved sessions.</div>
              )}
              {savedSessions.map(s => {
                const total = Object.values(s.data).reduce((a, r) => a + (r.qty as number), 0)
                return (
                  <div key={s.id} style={{ background: purpleLight, border: `1px solid ${border}`, borderRadius: 5, padding: '5px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>{s.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: total > 0 ? '#dcfce7' : '#fef3c7', color: total > 0 ? '#166534' : '#92400e' }}>
                        {total > 0 ? '✓' : 'Empty'}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280', margin: '2px 0' }}>
                      {s.store} · {s.order_list.length} UPCs · {total} qty
                    </div>
                    <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
                      <button onClick={() => loadSessionData(s)} style={{ ...btnSt('green'), fontSize: 10, padding: '2px 7px', flex: 1 }}>Load</button>
                      <button onClick={() => exportCSV(s)} style={{ ...btnSt('ghost'), fontSize: 10, padding: '2px 7px', flex: 1 }}>↓ CSV</button>
                      <button onClick={() => deleteSession(s)} style={{ ...btnSt('red'), fontSize: 10, padding: '2px 6px' }}>✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <button onClick={clearSession}
            style={{ width: '100%', ...btnSt('red'), justifyContent: 'center', fontSize: 11 }}>
            🗑 Clear Session
          </button>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ background: '#e8e4f8', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>Session Table</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSortAsc(a => !a)} style={{ ...btnSt('ghost'), fontSize: 10, padding: '3px 8px' }}>⇅ Sort</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!session || session.order_list.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#6b7280', padding: '50px 20px', fontSize: 13 }}>
                {session ? 'Start scanning barcodes.' : 'Start a session and scan barcodes to begin.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#CFC5ED', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={thSt}>#</th>
                    <th style={thSt}>UPC</th>
                    <th style={thSt}>Qty</th>
                    {session.extra_cols.map(c => <th key={c} style={thSt}>{c}</th>)}
                    <th style={{ ...thSt, width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((upc, ri) => {
                    const row = session.data[upc]
                    return (
                      <tr key={upc} style={{ background: ri % 2 === 0 ? purpleLight : '#fafafa', borderBottom: `1px solid #ede9fe` }}>
                        <td style={{ ...tdSt, color: '#6b7280', fontSize: 10 }}>{ri + 1}</td>
                        <td style={{ ...tdSt, fontFamily: 'Courier New, monospace', fontWeight: 600, letterSpacing: '0.4px' }}>{upc}</td>
                        <td style={tdSt}>
                          <input type="number" min="0" defaultValue={row.qty}
                            style={{ width: 52, padding: '2px 6px', border: `1.5px solid ${border}`, borderRadius: 3, fontSize: 12, fontWeight: 700, color: purple, textAlign: 'center', background: '#fff', fontFamily: 'Inter, sans-serif' }}
                            onChange={e => updateQty(upc, e.target.value)}
                            onBlur={e => { if (!e.target.value || +e.target.value <= 0) removeUpc(upc) }} />
                        </td>
                        {session.extra_cols.map(col => (
                          <td key={col} style={tdSt}>
                            <input type="text" defaultValue={row[col] as string || ''}
                              style={{ width: 72, padding: '2px 6px', border: `1.5px solid ${border}`, borderRadius: 3, fontSize: 12, background: '#fff', fontFamily: 'Inter, sans-serif' }}
                              onChange={e => updateExtra(upc, col, e.target.value)} />
                          </td>
                        ))}
                        <td style={tdSt}>
                          <button onClick={() => removeUpc(upc)}
                            style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 13, cursor: 'pointer', padding: '1px 5px', borderRadius: 3 }}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* New session modal */}
      {showModal && (
        <div onClick={e => e.target === e.currentTarget && setShowModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 'min(360px, 94vw)', boxShadow: '0 16px 50px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: purpleD, marginBottom: 14 }}>New Invoice Session</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
              <label style={labelSt}>Session Name / Invoice #</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startSession()}
                autoFocus placeholder="e.g. 2813782" style={inputSt} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 16 }}>
              <label style={labelSt}>Store</label>
              <select value={newStore} onChange={e => setNewStore(e.target.value)} style={inputSt}>
                {STORES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnSt('ghost')}>Cancel</button>
              <button onClick={startSession} style={btnSt('primary')}>Start</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: purple, color: '#fff', padding: '7px 18px', borderRadius: 20, fontSize: 12, fontWeight: 700, zIndex: 200, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function Btn({ color, onClick, disabled, children }: { color: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...btnSt(color), opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  )
}

function btnSt(color: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    primary: { background: '#7c3aed', color: '#fff' },
    green:   { background: '#bbf7d0', color: '#166534' },
    yellow:  { background: '#fef3c7', color: '#92400e' },
    red:     { background: '#fee2e2', color: '#dc2626' },
    ghost:   { background: '#e8e4f8', color: '#6b7280', border: '1px solid #c4b5fd' },
  }
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', border: 'none', borderRadius: 4,
    fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
    ...(map[color] || map.ghost),
  }
}

const labelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px',
}

const inputSt: React.CSSProperties = {
  width: '100%', padding: '5px 8px', border: '1.5px solid #c4b5fd',
  borderRadius: 4, fontFamily: 'Inter, sans-serif', fontSize: 12,
  background: '#f5f3ff', color: '#1f2937', outline: 'none',
}

const thSt: React.CSSProperties = {
  padding: '4px 10px', textAlign: 'left', fontWeight: 700, fontSize: 10,
  color: '#1A0A40', borderBottom: '2px solid #c4b5fd',
}

const tdSt: React.CSSProperties = {
  padding: '3px 10px', verticalAlign: 'middle',
}

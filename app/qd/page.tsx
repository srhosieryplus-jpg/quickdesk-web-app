'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const STORES = ['PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']
const DELETE_PASSWORD = 'delete'
const ADMINS = ['SR', 'STAR']

// Each row in a session — identified by a stable row_id (not UPC)
interface ScanRow {
  row_id: string        // stable identifier (uuid-ish)
  upc: string          // empty until scanned
  qty: number
  [col: string]: string | number
}

interface UPCSession {
  id?: string
  name: string
  store: string
  userid?: string
  saved_at?: string
  rows: ScanRow[]       // ordered list of rows
  extra_cols: string[]  // non-UPC columns (Pcode, Color, Size, etc.)
}

const purple = '#7c3aed'
const purpleD = '#6d28d9'
const purpleLight = '#f5f3ff'
const border = '#c4b5fd'

type Tab = 'scanner' | 'history'

let rowIdCounter = 0
function newRowId() { return `r${Date.now()}_${++rowIdCounter}` }

function emptyRow(extra_cols: string[]): ScanRow {
  const r: ScanRow = { row_id: newRowId(), upc: '', qty: 0 }
  extra_cols.forEach(c => { r[c] = '' })
  return r
}

export default function QDPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const isAdmin = (u: User | null) => u && ADMINS.includes(u.userid.toUpperCase())

  const [tab, setTab] = useState<Tab>('scanner')
  const [session, setSession] = useState<UPCSession | null>(null)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [recentSessions, setRecentSessions] = useState<(UPCSession & { id: string })[]>([])
  const [allSessions, setAllSessions] = useState<(UPCSession & { id: string })[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStore, setNewStore] = useState('PO')

  const [colPrompt, setColPrompt] = useState(false)
  const [colName, setColName] = useState('')

  const [showSmartPaste, setShowSmartPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pastePreview, setPastePreview] = useState<{ headers: string[]; rows: string[][] } | null>(null)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    if (u.store) setNewStore(u.store.toUpperCase())
    loadSessions(u)
  }, [router])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function loadSessions(u?: User) {
    const user = u || currentUser
    if (!user) return
    let query = supabase.from('upc_sessions').select('*').order('saved_at', { ascending: false })
    if (!isAdmin(user)) query = query.eq('userid', user.userid)
    const { data } = await query
    const all = (data || []) as (UPCSession & { id: string })[]
    setAllSessions(all)
    setRecentSessions(all.slice(0, 5))
  }

  function startSession() {
    if (!newName.trim()) { showToast('Enter a session name'); return }
    const newSess: UPCSession = {
      name: newName.trim(),
      store: newStore,
      userid: currentUser?.userid,
      rows: [emptyRow([])],
      extra_cols: [],
    }
    setSession(newSess)
    setActiveRowId(newSess.rows[0].row_id)
    setShowModal(false)
    setNewName('')
    setTimeout(() => inputRef.current?.focus(), 100)
    showToast(`Session: ${newName.trim()}`)
  }

  function loadSessionData(s: UPCSession & { id: string }) {
    // Support old sessions that used order_list/data format
    const loaded = migrateSession(s)
    setSession(loaded)
    // Set active to first row with no UPC, or last row
    const firstEmpty = loaded.rows.find(r => !r.upc)
    setActiveRowId(firstEmpty?.row_id ?? loaded.rows[loaded.rows.length - 1]?.row_id ?? null)
    setTab('scanner')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // Migrate old sessions (order_list/data) to new rows format
  function migrateSession(s: UPCSession & { id: string }): UPCSession & { id: string } {
    if (s.rows) return s
    // Old format: order_list + data
    const old = s as unknown as { order_list?: string[]; data?: Record<string, {qty:number;[k:string]:string|number}>; extra_cols?: string[] }
    if (old.order_list && old.data) {
      const extra = old.extra_cols || []
      const rows: ScanRow[] = old.order_list.map(upc => {
        const d = old.data![upc]
        const r: ScanRow = { row_id: newRowId(), upc, qty: d.qty as number }
        extra.forEach(c => { r[c] = d[c] || '' })
        return r
      })
      return { ...s, rows, extra_cols: extra }
    }
    return { ...s, rows: [emptyRow(s.extra_cols || [])], extra_cols: s.extra_cols || [] }
  }

  // Find the active row index; fall back to first empty row or last row
  function getActiveIdx(rows: ScanRow[], activeId: string | null): number {
    if (activeId) {
      const i = rows.findIndex(r => r.row_id === activeId)
      if (i >= 0) return i
    }
    const emptyIdx = rows.findIndex(r => !r.upc)
    return emptyIdx >= 0 ? emptyIdx : rows.length - 1
  }

  function handleScan(upc: string) {
    upc = upc.trim()
    if (!upc) return
    if (!session) { setShowModal(true); return }

    setSession(prev => {
      if (!prev) return prev
      const rows = [...prev.rows]

      // Check if this UPC already exists in another row — increment qty there
      const existingIdx = rows.findIndex(r => r.upc === upc)
      if (existingIdx >= 0) {
        rows[existingIdx] = { ...rows[existingIdx], qty: rows[existingIdx].qty + 1 }
        setActiveRowId(rows[existingIdx].row_id)
        return { ...prev, rows }
      }

      // Fill active row with this UPC
      const activeIdx = getActiveIdx(rows, activeRowId)
      rows[activeIdx] = { ...rows[activeIdx], upc, qty: 1 }

      // Auto-advance: find next empty row after this one, or append a new one
      const nextEmptyIdx = rows.findIndex((r, i) => i > activeIdx && !r.upc)
      if (nextEmptyIdx >= 0) {
        setActiveRowId(rows[nextEmptyIdx].row_id)
      } else {
        // Append a new empty row if there are no more empty rows after active
        const hasMoreEmpty = rows.some((r, i) => i !== activeIdx && !r.upc)
        if (!hasMoreEmpty) {
          const newRow = emptyRow(prev.extra_cols)
          rows.push(newRow)
          setActiveRowId(newRow.row_id)
        } else {
          // Wrap to first empty before active
          const firstEmpty = rows.find(r => !r.upc)
          setActiveRowId(firstEmpty?.row_id ?? null)
        }
      }

      return { ...prev, rows }
    })
  }

  function setActiveRow(row_id: string) {
    setActiveRowId(row_id)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function updateRowUpc(row_id: string, upc: string) {
    setSession(prev => {
      if (!prev) return prev
      return { ...prev, rows: prev.rows.map(r => r.row_id === row_id ? { ...r, upc } : r) }
    })
  }

  function updateRowQty(row_id: string, val: string) {
    const q = parseInt(val, 10)
    setSession(prev => {
      if (!prev) return prev
      if (isNaN(q) || q < 0) return prev
      return { ...prev, rows: prev.rows.map(r => r.row_id === row_id ? { ...r, qty: q } : r) }
    })
  }

  function updateRowExtra(row_id: string, col: string, val: string) {
    setSession(prev => {
      if (!prev) return prev
      return { ...prev, rows: prev.rows.map(r => r.row_id === row_id ? { ...r, [col]: val } : r) }
    })
  }

  function removeRow(row_id: string) {
    setSession(prev => {
      if (!prev) return prev
      const rows = prev.rows.filter(r => r.row_id !== row_id)
      // Keep at least one row
      if (rows.length === 0) rows.push(emptyRow(prev.extra_cols))
      if (activeRowId === row_id) setActiveRowId(rows[0].row_id)
      return { ...prev, rows }
    })
  }

  function addEmptyRow() {
    setSession(prev => {
      if (!prev) return prev
      const r = emptyRow(prev.extra_cols)
      setActiveRowId(r.row_id)
      return { ...prev, rows: [...prev.rows, r] }
    })
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function addExtraCol() {
    const n = colName.trim()
    if (!n) return
    if (session?.extra_cols.includes(n)) { showToast('Column already exists'); return }
    setSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        extra_cols: [...prev.extra_cols, n],
        rows: prev.rows.map(r => ({ ...r, [n]: r[n] ?? '' })),
      }
    })
    setColName('')
    setColPrompt(false)
  }

  function removeExtraCol(col: string) {
    if (!confirm(`Remove column "${col}"?`)) return
    setSession(prev => {
      if (!prev) return prev
      const rows = prev.rows.map(r => { const nr = { ...r }; delete nr[col]; return nr })
      return { ...prev, extra_cols: prev.extra_cols.filter(c => c !== col), rows }
    })
  }

  // ── Smart Paste ──────────────────────────────────────────────────────────────

  function parsePasteText(text: string): { headers: string[]; rows: string[][] } | null {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return null
    const splitLine = (line: string) => {
      if (line.includes('\t')) return line.split('\t').map(c => c.trim())
      const result: string[] = []
      let cur = '', inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
        else { cur += ch }
      }
      result.push(cur.trim())
      return result
    }
    const headers = splitLine(lines[0])
    const rows = lines.slice(1).map(splitLine)
    return { headers, rows }
  }

  function handlePasteChange(text: string) {
    setPasteText(text)
    setPastePreview(parsePasteText(text))
  }

  function applySmartPaste() {
    if (!pastePreview) return
    const { headers, rows: dataRows } = pastePreview

    if (!session) {
      showToast('Start a session first, then use Smart Paste')
      setShowSmartPaste(false)
      setShowModal(true)
      return
    }

    setSession(prev => {
      if (!prev) return prev

      // All columns from paste become extra_cols
      const newExtra = [...prev.extra_cols]
      headers.forEach(h => { if (!newExtra.includes(h)) newExtra.push(h) })

      // Build new rows from paste data; each row starts with no UPC
      const pastedRows: ScanRow[] = dataRows
        .filter(r => r.some(c => c.trim())) // skip blank rows
        .map(r => {
          const row: ScanRow = { row_id: newRowId(), upc: '', qty: 0 }
          headers.forEach((h, i) => { row[h] = r[i] || '' })
          return row
        })

      // Remove existing empty rows, keep any already-scanned rows, append pasted rows
      const existingScanned = prev.rows.filter(r => r.upc)
      const merged = [...existingScanned, ...pastedRows]

      // Set active to first row with no upc
      const firstEmpty = merged.find(r => !r.upc)
      setActiveRowId(firstEmpty?.row_id ?? merged[merged.length - 1]?.row_id ?? null)

      return { ...prev, extra_cols: newExtra, rows: merged }
    })

    showToast(`✓ ${dataRows.filter(r => r.some(c => c.trim())).length} rows loaded — ready to scan!`)
    setShowSmartPaste(false)
    setPasteText('')
    setPastePreview(null)
  }

  // ── Save / Delete / Export ───────────────────────────────────────────────────

  async function saveSession() {
    if (!session) return
    const hasData = session.rows.some(r => r.upc || r.qty > 0 || session.extra_cols.some(c => r[c]))
    if (!hasData) { showToast('Nothing to save yet'); return }
    setSaving(true)
    const payload = {
      name: session.name,
      store: session.store,
      userid: currentUser?.userid || '',
      rows: session.rows,
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

  async function goHome() {
    if (session && session.rows.length > 0) await saveSession()
    router.push('/selector')
  }

  function clearSession() {
    if (!session || !confirm('Clear all scans?')) return
    const fresh = [emptyRow(session.extra_cols)]
    setSession(prev => prev ? { ...prev, rows: fresh } : prev)
    setActiveRowId(fresh[0].row_id)
  }

  function exportCSV(s?: UPCSession) {
    const src = s || session
    if (!src) { showToast('Nothing to export'); return }
    const scanned = src.rows.filter(r => r.upc)
    if (!scanned.length) { showToast('No scanned UPCs yet'); return }
    const extra = src.extra_cols
    const headers = ['UPC', 'Qty', ...extra, 'Store ID', 'Session', 'User']
    const rows = scanned.map(r => [r.upc, r.qty, ...extra.map(n => r[n] || ''), src.store, src.name, src.userid || ''])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${src.name}_${src.store}.csv`
    a.click()
    showToast('✓ CSV downloaded!')
  }

  const scannedRows = session?.rows.filter(r => r.upc) ?? []
  const totalQty = scannedRows.reduce((s, r) => s + r.qty, 0)
  const totalRows = session?.rows.length ?? 0
  const scannedCount = scannedRows.length

  const filteredHistory = allSessions.filter(s => {
    const q = historySearch.toLowerCase()
    return !q || s.name.toLowerCase().includes(q) || s.store.toLowerCase().includes(q) || (s.userid || '').toLowerCase().includes(q)
  })

  function SessionCard({ s, showUser }: { s: UPCSession & { id: string }; showUser?: boolean }) {
    const loaded = s.rows ? s : migrateSession(s)
    const scanned = loaded.rows.filter(r => r.upc)
    const total = scanned.reduce((a, r) => a + r.qty, 0)
    const date = s.saved_at ? new Date(s.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    return (
      <div style={{ background: purpleLight, border: `1px solid ${border}`, borderRadius: 5, padding: '5px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>{s.name}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: total > 0 ? '#dcfce7' : '#fef3c7', color: total > 0 ? '#166534' : '#92400e' }}>
            {total > 0 ? '✓' : 'Empty'}
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', margin: '2px 0' }}>
          {s.store}{showUser && s.userid ? ` · ${s.userid}` : ''} · {scanned.length}/{loaded.rows.length} scanned · {total} qty{date ? ` · ${date}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
          <button onClick={() => loadSessionData(s)} style={{ ...btnSt('green'), fontSize: 10, padding: '2px 7px', flex: 1 }}>Load</button>
          <button onClick={() => exportCSV(loaded)} style={{ ...btnSt('ghost'), fontSize: 10, padding: '2px 7px', flex: 1 }}>↓ CSV</button>
          <button onClick={() => deleteSession(s)} style={{ ...btnSt('red'), fontSize: 10, padding: '2px 6px' }}>✕</button>
        </div>
      </div>
    )
  }

  const activeIdx = session ? getActiveIdx(session.rows, activeRowId) : -1

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', borderBottom: '1px solid #d4c8f0',
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={goHome} style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>← Home</button>
          <div style={{ width: 1, height: 16, background: '#d4c8f0' }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{currentUser?.userid}</span>
            {currentUser?.store ? <> · {currentUser.store === 'ALL' ? 'All Stores' : currentUser.store}</> : ''}
          </span>
        </div>

        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#7c3aed', letterSpacing: '0.05em' }}>▌▌▌</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>UPC SCANNER</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: session ? '#dcfce7' : '#fee2e2',
            color: session ? '#166534' : '#dc2626',
            borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700,
            pointerEvents: 'auto',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: session ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
            {session ? 'LIVE' : 'IDLE'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Btn color="primary" onClick={() => setShowModal(true)}>+ New Invoice #</Btn>
          <Btn color="yellow" onClick={saveSession} disabled={saving || !session}>
            {saving ? '…' : '💾 Save'}
          </Btn>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#e8e4f8', borderBottom: `1px solid ${border}`, display: 'flex', gap: 0 }}>
        {(['scanner', 'history'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: tab === t ? `2px solid ${purple}` : '2px solid transparent', background: 'none', color: tab === t ? purple : '#6b7280', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'Inter, sans-serif' }}>
            {t === 'scanner' ? '📷 Scanner' : '🗂 History'}
          </button>
        ))}
      </div>

      {/* Scanner tab */}
      {tab === 'scanner' && (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1, minHeight: 0, height: 'calc(100vh - 80px)' }}>

          {/* Left panel */}
          <div style={{ background: '#fff', borderRight: `1px solid ${border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={labelSt}>Scan Barcode / UPC</label>
              <input ref={inputRef} type="text" placeholder="Scan or type UPC…"
                style={{ ...inputSt, fontSize: 11, fontWeight: 600, letterSpacing: '0.8px' }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (v) { handleScan(v); (e.target as HTMLInputElement).value = '' }
                  }
                }} />
            </div>

            {/* Progress stats */}
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                ['Scanned', `${scannedCount}/${totalRows}`],
                ['Total Qty', totalQty],
              ].map(([lbl, num]) => (
                <div key={lbl as string} style={{ flex: 1, background: purpleLight, border: `1px solid ${border}`, borderRadius: 5, padding: '3px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: purple }}>{num}</div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
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

            {/* Smart Paste button */}
            <button onClick={() => setShowSmartPaste(true)}
              style={{ width: '100%', ...btnSt('ghost'), justifyContent: 'center', fontSize: 11, padding: '5px 8px', background: '#ede9fe', color: '#6d28d9', border: `1px solid ${border}` }}>
              📋 Smart Paste
            </button>

            <hr style={{ border: 'none', borderTop: `1px solid ${border}` }} />

            {/* Recent sessions */}
            <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: purpleD, textTransform: 'uppercase', letterSpacing: '0.4px', flex: 1 }}>Recent (last 5)</span>
                <button onClick={() => loadSessions()} style={{ ...btnSt('ghost'), fontSize: 10, padding: '2px 6px' }}>🔄</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
                {recentSessions.length === 0 && (
                  <div style={{ color: '#6b7280', fontSize: 11, padding: 6, textAlign: 'center' }}>No saved sessions.</div>
                )}
                {recentSessions.map(s => (
                  <SessionCard key={s.id} s={s} showUser={isAdmin(currentUser) ?? false} />
                ))}
                {allSessions.length > 5 && (
                  <button onClick={() => setTab('history')}
                    style={{ ...btnSt('ghost'), fontSize: 10, justifyContent: 'center', padding: '3px 8px' }}>
                    View all {allSessions.length} →
                  </button>
                )}
              </div>
            </div>

            <button onClick={clearSession}
              style={{ width: '100%', ...btnSt('red'), justifyContent: 'center', fontSize: 11 }}>
              🗑 Clear Session
            </button>
          </div>

          {/* Right panel — scan table */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ background: '#e8e4f8', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: `1px solid ${border}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>
                {session?.name ? `📋 ${session.name}` : 'Session Table'}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={addEmptyRow} style={{ ...btnSt('ghost'), fontSize: 10, padding: '3px 8px' }}>+ Row</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {!session ? (
                <div style={{ textAlign: 'center', color: '#6b7280', padding: '50px 20px', fontSize: 13 }}>
                  Start a session or load one from the left panel.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#CFC5ED', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={thSt}>#</th>
                      <th style={{ ...thSt, minWidth: 80 }}>UPC</th>
                      <th style={thSt}>Qty</th>
                      {session.extra_cols.map(c => <th key={c} style={thSt}>{c}</th>)}
                      <th style={{ ...thSt, width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.rows.map((row, ri) => {
                      const isActive = row.row_id === activeRowId
                      const isScanned = !!row.upc
                      return (
                        <tr key={row.row_id}
                          onClick={() => setActiveRow(row.row_id)}
                          style={{
                            background: isActive ? '#e0d9fb' : isScanned ? '#f0fdf4' : (ri % 2 === 0 ? purpleLight : '#fafafa'),
                            borderBottom: `1px solid ${isActive ? '#a78bfa' : '#ede9fe'}`,
                            cursor: 'pointer',
                            outline: isActive ? `2px solid #7c3aed` : 'none',
                            outlineOffset: -1,
                          }}>
                          <td style={{ ...tdSt, color: '#6b7280', fontSize: 10, userSelect: 'none' }}>
                            {isActive ? <span style={{ color: purple, fontWeight: 900 }}>▶</span> : ri + 1}
                          </td>
                          <td style={{ ...tdSt, fontFamily: 'Courier New, monospace', fontWeight: 600, letterSpacing: '0.4px' }}>
                            {isScanned ? (
                              <span style={{ color: isActive ? purpleD : '#374151' }}>{row.upc}</span>
                            ) : (
                              <span style={{ color: '#9ca3af', fontSize: 11 }}>{isActive ? '⬅ scan now' : '—'}</span>
                            )}
                          </td>
                          <td style={tdSt} onClick={e => e.stopPropagation()}>
                            <input type="number" min="0" value={row.qty}
                              style={{ width: 52, padding: '2px 6px', border: `1.5px solid ${border}`, borderRadius: 3, fontSize: 12, fontWeight: 700, color: purple, textAlign: 'center', background: '#fff', fontFamily: 'Inter, sans-serif' }}
                              onChange={e => updateRowQty(row.row_id, e.target.value)} />
                          </td>
                          {session.extra_cols.map(col => (
                            <td key={col} style={{ ...tdSt, maxWidth: 120 }} onClick={e => e.stopPropagation()}>
                              {/* Show as bold readable text; click the value to edit inline */}
                              <EditableCell
                                value={row[col] as string || ''}
                                onChange={val => updateRowExtra(row.row_id, col, val)}
                                isActive={isActive}
                              />
                            </td>
                          ))}
                          <td style={tdSt} onClick={e => e.stopPropagation()}>
                            <button onClick={() => removeRow(row.row_id)}
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
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 700, width: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: purpleD }}>
              {isAdmin(currentUser) ? 'All Sessions' : 'My Sessions'} · {allSessions.length}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => loadSessions()} style={{ ...btnSt('ghost'), fontSize: 11, padding: '3px 10px' }}>🔄 Refresh</button>
          </div>
          <input
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder={isAdmin(currentUser) ? 'Search by invoice, store or user…' : 'Search by invoice or store…'}
            style={{ ...inputSt, fontSize: 12 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
            {filteredHistory.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 32 }}>
                {historySearch ? 'No results.' : 'No sessions yet.'}
              </div>
            )}
            {filteredHistory.map(s => (
              <SessionCard key={s.id} s={s} showUser={isAdmin(currentUser) ?? false} />
            ))}
          </div>
        </div>
      )}

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
              <label style={labelSt}>Store ID</label>
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

      {/* Smart Paste modal */}
      {showSmartPaste && (
        <div onClick={e => e.target === e.currentTarget && setShowSmartPaste(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 20, width: 'min(520px, 96vw)', boxShadow: '0 16px 50px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📋</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: purpleD, flex: 1 }}>Smart Paste</span>
              <button onClick={() => { setShowSmartPaste(false); setPasteText(''); setPastePreview(null) }}
                style={{ background: 'none', border: 'none', fontSize: 16, color: '#6b7280', cursor: 'pointer' }}>✕</button>
            </div>

            <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
              Paste a table from Excel or Sheets (first row = headers like <strong>Pcode, Color, Size</strong>). Each row becomes a slot in the session — staff scans barcodes in order to fill them in. Tap any row to jump to it.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={labelSt}>Paste data here</label>
              <textarea
                value={pasteText}
                onChange={e => handlePasteChange(e.target.value)}
                placeholder={'Pcode\tColor\tSize\n8060\tIvory\tXS\n8060\tWine\tS'}
                rows={7}
                style={{ width: '100%', padding: '7px 10px', border: `1.5px solid ${border}`, borderRadius: 5, fontFamily: 'Courier New, monospace', fontSize: 11, background: purpleLight, color: '#1f2937', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            {pastePreview && (
              <>
                <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: 'auto', maxHeight: 220 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#CFC5ED' }}>
                        {pastePreview.headers.map(h => (
                          <th key={h} style={{ ...thSt, fontSize: 10 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pastePreview.rows.slice(0, 8).map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? purpleLight : '#fafafa' }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ ...tdSt, fontSize: 10 }}>
                              {cell || <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pastePreview.rows.length > 8 && (
                    <div style={{ padding: '4px 10px', fontSize: 10, color: '#6b7280', textAlign: 'center', borderTop: `1px solid ${border}` }}>
                      +{pastePreview.rows.length - 8} more rows
                    </div>
                  )}
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#166534' }}>
                  ✓ <strong>{pastePreview.rows.filter(r => r.some(c => c.trim())).length} rows</strong> ready to load as scan slots
                  {pastePreview.headers.length > 0 && (
                    <> · columns: <strong>{pastePreview.headers.join(', ')}</strong></>
                  )}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowSmartPaste(false); setPasteText(''); setPastePreview(null) }} style={btnSt('ghost')}>Cancel</button>
              <button onClick={applySmartPaste} disabled={!pastePreview}
                style={{ ...btnSt('primary'), opacity: pastePreview ? 1 : 0.4 }}>
                📋 Load Rows
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: purple, color: '#fff', padding: '7px 18px', borderRadius: 20, fontSize: 12, fontWeight: 700, zIndex: 200, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function EditableCell({ value, onChange, isActive }: { value: string; onChange: (v: string) => void; isActive: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { onChange(draft); setEditing(false) } }}
        style={{ width: '100%', minWidth: 60, padding: '2px 5px', border: `1.5px solid #7c3aed`, borderRadius: 3, fontSize: 12, background: '#fff', fontFamily: 'Inter, sans-serif', outline: 'none' }}
      />
    )
  }

  return (
    <div
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Click to edit"
      style={{
        display: 'inline-block',
        fontSize: 12,
        fontWeight: value ? 700 : 400,
        color: value ? (isActive ? '#4c1d95' : '#1f2937') : '#9ca3af',
        background: value ? (isActive ? '#ddd6fe' : '#ede9fe') : 'transparent',
        borderRadius: 4,
        padding: value ? '2px 7px' : '2px 4px',
        cursor: 'text',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        minWidth: 24,
      }}
    >
      {value || '—'}
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

'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const STORES = ['PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']
const DELETE_PASSWORD = 'delete'
const ADMINS = ['STEPH', 'STAR', 'SR']

interface ScanData { qty: number; [col: string]: string | number }
interface UPCSession {
  id?: string
  name: string
  store: string
  userid?: string
  saved_at?: string
  order_list: string[]
  data: Record<string, ScanData>
  extra_cols: string[]
  status?: 'waiting' | 'ready' | 'complete'
  rows?: { upc: string; qty: number }[]
}

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}

const purple = '#7c3aed'
const purpleD = '#6d28d9'
const purpleLight = '#f5f3ff'
const border = '#c4b5fd'

type Tab = 'scanner' | 'history'

export default function QDPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [scanVal, setScanVal] = useState('')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const isAdmin = (u: User | null) => u && ADMINS.includes(u.userid.toUpperCase())

  const [tab, setTab] = useState<Tab>('scanner')
  const [session, setSession] = useState<UPCSession | null>(null)
  const [recentSessions, setRecentSessions] = useState<(UPCSession & { id: string })[]>([])
  const [allSessions, setAllSessions] = useState<(UPCSession & { id: string })[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [sortAsc, setSortAsc] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStore, setNewStore] = useState('PO')

  const [colPrompt, setColPrompt] = useState(false)
  const [colName, setColName] = useState('')
  const pendingScanRef = useRef<string>('')
  const [targetedPlaceholder, setTargetedPlaceholder] = useState<string>('')
  const [ctxMenu, setCtxMenu] = useState<{ upc: string; x: number; y: number } | null>(null)
  const [editingUpc, setEditingUpc] = useState<{ key: string; val: string } | null>(null)

  const [showSmartPaste, setShowSmartPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pastePreview, setPastePreview] = useState<{ headers: string[]; rows: string[][] } | null>(null)

  // Camera scanning
  const [showCamera, setShowCamera] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    const userStore = u.store?.toUpperCase() || ''
    setNewStore(userStore === 'ALL' ? 'PO' : userStore)
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
    if (!isAdmin(user)) {
      query = query.eq('store', user.store)
    }
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
      order_list: [],
      data: {},
      extra_cols: [],
    }
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
    // Migrate new-schema sessions (rows[]) back to old-schema (order_list/data)
    const raw = s as UPCSession & { id: string; rows?: { upc: string; qty: number; [k: string]: string | number }[]; extra_cols?: string[] }
    if (raw.rows && raw.rows.length > 0) {
      const extra_cols = raw.extra_cols || []
      const order_list: string[] = []
      const data: Record<string, ScanData> = {}
      for (const r of raw.rows) {
        // Use upc if scanned, otherwise use row_id as placeholder key
        const key = (r.upc as string) || (r.row_id as string) || String(Math.random())
        if (!order_list.includes(key)) order_list.push(key)
        const entry: ScanData = { qty: r.qty || 0 }
        // Mark unscanned rows so UPC column shows blank
        entry['_isPlaceholder'] = r.upc ? 0 : 1
        extra_cols.forEach(c => { entry[c] = r[c] ?? '' })
        data[key] = entry
      }
      setSession({ ...s, order_list, data, extra_cols })
    } else {
      setSession({ ...s })
    }
    setTab('scanner')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function handleScan(upc: string) {
    upc = upc.trim()
    if (!session) { pendingScanRef.current = upc; setShowModal(true); return }
    if (!upc) return

    // Grab and clear targeted row
    const targetedKey = targetedPlaceholder || ''
    if (targetedKey) setTargetedPlaceholder('')

    setSession(prev => {
      if (!prev) return prev
      const d = { ...prev.data }
      const order = [...prev.order_list]

      // 1. Check for a placeholder to fill (targeted or next in order)
      const placeholderKey = (targetedKey && d[targetedKey]?.['_isPlaceholder'] === 1)
        ? targetedKey
        : order.find(k => d[k]?.['_isPlaceholder'] === 1)

      // Determine which placeholder to fill (targeted click takes priority, else next in order)
      const fillKey = (targetedKey && d[targetedKey]?.['_isPlaceholder'] === 1)
        ? targetedKey
        : order.find(k => d[k]?.['_isPlaceholder'] === 1)

      if (fillKey) {
        const placeholderData = { ...d[fillKey] }
        const idx = order.indexOf(fillKey)
        // Remove placeholder slot
        delete d[fillKey]
        order.splice(idx, 1)
        if (d[upc] && d[upc]['_isPlaceholder'] !== 1) {
          // UPC already exists — remove it from its current position and place it at the placeholder slot
          const oldIdx = order.indexOf(upc)
          if (oldIdx !== -1) order.splice(oldIdx, 1)
          delete d[upc]
          // Insert at placeholder's position (adjusted if old row was before it)
          const insertAt = (oldIdx !== -1 && oldIdx < idx) ? idx - 1 : idx
          d[upc] = { ...placeholderData, _isPlaceholder: 0, qty: 1 }
          order.splice(insertAt, 0, upc)
        } else {
          // Fresh UPC — insert at placeholder position
          d[upc] = { ...placeholderData, _isPlaceholder: 0, qty: 1 }
          order.splice(idx, 0, upc)
        }
        return { ...prev, order_list: order, data: d }
      }

      // No placeholders — if UPC already exists increment qty
      if (d[upc] && d[upc]['_isPlaceholder'] !== 1) {
        d[upc] = { ...d[upc], qty: (d[upc].qty as number) + 1 }
        return { ...prev, order_list: order, data: d }
      }

      // 3. Brand new UPC with no placeholder — add new row at bottom
      const empty: ScanData = { qty: 1 }
      prev.extra_cols.forEach(c => { empty[c] = '' })
      d[upc] = empty
      order.push(upc)
      return { ...prev, order_list: order, data: d }
    })
  }

  function updateQty(upc: string, val: string) {
    const q = parseInt(val, 10)
    if (isNaN(q)) return // don't delete while typing
    setSession(prev => {
      if (!prev || !prev.data[upc]) return prev // key already gone, ignore
      if (q <= 0) {
        const d = { ...prev.data }; delete d[upc]
        return { ...prev, order_list: prev.order_list.filter(u => u !== upc), data: d }
      }
      return { ...prev, data: { ...prev.data, [upc]: { ...prev.data[upc], qty: q } } }
    })
  }

  function updateExtra(upc: string, col: string, val: string) {
    setSession(prev => prev ? { ...prev, data: { ...prev.data, [upc]: { ...prev.data[upc], [col]: val } } } : prev)
  }

  function removeUpc(upc: string) {
    setSession(prev => {
      if (!prev || !prev.data[upc]) return prev // already gone, no-op
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

  // ── Camera scanning ────────────────────────────────────────────────────────

  async function openCamera() {
    setCameraError('')
    setShowCamera(true)
    setScanning(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        startBarcodeLoop()
      }
    } catch {
      setCameraError('Camera access denied. Please allow camera permission and try again.')
    }
  }

  function startBarcodeLoop() {
    setScanning(true)

    // Try BarcodeDetector first (Chrome Android), fall back to ZXing (iOS Safari)
    if ('BarcodeDetector' in window) {
      // @ts-expect-error
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] })
      const tick = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        try {
          const barcodes = await detector.detect(videoRef.current)
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue as string
            closeCamera()
            handleScan(code)
            showToast(`📷 Scanned: ${code}`)
            return
          }
        } catch { /* ignore frame errors */ }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } else {
      // ZXing fallback — works on iOS Safari
      import('@zxing/library').then(({ BrowserMultiFormatReader }) => {
        const reader = new BrowserMultiFormatReader()
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        const tick = async () => {
          const video = videoRef.current
          if (!video || video.readyState < 2 || !ctx) {
            rafRef.current = requestAnimationFrame(tick)
            return
          }
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0)
          try {
            const result = reader.decodeFromCanvas(canvas)
            if (result) {
              const code = result.getText()
              closeCamera()
              handleScan(code)
              showToast(`📷 Scanned: ${code}`)
              return
            }
          } catch { /* no barcode in frame */ }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }).catch(() => {
        setCameraError('Barcode scanning failed to load. Please try again.')
      })
    }
  }

  function closeCamera() {
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setShowCamera(false)
    setScanning(false)
    setCameraError('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── Smart Paste ────────────────────────────────────────────────────────────

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
      const newExtra = [...prev.extra_cols]
      headers.forEach(h => { if (!newExtra.includes(h)) newExtra.push(h) })
      const newOrder = [...prev.order_list]
      const newData = { ...prev.data }
      // Keep existing scanned rows, add new placeholder rows for each paste row
      const pastedKeys: string[] = []
      dataRows
        .filter(r => r.some(c => c.trim()))
        .forEach((r, i) => {
          const key = '__paste__' + Date.now() + '_' + i
          const entry: ScanData = { qty: 0, _isPlaceholder: 1 }
          headers.forEach((h, hi) => { entry[h] = r[hi] || '' })
          newExtra.forEach(c => { if (!(c in entry)) entry[c] = '' })
          newData[key] = entry
          pastedKeys.push(key)
        })
      // Remove existing placeholder rows, keep scanned rows
      const scannedKeys = newOrder.filter(k => newData[k]?._isPlaceholder !== 1)
      const mergedOrder = [...scannedKeys, ...pastedKeys]
      return { ...prev, extra_cols: newExtra, order_list: mergedOrder, data: newData }
    })
    const count = dataRows.filter(r => r.some(c => c.trim())).length
    showToast(`✓ ${count} rows loaded — ready to scan!`)
    setShowSmartPaste(false)
    setPasteText('')
    setPastePreview(null)
  }

  // ───────────────────────────────────────────────────────────────────────────

  async function saveSession() {
    if (!session || !session.order_list.length) { showToast('Nothing to save yet'); return }
    setSaving(true)
    // Save as rows[] (new schema) so load migration stays consistent
    const rows = session.order_list.map(key => {
      const d = session.data[key]
      const row: Record<string, string | number> = {
        row_id: key,
        upc: d._isPlaceholder === 1 ? '' : key,
        qty: d.qty as number,
      }
      session.extra_cols.forEach(c => { row[c] = d[c] as string || '' })
      return row
    })
    const hasRealScan = rows.some(r => r.upc && r.upc !== '')
    const payload = {
      name: session.name,
      store: session.store,
      userid: currentUser?.userid || '',
      rows,
      extra_cols: session.extra_cols,
      saved_at: new Date().toISOString(),
      status: hasRealScan ? 'ready' : 'waiting',
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
    if (session && session.order_list.length) {
      await saveSession()
    }
    router.push('/selector')
  }

  function clearSession() {
    if (!session || !confirm('Clear all scans?')) return
    setSession(prev => prev ? { ...prev, order_list: [], data: {} } : prev)
  }

  function exportCSV(s?: UPCSession) {
    const src = s || session
    if (!src || !src.order_list.length) { showToast('Nothing to export'); return }
    const extra = src.extra_cols
    const headers = ['UPC', 'Qty', ...extra, 'Store ID', 'Session', 'User']
    const rows = src.order_list.map(upc => {
      const d = src.data[upc]
      return [upc, d.qty, ...extra.map(n => d[n] || ''), src.store, src.name, src.userid || '']
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
  const nextPlaceholderKey = (targetedPlaceholder && session?.data[targetedPlaceholder]?._isPlaceholder === 1)
    ? targetedPlaceholder
    : session?.order_list.find(k => session.data[k]?._isPlaceholder === 1) ?? ''

  const filteredHistory = allSessions.filter(s => {
    const q = historySearch.toLowerCase()
    return !q || (s.name || '').toLowerCase().includes(q) || (s.store || '').toLowerCase().includes(q) || (s.userid || '').toLowerCase().includes(q)
  })

  function SessionCard({ s, showUser }: { s: UPCSession & { id: string }; showUser?: boolean }) {
    const raw = s as UPCSession & { id: string; rows?: { upc: string; qty: number }[] }
    // Support both old schema (order_list/data) and new schema (rows)
    let total = 0, upcCount = 0
    if (raw.rows) {
      const scanned = raw.rows.filter(r => r.upc)
      total = scanned.reduce((a, r) => a + (r.qty || 0), 0)
      upcCount = scanned.length
    } else {
      total = Object.values(s.data || {}).reduce((a, r) => a + (r.qty as number), 0)
      upcCount = (s.order_list || []).length
    }
    const date = s.saved_at ? new Date(s.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    const st = s.status === 'complete' ? 'complete' : s.status === 'ready' ? 'ready' : total > 0 ? 'ready' : 'waiting'
    const stLabel = st === 'complete' ? '✓ Done' : st === 'ready' ? '👀 Ready' : '⏳ Waiting'
    const stBg    = st === 'complete' ? '#166534' : st === 'ready' ? '#fef3c7' : '#dbeafe'
    const stColor = st === 'complete' ? '#86efac' : st === 'ready' ? '#92400e' : '#1e40af'
    const cardBg  = st === 'complete' ? '#14532d' : purpleLight
    const cardBorder = st === 'complete' ? '#166534' : st === 'ready' ? '#fcd34d' : border
    return (
      <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 5, padding: '5px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, flex: 1, color: st === 'complete' ? '#fff' : '#111' }}>{s.name}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: stBg, color: stColor }}>
            {stLabel}
          </span>
        </div>
        <div style={{ fontSize: 10, color: st === 'complete' ? '#4ade80' : '#6b7280', margin: '2px 0' }}>
          {s.store || '—'}{showUser && s.userid ? ` · ${displayUser(s.userid)}` : ''} · {upcCount} UPCs · {total} qty{date ? ` · ${date}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
          <button onClick={() => loadSessionData(s)} style={{ ...btnSt('green'), fontSize: 10, padding: '2px 7px', flex: 1 }}>Load</button>
          <button onClick={() => exportCSV(s)} style={{ ...btnSt('ghost'), fontSize: 10, padding: '2px 7px', flex: 1 }}>↓ CSV</button>
          <button onClick={() => deleteSession(s)} style={{ ...btnSt('red'), fontSize: 10, padding: '2px 6px' }}>✕</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: purpleLight, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .qd-header {
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 6px;
          border-bottom: 1px solid #d4c8f0;
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(8px);
        }
        .qd-center {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          justify-content: center;
          pointer-events: none;
        }
        .qd-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        /* Tab bar action buttons — hidden on desktop, shown on mobile */
        .qd-tab-actions {
          display: none;
          align-items: center;
          gap: 4px;
          margin-left: auto;
          padding-right: 8px;
        }
        @media (max-width: 700px) {
          .qd-center { order: 3; width: 100%; }
          /* Hide header action buttons on mobile */
          .qd-header-actions { display: none !important; }
          /* Show tab bar action buttons on mobile */
          .qd-tab-actions { display: flex; }
        }
        .qd-scanner-layout {
          display: grid;
          grid-template-columns: 220px 1fr;
          flex: 1;
          min-height: 0;
          height: calc(100vh - 80px);
        }
        @media (max-width: 700px) {
          .qd-scanner-layout {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
            height: auto;
            min-height: calc(100vh - 80px);
          }
          .qd-left-panel {
            border-right: none !important;
            border-bottom: 1px solid #c4b5fd;
          }
          /* Hide Recent sessions panel on mobile */
          .qd-recent-panel { display: none !important; }
          .qd-recent-hr { display: none !important; }
          /* Replace full custom columns box with inline chip row */
          .qd-cols-desktop { display: none !important; }
          .qd-cols-mobile { display: flex !important; }
        }
        .qd-cols-mobile {
          display: none;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px;
        }
      `}</style>

      {/* Header */}
      <div className="qd-header">
        {/* Left: home + user info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={goHome} style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>← Home</button>
          <div style={{ width: 1, height: 16, background: '#d4c8f0' }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{displayUser(currentUser?.userid)}</span>
            {currentUser?.store ? <> · {currentUser.store === 'ALL' ? 'All Stores' : currentUser.store}</> : ''}
          </span>
        </div>

        {/* Center: logo + title */}
        <div className="qd-center">
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

        {/* Right: actions — hidden on mobile, shown in tab bar instead */}
        <div className="qd-right qd-header-actions">
          <Btn color="primary" onClick={() => setShowModal(true)}>+ New Invoice #</Btn>
          <Btn color="yellow" onClick={saveSession} disabled={saving || !session?.order_list.length}>
            {saving ? '…' : '💾 Save'}
          </Btn>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#e8e4f8', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 0 }}>
        {(['scanner', 'history'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: tab === t ? `2px solid ${purple}` : '2px solid transparent', background: 'none', color: tab === t ? purple : '#6b7280', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'Inter, sans-serif' }}>
            {t === 'scanner' ? '📷 Scanner' : '🗂 History'}
          </button>
        ))}
        {/* Action buttons in tab bar — only visible on mobile */}
        <div className="qd-tab-actions">
          <button onClick={() => setShowModal(true)}
            style={{ ...btnSt('primary'), fontSize: 11, padding: '4px 10px' }}>+ New</button>
          <button onClick={saveSession} disabled={saving || !session?.order_list.length}
            style={{ ...btnSt('yellow'), fontSize: 11, padding: '4px 10px', opacity: (!session?.order_list.length) ? 0.5 : 1 }}>
            {saving ? '…' : '💾'}
          </button>
          <button onClick={openCamera}
            style={{ ...btnSt('ghost'), fontSize: 11, padding: '4px 10px', background: '#ede9fe', color: '#6d28d9', border: `1px solid ${border}` }}>
            📷
          </button>
        </div>
      </div>

      {/* Scanner tab */}
      {tab === 'scanner' && (
        <div className="qd-scanner-layout">

          {/* Left panel */}
          <div className="qd-left-panel" style={{ background: '#fff', borderRight: `1px solid ${border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={labelSt}>Scan Barcode / UPC</label>
              <input ref={inputRef} type="text" placeholder="Scan or type code…"
                value={scanVal}
                style={{ ...inputSt, fontSize: 11, fontWeight: 600, letterSpacing: '0.8px' }}
                onChange={e => setScanVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = scanVal.trim()
                    if (v) { handleScan(v); setScanVal('') }
                  }
                }}
                onPaste={e => {
                  const pasted = e.clipboardData.getData('text').trim()
                  if (pasted) {
                    e.preventDefault()
                    handleScan(pasted)
                    setScanVal('')
                  }
                }} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {[['Total Qty', totalQty], ['Unique', uniqueCount]].map(([lbl, num]) => (
                <div key={lbl as string} style={{ flex: 1, background: purpleLight, border: `1px solid ${border}`, borderRadius: 5, padding: '3px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: purple }}>{num}</div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
                </div>
              ))}
            </div>

            <hr style={{ border: 'none', borderTop: `1px solid ${border}` }} />

            {/* Custom columns — desktop: full box; mobile: compact chip row */}
            <div className="qd-cols-desktop" style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8 }}>
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

            {/* Mobile: compact column chips */}
            <div className="qd-cols-mobile">
              <span style={{ fontSize: 10, fontWeight: 700, color: purpleD, whiteSpace: 'nowrap' }}>Cols:</span>
              {session?.extra_cols.map(col => (
                <span key={col} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: purpleLight, border: `1px solid ${border}`, borderRadius: 10, padding: '2px 7px', fontSize: 10, fontWeight: 700, color: purpleD }}>
                  {col}
                  <button onClick={() => removeExtraCol(col)}
                    style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 10, padding: '0 1px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </span>
              ))}
              {colPrompt ? (
                <>
                  <input value={colName} onChange={e => setColName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addExtraCol()}
                    autoFocus placeholder="name…"
                    style={{ ...inputSt, width: 80, fontSize: 11, padding: '2px 6px' }} />
                  <button onClick={addExtraCol} style={{ ...btnSt('primary'), fontSize: 10, padding: '2px 7px' }}>Add</button>
                  <button onClick={() => { setColPrompt(false); setColName('') }} style={{ ...btnSt('ghost'), fontSize: 10, padding: '2px 5px' }}>✕</button>
                </>
              ) : (
                <button onClick={() => setColPrompt(true)}
                  style={{ ...btnSt('ghost'), fontSize: 11, padding: '2px 8px', borderRadius: 10 }}>+ col</button>
              )}
            </div>

            {/* Smart Paste button */}
            <button onClick={() => setShowSmartPaste(true)}
              style={{ width: '100%', ...btnSt('ghost'), justifyContent: 'center', fontSize: 11, padding: '5px 8px', background: '#ede9fe', color: '#6d28d9', border: `1px solid ${border}` }}>
              📋 Smart Paste
            </button>

            <hr className="qd-recent-hr" style={{ border: 'none', borderTop: `1px solid ${border}` }} />

            {/* Recent sessions (last 5) — hidden on mobile */}
            <div className="qd-recent-panel" style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
              <span style={{ fontSize: 11, fontWeight: 700, color: purpleD }}>Session Table</span>
              <div style={{ flex: 1 }} />
              {isAdmin(currentUser) && session && session.order_list.length > 0 && (
                <button onClick={() => {
                  const headers = ['#', 'UPC', 'Qty', ...session.extra_cols]
                  const dataRows = session.order_list.map((k, i) => {
                    const d = session.data[k]
                    return [i + 1, d._isPlaceholder === 1 ? '' : k, d.qty, ...session.extra_cols.map(c => d[c] || '')]
                  })
                  const text = [headers, ...dataRows].map(r => r.join('\t')).join('\n')
                  navigator.clipboard.writeText(text).then(() => showToast('✓ Table copied!'))
                }} style={{ ...btnSt('ghost'), fontSize: 10, padding: '3px 8px' }}>⎘ Copy</button>
              )}
              <button onClick={() => setSortAsc(a => !a)} style={{ ...btnSt('ghost'), fontSize: 10, padding: '3px 8px' }}>⇅ Sort</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {!session || session.order_list.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#6b7280', padding: '50px 20px', fontSize: 13 }}>
                  {session ? 'Start scanning barcodes.' : 'Start a session and scan barcodes to begin.'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ background: '#CFC5ED', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ ...thSt, textAlign: 'center', width: 28 }}>#</th>
                      <th style={{ ...thSt, whiteSpace: 'nowrap' }}>UPC</th>
                      <th style={{ ...thSt, textAlign: 'center', width: 48 }}>Qty</th>
                      {session.extra_cols.map(c => <th key={c} style={{ ...thSt, whiteSpace: 'nowrap' }}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((upc, ri) => {
                      const row = session.data[upc]
                      if (!row) return null
                      const isPlaceholder = row._isPlaceholder === 1
                      const isNextTarget = upc === nextPlaceholderKey
                      const rowBg = ri % 2 === 0 ? '#f5f3ff' : '#ffffff'
                      const cellSt: React.CSSProperties = {
                        display: 'block', width: '100%', padding: '5px 7px',
                        border: 'none', outline: 'none', fontSize: 12,
                        background: 'transparent', fontFamily: 'Inter, sans-serif',
                        boxSizing: 'border-box',
                      }
                      return (
                        <tr key={upc} style={{ background: rowBg, borderBottom: '1px solid #ede9fe' }}
                          onContextMenu={e => { e.preventDefault(); setCtxMenu({ upc, x: e.clientX, y: e.clientY }) }}>
                          <td style={{ ...tdSt, textAlign: 'center', color: '#9ca3af', fontSize: 10, padding: '5px 4px', whiteSpace: 'nowrap' }}>{ri + 1}</td>
                          <td style={{ ...tdSt, background: isNextTarget ? '#dcfce7' : rowBg }}
                            onClick={isPlaceholder ? () => setTargetedPlaceholder(upc) : undefined}>
                            {isPlaceholder ? (
                              <span style={{
                                display: 'block', padding: '5px 7px', fontSize: 11,
                                color: isNextTarget ? '#15803d' : '#9ca3af',
                                fontStyle: isNextTarget ? 'italic' : 'normal',
                                cursor: 'pointer', minHeight: 26,
                              }}>
                                {isNextTarget ? '← next scan' : ''}
                              </span>
                            ) : (
                              <input
                                type="text"
                                defaultValue={upc}
                                key={upc}
                                style={{ ...cellSt, fontWeight: 600, fontFamily: 'Courier New, monospace', letterSpacing: '0.4px' }}
                                onBlur={e => {
                                  const newUpc = e.target.value.trim()
                                  if (!newUpc || newUpc === upc) return
                                  setSession(prev => {
                                    if (!prev) return prev
                                    const d = { ...prev.data }
                                    const order = [...prev.order_list]
                                    if (!d[upc]) return prev // already renamed
                                    d[newUpc] = { ...d[upc], _isPlaceholder: 0 }
                                    delete d[upc]
                                    order[order.indexOf(upc)] = newUpc
                                    return { ...prev, order_list: order, data: d }
                                  })
                                }}
                              />
                            )}
                          </td>
                          <td style={tdSt}>
                            <input type="number" min="0" value={row.qty}
                              style={{ ...cellSt, fontWeight: 700, color: isPlaceholder ? '#d1d5db' : purple, textAlign: 'center' }}
                              onChange={e => updateQty(upc, e.target.value)} />
                          </td>
                          {session.extra_cols.map(col => (
                            <td key={col} style={tdSt}>
                              <input type="text" value={row[col] as string || ''}
                                style={{ ...cellSt }}
                                onChange={e => updateExtra(upc, col, e.target.value)} />
                            </td>
                          ))}
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

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          onClick={() => setCtxMenu(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 999 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 1000,
              background: '#fff', border: `1px solid ${border}`, borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)', minWidth: 160, overflow: 'hidden',
            }}>
            <div style={{ padding: '6px 8px', fontSize: 10, color: '#9ca3af', borderBottom: `1px solid ${border}`, fontFamily: 'Courier New, monospace', letterSpacing: '0.4px' }}>
              {session?.data[ctxMenu.upc]?._isPlaceholder === 1 ? '(placeholder)' : ctxMenu.upc}
            </div>
            {session?.data[ctxMenu.upc]?._isPlaceholder !== 1 && (
              <button
                onClick={() => {
                  setEditingUpc({ key: ctxMenu.upc, val: ctxMenu.upc })
                  setCtxMenu(null)
                }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', color: purpleD }}>
                ✏️ Edit UPC
              </button>
            )}
            <button
              onClick={() => { removeUpc(ctxMenu.upc); setCtxMenu(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', color: '#dc2626' }}>
              🗑 Delete row
            </button>
          </div>
        </div>
      )}

      {/* Edit UPC modal */}
      {editingUpc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, minWidth: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: purpleD, marginBottom: 12 }}>Edit UPC</div>
            <input
              autoFocus
              type="text"
              value={editingUpc.val}
              onChange={e => setEditingUpc({ ...editingUpc, val: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const newUpc = editingUpc.val.trim()
                  if (newUpc && newUpc !== editingUpc.key) {
                    setSession(prev => {
                      if (!prev || !prev.data[editingUpc.key]) return prev
                      const d = { ...prev.data }
                      const order = [...prev.order_list]
                      d[newUpc] = { ...d[editingUpc.key], _isPlaceholder: 0 }
                      delete d[editingUpc.key]
                      order[order.indexOf(editingUpc.key)] = newUpc
                      return { ...prev, order_list: order, data: d }
                    })
                  }
                  setEditingUpc(null)
                }
                if (e.key === 'Escape') setEditingUpc(null)
              }}
              style={{ ...inputSt, width: '100%', fontFamily: 'Courier New, monospace', letterSpacing: '0.6px', fontWeight: 600, marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingUpc(null)} style={{ ...btnSt('ghost'), fontSize: 12 }}>Cancel</button>
              <button onClick={() => {
                const newUpc = editingUpc.val.trim()
                if (newUpc && newUpc !== editingUpc.key) {
                  setSession(prev => {
                    if (!prev || !prev.data[editingUpc.key]) return prev
                    const d = { ...prev.data }
                    const order = [...prev.order_list]
                    d[newUpc] = { ...d[editingUpc.key], _isPlaceholder: 0 }
                    delete d[editingUpc.key]
                    order[order.indexOf(editingUpc.key)] = newUpc
                    return { ...prev, order_list: order, data: d }
                  })
                }
                setEditingUpc(null)
              }} style={{ ...btnSt('primary'), fontSize: 12 }}>Save</button>
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
              Paste a table from Excel or Sheets (first row = headers like <strong>Pcode, Color, Size</strong>). Each row becomes a slot — scan barcodes to fill them in.
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
                            <td key={ci} style={{ ...tdSt, padding: '3px 8px', fontSize: 10 }}>
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
                  ✓ <strong>{pastePreview.rows.filter(r => r.some(c => c.trim())).length} rows</strong> ready to load
                  {pastePreview.headers.length > 0 && <> · columns: <strong>{pastePreview.headers.join(', ')}</strong></>}
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

      {/* Camera overlay — mobile only */}
      {showCamera && (
        <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(0,0,0,0.7)' }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>📷 Scan Barcode</span>
            <button onClick={closeCamera}
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 20, width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ✕
            </button>
          </div>

          {/* Video */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Aim reticle */}
            {scanning && !cameraError && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 240, height: 140, border: '2px solid rgba(124,58,237,0.8)', borderRadius: 8, boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)', position: 'relative' }}>
                  {/* Corner marks */}
                  {[['0%','0%','top','left'],['0%','100%','top','right'],['100%','0%','bottom','left'],['100%','100%','bottom','right']].map(([t,l,vp,hp]) => (
                    <div key={`${vp}${hp}`} style={{
                      position: 'absolute', top: t, left: l,
                      width: 18, height: 18,
                      borderTop: vp === 'top' ? '3px solid #7c3aed' : 'none',
                      borderBottom: vp === 'bottom' ? '3px solid #7c3aed' : 'none',
                      borderLeft: hp === 'left' ? '3px solid #7c3aed' : 'none',
                      borderRight: hp === 'right' ? '3px solid #7c3aed' : 'none',
                      transform: `translate(${hp === 'right' ? '50%' : '-50%'}, ${vp === 'bottom' ? '50%' : '-50%'})`,
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div style={{ padding: '14px 16px', background: 'rgba(0,0,0,0.8)', textAlign: 'center' }}>
            {cameraError ? (
              <span style={{ color: '#fca5a5', fontSize: 13, lineHeight: 1.5 }}>{cameraError}</span>
            ) : scanning ? (
              <span style={{ color: '#a78bfa', fontSize: 13 }}>Point camera at barcode…</span>
            ) : (
              <span style={{ color: '#9ca3af', fontSize: 13 }}>Starting camera…</span>
            )}
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
  padding: '5px 8px', textAlign: 'left', fontWeight: 700, fontSize: 10,
  color: '#1A0A40', borderBottom: '2px solid #c4b5fd', borderRight: '1px solid #ddd6fe',
  whiteSpace: 'nowrap',
}

const tdSt: React.CSSProperties = {
  padding: '0', verticalAlign: 'middle', borderRight: '1px solid #ede9fe',
}

'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const purple = '#7c3aed'
const purpleLight = '#f5f3ff'
const border = '#d4c8f0'

interface LogBookEntry {
  id: string
  exported_at: string
  invoice_num: string
  po_num: string
  store: string
  qty_total: number
  userid: string
}

export default function AutoCSVPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [activeTab, setActiveTab] = useState<'processor' | 'logbook'>('processor')

  // Invoice Processor state
  const [vendorCSV, setVendorCSV] = useState('')
  const [posQuery, setPosQuery] = useState('')
  const [posSummary, setPosSummary] = useState('')

  interface SummaryRow {
    invoice: string; poNum: string; customer: string; qty: number; dupes: number; alreadyLogged: boolean
  }
  const [vendorSummaryRows, setVendorSummaryRows] = useState<SummaryRow[]>([])
  const [vendorFooter, setVendorFooter] = useState('')

  // Log Book state
  const [logEntries, setLogEntries] = useState<LogBookEntry[]>([])
  const [logFilter, setLogFilter] = useState('')
  const [logLoading, setLogLoading] = useState(false)

  // POS processing state
  interface PosRow {
    invoice: string; poNum: string; customer: string; style: string
    upc: string; shippedQty: string; id: string; createdPO: string
    itemNotOnOrder: string; validUPC: string; poPreviouslyClosed: string
    storeID: string; newPONumber: string
    isError: boolean
  }
  const [posRows, setPosRows] = useState<PosRow[]>([])
  const [posErrors, setPosErrors] = useState<PosRow[]>([])
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [fixedInput, setFixedInput] = useState('')
  const [showAddFixed, setShowAddFixed] = useState(false)
  // invoiceGroup → { poNum, customer, storeID, qty } for logged clean rows
  const [pendingLog, setPendingLog] = useState<Record<string, { poNum: string; customer: string; storeID: string; qty: number }>>({})

  const [toast, setToast] = useState('')

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    if (activeTab === 'logbook') fetchLogEntries()
  }, [activeTab])

  // keep a set of already-logged invoice nums for dupe detection
  const [loggedInvoices, setLoggedInvoices] = useState<Set<string>>(new Set())

  async function fetchLogEntries() {
    setLogLoading(true)
    const { data } = await supabase
      .from('autocsv_log')
      .select('*')
      .order('exported_at', { ascending: false })
    const entries = data || []
    setLogEntries(entries)
    setLoggedInvoices(new Set(entries.map((e: LogBookEntry) => e.invoice_num)))
    setLogLoading(false)
  }

  // Load logged invoices on mount so dupe check works without visiting Log Book tab
  useEffect(() => {
    supabase.from('autocsv_log').select('invoice_num').then(({ data }) => {
      if (data) setLoggedInvoices(new Set(data.map((r: { invoice_num: string }) => r.invoice_num)))
    })
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function processVendorCSV() {
    if (!vendorCSV.trim()) { showToast('⚠️ Paste vendor CSV data first'); return }
    const allLines = vendorCSV.trim().split('\n')
    // Skip header row if it starts with "InvoiceNoCompany" (case-insensitive)
    const dataLines = allLines.filter(l => {
      const t = l.trim()
      return t && !/^invoicenocompany/i.test(t)
    })

    // Parse: InvoiceNoCompany PONum Customer Style UPC ShippedQty (tab or space separated)
    const parsed: Record<string, { poNum: string; customer: string; qty: number; dupes: number }> = {}
    const seen = new Set<string>()
    let totalQty = 0

    for (const line of dataLines) {
      // Split on tabs first, fall back to multiple spaces
      const parts = line.includes('\t')
        ? line.split('\t').map(s => s.trim())
        : line.trim().split(/\s{2,}/)
      if (parts.length < 6) continue
      const [invoice, poNum, customer, , upc, qtyStr] = parts
      const qty = parseInt(qtyStr) || 0
      const dupeKey = `${invoice}|${upc}`

      if (!parsed[invoice]) {
        parsed[invoice] = { poNum, customer, qty: 0, dupes: 0 }
      }
      if (seen.has(dupeKey)) {
        parsed[invoice].dupes++
      } else {
        seen.add(dupeKey)
        parsed[invoice].qty += qty
        totalQty += qty
      }
    }

    const rows = Object.entries(parsed).map(([invoice, v]) => ({
      invoice,
      poNum: v.poNum,
      customer: v.customer,
      qty: v.qty,
      dupes: v.dupes,
      alreadyLogged: loggedInvoices.has(invoice),
    }))

    const alreadyLoggedCount = rows.filter(r => r.alreadyLogged).length
    setVendorSummaryRows(rows)
    setVendorFooter(
      `Unique invoices: ${rows.length} | Total shipped qty: ${totalQty}` +
      (alreadyLoggedCount > 0 ? ` | ⚠ ${alreadyLoggedCount} invoice(s) already in log — possible double import!` : '')
    )
    showToast(`✅ ${dataLines.length} rows · ${rows.length} unique`)
  }

  const POS_COLS = ['','InvoiceNoCompany','PONum','Customer','Style','UPC','ShippedQTY','ID','CreatedPO','ItemNotOnOrder','ValidUPC','POPreviouslyClosed','StoreID','NewPONumber'] as const

  function parsePosLines(text: string): PosRow[] {
    return text.trim().split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^invoicenocompany/i.test(l) && !/^\t?InvoiceNoCompany/i.test(l))
      .map(line => {
        // first column is blank, so split on tab and shift
        const parts = line.split('\t')
        // handle whether pasted with or without leading blank tab
        const offset = parts[0].trim() === '' ? 1 : 0
        const get = (i: number) => (parts[offset + i] || '').trim()
        const validUPC = get(9)
        return {
          invoice: get(0), poNum: get(1), customer: get(2), style: get(3),
          upc: get(4), shippedQty: get(5), id: get(6), createdPO: get(7),
          itemNotOnOrder: get(8), validUPC, poPreviouslyClosed: get(10),
          storeID: get(11), newPONumber: get(12),
          isError: validUPC !== '' && validUPC !== undefined,
        }
      })
      .filter(r => r.invoice)
  }

  function processPosQuery() {
    if (!posQuery.trim()) { showToast('⚠️ Paste POS query data first'); return }
    const rows = parsePosLines(posQuery)
    if (!rows.length) { showToast('⚠️ No data rows found — check format'); return }

    const good = rows.filter(r => !r.isError)
    const bad = rows.filter(r => r.isError)
    setPosRows(rows)
    setPosErrors(bad)

    // Group good rows by invoice for logging
    const grouped: Record<string, { poNum: string; customer: string; storeID: string; qty: number }> = {}
    for (const r of good) {
      const q = parseInt(r.shippedQty) || 0
      if (!grouped[r.invoice]) grouped[r.invoice] = { poNum: r.poNum, customer: r.customer, storeID: r.storeID, qty: 0 }
      grouped[r.invoice].qty += q
    }
    setPendingLog(grouped)

    // Build POS summary string for bottom-right panel
    const invLines: string[] = []
    for (const [inv, v] of Object.entries(grouped)) {
      invLines.push(`${inv}\t${v.poNum}\t${v.customer}\t${v.storeID}\t${v.qty}`)
    }
    setPosSummary(['InvoiceNoCompany\tPONum\tCustomer\tStoreID\tShippedQty (sum)', ...invLines].join('\n'))

    showToast(`✅ ${good.length} clean · ${bad.length} error${bad.length !== 1 ? 's' : ''}`)
    if (bad.length > 0) setShowAddFixed(false)
  }

  async function logToSupabase(
    grouped: Record<string, { poNum: string; customer: string; storeID: string; qty: number }>,
    allowDupes = false
  ) {
    if (!user) return
    let skipped = 0
    for (const [invoice, v] of Object.entries(grouped)) {
      if (!allowDupes && loggedInvoices.has(invoice)) { skipped++; continue }
      await supabase.from('autocsv_log').insert({
        invoice_num: invoice,
        po_num: v.poNum,
        store: v.storeID || user.store,
        qty_total: v.qty,
        userid: user.userid,
      })
    }
    // refresh logged set
    const { data } = await supabase.from('autocsv_log').select('invoice_num')
    if (data) setLoggedInvoices(new Set(data.map((r: { invoice_num: string }) => r.invoice_num)))
    return skipped
  }

  async function handleProcessAndLog() {
    if (!Object.keys(pendingLog).length) { showToast('⚠️ Process POS data first'); return }
    const skipped = await logToSupabase(pendingLog, false)
    const logged = Object.keys(pendingLog).length - (skipped || 0)
    showToast(`✅ Logged ${logged} invoice${logged !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped (already logged)` : ''}`)
    if (posErrors.length > 0) setShowAddFixed(true)
  }

  async function handleAddFixed() {
    if (!fixedInput.trim()) { showToast('⚠️ Paste corrected rows first'); return }
    const rows = parsePosLines(fixedInput)
    const grouped: Record<string, { poNum: string; customer: string; storeID: string; qty: number }> = {}
    for (const r of rows) {
      const q = parseInt(r.shippedQty) || 0
      if (!grouped[r.invoice]) grouped[r.invoice] = { poNum: r.poNum, customer: r.customer, storeID: r.storeID, qty: 0 }
      grouped[r.invoice].qty += q
    }
    // Force-insert even if duplicate (user is intentionally adding to existing log)
    await logToSupabase(grouped, true)
    showToast(`✅ Added ${Object.keys(grouped).length} fixed invoice(s) to log`)
    setFixedInput('')
    setShowAddFixed(false)
  }

  function clearAll() {
    setVendorCSV('')
    setVendorSummaryRows([])
    setVendorFooter('')
    setPosQuery('')
    setPosSummary('')
    setPosRows([])
    setPosErrors([])
    setPendingLog({})
    setShowAddFixed(false)
    setFixedInput('')
    setShowErrorModal(false)
  }

  if (!user) return null

  const filteredLog = logEntries.filter(e => {
    if (!logFilter) return true
    const q = logFilter.toLowerCase()
    return e.invoice_num?.toLowerCase().includes(q) ||
      e.po_num?.toLowerCase().includes(q) ||
      e.store?.toLowerCase().includes(q) ||
      e.userid?.toLowerCase().includes(q)
  })

  const taStyle: React.CSSProperties = {
    width: '100%', height: '100%', resize: 'none',
    background: '#faf9ff', border: 'none', outline: 'none',
    fontFamily: 'monospace', fontSize: 11, color: '#2d1f6e',
    lineHeight: 1.5, padding: '10px 12px',
    boxSizing: 'border-box',
  }

  const panelStyle: React.CSSProperties = {
    background: '#fff', border: `1.5px solid ${border}`,
    borderRadius: 10, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 2px 10px rgba(124,58,237,0.06)',
  }

  const panelHeaderStyle: React.CSSProperties = {
    background: purpleLight, borderBottom: `1px solid ${border}`,
    padding: '7px 12px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', flexShrink: 0,
  }

  const panelLabelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, color: purple,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  }

  const smBtn = (bg: string, color: string): React.CSSProperties => ({
    background: bg, color, border: 'none', borderRadius: 5,
    padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  })

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', display: 'flex', flexDirection: 'column' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e1b4b', color: '#fff', borderRadius: 10, padding: '10px 20px',
          fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{
        padding: '12px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: `1px solid ${border}`,
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)',
        position: 'sticky', top: 0, zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#5b21b6', fontWeight: 600 }}>
            ← Back
          </button>
          <span style={{ fontSize: 12, color: '#9b8ec4', fontWeight: 600 }}>
            {user.userid} · {user.store}
          </span>
        </div>

        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.04em', margin: 0 }}>
            ⚡ AUTO CSV
          </h2>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {activeTab === 'processor' && (
            <button onClick={clearAll}
              style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              🗑 Clear All
            </button>
          )}
          {activeTab === 'logbook' && (
            <button onClick={fetchLogEntries}
              style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: purple }}>
              🔄 Refresh
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: `2px solid ${border}`,
        background: 'rgba(255,255,255,0.5)', padding: '0 24px', flexShrink: 0,
      }}>
        {(['processor', 'logbook'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '12px 24px', fontSize: 13, fontWeight: 700,
            background: 'none', border: 'none', cursor: 'pointer',
            color: activeTab === tab ? purple : '#9b8ec4',
            borderBottom: activeTab === tab ? `3px solid ${purple}` : '3px solid transparent',
            marginBottom: -2, letterSpacing: '0.03em',
          }}>
            {tab === 'processor' ? '📄 Invoice Processor' : '📋 Log Book'}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: Invoice Processor — 4-panel grid                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'processor' && (
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 12, padding: 16,
          minHeight: 0,
        }}>

          {/* TOP-LEFT: Vendor CSV input */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>Vendor CSV</span>
              <span style={{ fontSize: 10, color: '#b8aed8' }}>InvoiceNoCompany · PONum · Customer · Style · UPC · ShippedQty</span>
              <button onClick={processVendorCSV} style={smBtn(purple, '#fff')}>▶ Process</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <textarea
                value={vendorCSV}
                onChange={e => setVendorCSV(e.target.value)}
                placeholder="Paste vendor CSV data here..."
                style={taStyle}
              />
            </div>
            <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: '#9b8ec4' }}>
              {vendorCSV.trim()
                ? `✓ ${vendorCSV.trim().split('\n').filter(l => l.trim() && !/^invoicenocompany/i.test(l.trim())).length} rows`
                : 'No data'}
            </div>
          </div>

          {/* TOP-RIGHT: Vendor Summary + Errors */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>Summary + Errors</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {vendorSummaryRows.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                      {['InvoiceNoCompany','PONum','Customer','ShippedQty (sum)','Dupes','⚠ Already Logged?'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', fontWeight: 800, color: purple, textAlign: 'left', whiteSpace: 'nowrap', fontSize: 10, letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vendorSummaryRows.map((row, i) => (
                      <tr key={i} style={{
                        background: row.alreadyLogged ? '#fff1f2' : i % 2 === 0 ? '#fff' : '#faf8ff',
                        borderBottom: `1px solid ${border}`,
                      }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: row.alreadyLogged ? '#dc2626' : '#2d1f6e', fontWeight: 600 }}>{row.invoice}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#555' }}>{row.poNum}</td>
                        <td style={{ padding: '6px 10px', color: '#555' }}>{row.customer}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#333', fontWeight: 600 }}>{row.qty}</td>
                        <td style={{ padding: '6px 10px', color: row.dupes > 0 ? '#f59e0b' : '#aaa' }}>{row.dupes > 0 ? row.dupes : ''}</td>
                        <td style={{ padding: '6px 10px', color: '#dc2626', fontWeight: 700 }}>{row.alreadyLogged ? '⚠ DUPLICATE' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: '#c4b5fd', fontSize: 12 }}>
                  Process vendor CSV to see summary
                </div>
              )}
            </div>
            <div style={{ padding: '6px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: vendorFooter.includes('⚠') ? '#dc2626' : '#9b8ec4' }}>
              {vendorFooter || ' '}
            </div>
          </div>

          {/* BOTTOM-LEFT: POS Query input */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>POS Query</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {posErrors.length > 0 && (
                  <button onClick={() => setShowErrorModal(true)} style={smBtn('#fff3cd', '#92400e')}>
                    ⚠ View Errors ({posErrors.length})
                  </button>
                )}
                <button onClick={processPosQuery} style={smBtn('#e0e7ff', '#3730a3')}>▶ Process</button>
                <button onClick={handleProcessAndLog} style={smBtn(purple, '#fff')}>📥 Log</button>
              </div>
            </div>

            {/* Fixed header row */}
            <div style={{ overflowX: 'auto', flexShrink: 0, borderBottom: `1px solid ${border}` }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f0ebff' }}>
                    {POS_COLS.map((col, i) => (
                      <th key={i} style={{
                        padding: '5px 8px', textAlign: 'left', fontWeight: 800,
                        color: col === 'ValidUPC' ? '#dc2626' : purple,
                        whiteSpace: 'nowrap', letterSpacing: '0.03em',
                        minWidth: i === 0 ? 24 : undefined,
                        borderRight: `1px solid ${border}`,
                      }}>{col}</th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
              <textarea
                value={posQuery}
                onChange={e => setPosQuery(e.target.value)}
                placeholder={`Paste system response here (tab-separated, blank first column)...\n\nExpected columns:\n  [blank]  InvoiceNoCompany  PONum  Customer  Style  UPC  ShippedQTY  ID  CreatedPO  ItemNotOnOrder  ValidUPC  POPreviouslyClosed  StoreID  NewPONumber`}
                style={{ ...taStyle, fontSize: 10 }}
              />
            </div>
            <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: '#9b8ec4' }}>
              {posRows.length > 0
                ? `${posRows.length} rows · ${posRows.filter(r=>!r.isError).length} clean · ${posErrors.length} error${posErrors.length !== 1 ? 's' : ''}`
                : posQuery.trim() ? `${posQuery.trim().split('\n').filter(l => l.trim()).length} rows pasted` : 'No data'}
            </div>

            {/* Add Fixed section — appears after logging when errors exist */}
            {showAddFixed && (
              <div style={{ borderTop: `2px solid #fcd34d`, background: '#fffbeb', padding: 10, flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>
                  ✏️ ADD FIXED ROWS — paste corrected rows below (will append to existing log, no dupe warning)
                </div>
                <textarea
                  value={fixedInput}
                  onChange={e => setFixedInput(e.target.value)}
                  placeholder="Paste corrected rows here..."
                  style={{ ...taStyle, height: 80, background: '#fff', border: `1px solid #fcd34d`, borderRadius: 6, fontSize: 10 }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setShowAddFixed(false); setFixedInput('') }} style={smBtn('#f3f4f6', '#6b7280')}>Cancel</button>
                  <button onClick={handleAddFixed} style={smBtn('#16a34a', '#fff')}>✅ Add to Log</button>
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM-RIGHT: POS Summary */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>POS Summary</span>
              {posRows.length > 0 && (
                <span style={{ fontSize: 10, color: posErrors.length > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                  {posErrors.length > 0 ? `⚠ ${posErrors.length} error${posErrors.length !== 1 ? 's' : ''} — log excludes them` : '✅ All rows clean'}
                </span>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {posSummary ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                      {['InvoiceNoCompany','PONum','Customer','StoreID','ShippedQty (sum)'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', fontWeight: 800, color: purple, textAlign: 'left', whiteSpace: 'nowrap', fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {posSummary.split('\n').slice(1).map((line, i) => {
                      const [inv, poNum, customer, storeID, qty] = line.split('\t')
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#faf8ff', borderBottom: `1px solid ${border}` }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#2d1f6e' }}>{inv}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#555' }}>{poNum}</td>
                          <td style={{ padding: '6px 10px', color: '#555' }}>{customer}</td>
                          <td style={{ padding: '6px 10px', color: '#555' }}>{storeID}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{qty}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: '#c4b5fd', fontSize: 12 }}>
                  Process POS query to see summary
                </div>
              )}
            </div>
            {posSummary && (
              <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: '#9b8ec4' }}>
                {posSummary.split('\n').length - 1} unique invoice{posSummary.split('\n').length - 1 !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Error Modal */}
          {showErrorModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} onClick={() => setShowErrorModal(false)}>
              <div style={{
                background: '#fff', borderRadius: 14, width: '80%', maxWidth: 900, maxHeight: '75vh',
                display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ background: '#fff1f2', borderBottom: '2px solid #fecaca', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 900, color: '#dc2626', fontSize: 13 }}>⚠ Error Rows — ValidUPC Issues ({posErrors.length})</span>
                  <button onClick={() => setShowErrorModal(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#dc2626' }}>✕</button>
                </div>
                <div style={{ overflow: 'auto', flex: 1 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#fef2f2', borderBottom: '2px solid #fecaca', position: 'sticky', top: 0 }}>
                        {['InvoiceNoCompany','PONum','Customer','Style','UPC','ShippedQTY','ValidUPC','StoreID'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: h === 'ValidUPC' ? '#dc2626' : '#7f1d1d', fontWeight: 800, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {posErrors.map((r, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fff5f5', borderBottom: '1px solid #fecaca' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#7f1d1d' }}>{r.invoice}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.poNum}</td>
                          <td style={{ padding: '6px 10px' }}>{r.customer}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.style}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.upc}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.shippedQty}</td>
                          <td style={{ padding: '6px 10px', color: '#dc2626', fontWeight: 700 }}>{r.validUPC}</td>
                          <td style={{ padding: '6px 10px' }}>{r.storeID}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '10px 20px', borderTop: '1px solid #fecaca', background: '#fff1f2', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setShowErrorModal(false)} style={smBtn('#dc2626', '#fff')}>Close</button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: Log Book                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'logbook' && (
        <div style={{ padding: '20px 24px', maxWidth: 1300, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#3b1f8c', margin: 0 }}>Push Log &amp; IC Cross-Reference</h3>
              <p style={{ fontSize: 11, color: '#9b8ec4', margin: '2px 0 0' }}>
                {filteredLog.length} entr{filteredLog.length !== 1 ? 'ies' : 'y'}
              </p>
            </div>
            <input
              value={logFilter}
              onChange={e => setLogFilter(e.target.value)}
              placeholder="Search..."
              style={{
                background: '#f5f3ff', border: `1.5px solid ${border}`,
                borderRadius: 8, padding: '7px 12px', fontSize: 12,
                color: '#3b1f8c', fontWeight: 600, outline: 'none', width: 200,
              }}
            />
          </div>

          <div style={{ background: '#fff', border: `1.5px solid ${border}`, borderRadius: 12, overflow: 'auto', boxShadow: '0 2px 16px rgba(124,58,237,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                  {['Timestamp', 'Invoice #', 'PO #', 'Store', 'CSV Qty', 'Logged By'].map(col => (
                    <th key={col} style={{
                      padding: '10px 12px', textAlign: 'left', fontSize: 10,
                      fontWeight: 800, color: purple, letterSpacing: '0.07em',
                      textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logLoading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#c4b5fd', fontSize: 13 }}>Loading...</td></tr>
                ) : filteredLog.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 48, textAlign: 'center', color: '#c4b5fd' }}>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>No log entries yet</p>
                      <p style={{ fontSize: 12 }}>Entries appear here after processing in the Invoice Processor</p>
                    </td>
                  </tr>
                ) : filteredLog.map((e, i) => (
                  <tr key={e.id} style={{ borderTop: i === 0 ? 'none' : `1px solid #f0ebff`, background: i % 2 === 0 ? '#fff' : '#faf8ff' }}>
                    <td style={{ padding: '9px 12px', fontSize: 11, color: '#9b8ec4', whiteSpace: 'nowrap' }}>
                      {new Date(e.exported_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: '#3b1f8c', fontFamily: 'monospace' }}>
                      {e.invoice_num}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#333', fontFamily: 'monospace' }}>
                      {e.po_num || '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#333' }}>{e.store}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#333', textAlign: 'center' }}>{e.qty_total}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#6b7280' }}>{e.userid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

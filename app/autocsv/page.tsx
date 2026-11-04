'use client'
import { useEffect, useRef, useState } from 'react'
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
  pos_qty: number | null
  userid: string
  ic_order_num: string | null
  ic_status: string | null
  ic_note: string | null
  ic_logged_by: string | null
}

export default function AutoCSVPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [activeTab, setActiveTab] = useState<'processor' | 'logbook'>('processor')

  // Invoice Processor state
  const [vendorCSV, setVendorCSV] = useState('')
  const [posQuery, setPosQuery] = useState('')
  const [posSummary, setPosSummary] = useState('')
  const vendorTaRef = useRef<HTMLTextAreaElement>(null)
  const posTaRef    = useRef<HTMLTextAreaElement>(null)

  interface SummaryRow {
    invoice: string; poNum: string; customer: string; qty: number; dupes: number; alreadyLogged: boolean
  }
  const [vendorSummaryRows, setVendorSummaryRows] = useState<SummaryRow[]>([])
  const [vendorFooter, setVendorFooter]           = useState('')

  // Log Book state
  const [logEntries, setLogEntries]   = useState<LogBookEntry[]>([])
  const [logFilter, setLogFilter]     = useState('')
  const [logLoading, setLogLoading]   = useState(false)

  // POS processing state
  interface PosRow {
    invoice: string; poNum: string; customer: string; style: string
    upc: string; shippedQty: string; id: string; createdPO: string
    itemNotOnOrder: string; validUPC: string; poPreviouslyClosed: string
    storeID: string; newPONumber: string
    isError: boolean
  }
  const [posRows, setPosRows]           = useState<PosRow[]>([])
  const [posErrors, setPosErrors]       = useState<PosRow[]>([])
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [fixedInput, setFixedInput]     = useState('')
  const [showAddFixed, setShowAddFixed] = useState(false)
  const [pendingLog, setPendingLog]     = useState<Record<string, { poNum: string; customer: string; storeID: string; qty: number; posQty?: number }>>({})

  const [toast, setToast]               = useState('')
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [loggedInvoices, setLoggedInvoices] = useState<Set<string>>(new Set())

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleSelectAll(ids: string[]) {
    setSelectedIds(prev => prev.size === ids.length ? new Set() : new Set(ids))
  }

  async function deleteSelected() {
    if (!selectedIds.size) return
    const pw = prompt(`Delete ${selectedIds.size} row${selectedIds.size !== 1 ? 's' : ''}? Enter password:`)
    if (pw === null) return
    if (pw.toLowerCase() !== 'delete') { showToast('❌ Incorrect password'); return }
    await supabase.from('autocsv_log').delete().in('id', Array.from(selectedIds))
    setLogEntries(prev => prev.filter(e => !selectedIds.has(e.id)))
    setSelectedIds(new Set())
    showToast(`🗑 Deleted ${selectedIds.size} row${selectedIds.size !== 1 ? 's' : ''}`)
  }

  function copyLog(entries: LogBookEntry[]) {
    const cols = ['Timestamp','Invoice #','PO #','Store','CSV Qty','POS Qty','Match','IC Order #','Logged By','IC Status','Note']
    const rows = entries.map(e => {
      const match = e.pos_qty !== null ? (e.qty_total === e.pos_qty ? '✓' : '✗') : ''
      const d = new Date(e.exported_at)
      const ts = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${String(d.getFullYear()).slice(2)} ${String(d.getHours()%12||12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      return [ts, e.invoice_num, e.po_num||'', e.store, e.qty_total, e.pos_qty??'', match, e.ic_order_num||'', e.ic_logged_by||e.userid, e.ic_status||'', e.ic_note||''].join('\t')
    })
    navigator.clipboard.writeText([cols.join('\t'), ...rows].join('\n'))
    showToast('📋 Copied to clipboard')
  }

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVis() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [router])

  useEffect(() => { if (activeTab === 'logbook') fetchLogEntries() }, [activeTab])

  useEffect(() => {
    supabase.from('autocsv_log').select('invoice_num').then(({ data }) => {
      if (data) setLoggedInvoices(new Set(data.map((r: { invoice_num: string }) => r.invoice_num)))
    })
  }, [])

  async function fetchLogEntries() {
    setLogLoading(true)
    const { data: pushData } = await supabase.from('autocsv_log').select('*').order('exported_at', { ascending: false })
    const pushRows = pushData || []
    const invoiceNums = pushRows.map((r: { invoice_num: string }) => r.invoice_num)
    const poNums = pushRows.map((r: { po_num: string }) => r.po_num).filter(Boolean)
    const allLookupNums = Array.from(new Set([...invoiceNums, ...poNums]))
    let icMap: Record<string, { ic_order_num: string; ic_logged_by: string; ic_status: string; ic_note: string }> = {}
    if (allLookupNums.length) {
      const { data: icData } = await supabase.from('ic_log').select('order_num, userid, status, note').in('order_num', allLookupNums)
      type IcRow = { order_num: string; userid: string; status: string; note: string }
      const icByOrderNum: Record<string, IcRow> = {}
      for (const ic of icData || []) icByOrderNum[ic.order_num] = ic
      for (const row of pushRows) {
        const ic = icByOrderNum[row.invoice_num] ?? icByOrderNum[row.po_num] ?? null
        if (!ic) continue
        icMap[row.invoice_num] = { ic_order_num: ic.order_num, ic_logged_by: ic.userid, ic_status: ic.status, ic_note: ic.note }
      }
    }
    const entries: LogBookEntry[] = pushRows.map((r: {
      id: string; exported_at: string; invoice_num: string; po_num: string
      store: string; qty_total: number; pos_qty: number | null; userid: string
    }) => ({
      ...r,
      ic_order_num: icMap[r.invoice_num]?.ic_order_num ?? null,
      ic_logged_by: icMap[r.invoice_num]?.ic_logged_by ?? null,
      ic_status:    icMap[r.invoice_num]?.ic_status ?? null,
      ic_note:      icMap[r.invoice_num]?.ic_note ?? null,
    }))
    setLogEntries(entries)
    setLoggedInvoices(new Set(entries.map(e => e.invoice_num)))
    setLogLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function blurZoomReset() {
    if (typeof window !== 'undefined' && window.visualViewport) {
      ;(document.documentElement.style as any).zoom = '1'
    }
  }

  function processVendorCSV() {
    if (!vendorCSV.trim()) { showToast('⚠️ Paste vendor CSV data first'); return }
    const allLines = vendorCSV.trim().split('\n')
    const dataLines = allLines.filter(l => {
      const t = l.trim()
      return t && !/^invoicenocompany/i.test(t)
    })
    const parsed: Record<string, { poNum: string; customer: string; qty: number; dupes: number }> = {}
    const seen = new Set<string>()
    let totalQty = 0
    for (const line of dataLines) {
      const parts = line.includes('\t') ? line.split('\t').map(s => s.trim()) : line.trim().split(/\s{2,}/)
      if (parts.length < 6) continue
      const [invoice, poNum, customer, , upc, qtyStr] = parts
      const qty = parseInt(qtyStr) || 0
      const dupeKey = `${invoice}|${upc}`
      if (!parsed[invoice]) parsed[invoice] = { poNum, customer, qty: 0, dupes: 0 }
      if (seen.has(dupeKey)) { parsed[invoice].dupes++ }
      else { seen.add(dupeKey); parsed[invoice].qty += qty; totalQty += qty }
    }
    const rows = Object.entries(parsed).map(([invoice, v]) => ({
      invoice, poNum: v.poNum, customer: v.customer, qty: v.qty, dupes: v.dupes,
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
        const parts = line.split('\t')
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
    const bad  = rows.filter(r => r.isError)
    setPosRows(rows); setPosErrors(bad)
    const grouped: Record<string, { poNum: string; customer: string; storeID: string; qty: number; posQty: number }> = {}
    for (const r of good) {
      const q = parseInt(r.shippedQty) || 0
      if (!grouped[r.invoice]) grouped[r.invoice] = { poNum: r.poNum, customer: r.customer, storeID: r.storeID, qty: 0, posQty: 0 }
      grouped[r.invoice].qty += q; grouped[r.invoice].posQty += q
    }
    setPendingLog(grouped)
    const invLines: string[] = []
    for (const [inv, v] of Object.entries(grouped)) invLines.push(`${inv}\t${v.poNum}\t${v.customer}\t${v.storeID}\t${v.qty}`)
    setPosSummary(['InvoiceNoCompany\tPONum\tCustomer\tStoreID\tShippedQty (sum)', ...invLines].join('\n'))
    showToast(`✅ ${good.length} clean · ${bad.length} error${bad.length !== 1 ? 's' : ''}`)
    if (bad.length > 0) setShowAddFixed(false)
  }

  async function logToSupabase(
    grouped: Record<string, { poNum: string; customer: string; storeID: string; qty: number; posQty?: number }>,
    allowDupes = false
  ) {
    if (!user) return
    let skipped = 0
    for (const [invoice, v] of Object.entries(grouped)) {
      if (!allowDupes && loggedInvoices.has(invoice)) { skipped++; continue }
      await supabase.from('autocsv_log').insert({
        invoice_num: invoice, po_num: v.poNum,
        store: v.storeID || user.store, qty_total: v.qty,
        pos_qty: v.posQty ?? null, userid: user.userid,
      })
    }
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
    await logToSupabase(grouped, true)
    showToast(`✅ Added ${Object.keys(grouped).length} fixed invoice(s) to log`)
    setFixedInput(''); setShowAddFixed(false)
  }

  function clearAll() {
    setVendorCSV(''); setVendorSummaryRows([]); setVendorFooter('')
    setPosQuery(''); setPosSummary(''); setPosRows([]); setPosErrors([])
    setPendingLog({}); setShowAddFixed(false); setFixedInput('')
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
    fontFamily: 'monospace', fontSize: 16, color: '#2d1f6e',
    lineHeight: 1.5, padding: '10px 12px', boxSizing: 'border-box',
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
    justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 6,
  }

  const panelLabelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, color: purple,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  }

  const smBtn = (bg: string, color: string): React.CSSProperties => ({
    background: bg, color, border: 'none', borderRadius: 5,
    padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  })

  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        .acsv-grid {
          flex: 1; display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          gap: 12px; padding: 16px; min-height: 0;
        }
        @media (max-width: 700px) {
          .acsv-grid { grid-template-columns: 1fr; grid-template-rows: none; gap: 8px; padding: 8px; }
          .acsv-hdr-hint { display: none; }
          .log-toolbar { flex-wrap: wrap; }
          .log-search { font-size: 16px !important; }
          /* Input panels: short textarea, just enough to paste */
          .acsv-panel-input { min-height: 160px; }
          .acsv-panel-input .acsv-ta { min-height: 100px; height: 100px !important; font-size: 16px !important; }
          /* Summary panels: tall so data is readable */
          .acsv-panel-summary { min-height: 300px; }
          /* Log book: tighter table on mobile */
          .log-title-block { display: none; }
          .log-col-hide { display: none; }
          .log-note-col { display: none; }
          .log-table td, .log-table th { padding: 5px 6px !important; font-size: 10px !important; }
          .log-table th { font-size: 9px !important; letter-spacing: 0 !important; }
        }
        @media (min-width: 701px) {
          .log-col-hide { display: inline; }
          .log-note-col { display: table-cell; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e1b4b', color: '#fff', borderRadius: 10, padding: '10px 20px',
          fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{
        padding: '10px 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        justifyContent: 'space-between', borderBottom: `1px solid ${border}`,
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)',
        position: 'sticky', top: 0, zIndex: 10, flexShrink: 0,
      }}>
        {/* Left: Home + divider + user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>
            ← Home
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{user.userid}</span>
            {' · '}{user.store === 'ALL' ? 'All Stores' : user.store}
          </span>
        </div>

        {/* Center: module name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center' }}>
          <span style={{ fontSize: 15, color: purple }}>⚡</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>AUTO CSV</span>
        </div>

        {/* Right: actions */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
          {activeTab === 'processor' && (
            <button onClick={clearAll}
              style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              🗑 Clear
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: `2px solid ${border}`,
        background: 'rgba(255,255,255,0.5)', padding: '0 16px', flexShrink: 0,
      }}>
        {(['processor', 'logbook'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 700,
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
      {/* TAB 1: Invoice Processor                                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'processor' && (
        <>
          <div className="acsv-grid">

            {/* PANEL 0 — Vendor CSV input */}
            <div className="acsv-panel acsv-panel-input" style={panelStyle}>
              <div style={{ ...panelHeaderStyle }}>
                <span style={panelLabelStyle}>Vendor CSV</span>
                <span className="acsv-hdr-hint" style={{ fontSize: 10, color: '#b8aed8' }}>InvoiceNoCompany · PONum · Customer · Style · UPC · ShippedQty</span>
                <button onClick={processVendorCSV} style={smBtn(purple, '#fff')}>▶ Process</button>
              </div>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <textarea
                  ref={vendorTaRef}
                  value={vendorCSV}
                  onChange={e => { setVendorCSV(e.target.value); requestAnimationFrame(() => { if (vendorTaRef.current) vendorTaRef.current.scrollTop = 0 }) }}
                  onBlur={blurZoomReset}
                  placeholder="Paste vendor CSV data here…"
                  className="acsv-ta"
                  style={taStyle}
                />
              </div>
              <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 11, color: '#9b8ec4' }}>
                {vendorCSV.trim()
                  ? `✓ ${vendorCSV.trim().split('\n').filter(l => l.trim() && !/^invoicenocompany/i.test(l.trim())).length} rows`
                  : 'No data — paste vendor CSV above'}
              </div>
            </div>

            {/* PANEL 1 — Vendor Summary */}
            <div className="acsv-panel acsv-panel-summary" style={panelStyle}>
              <div style={panelHeaderStyle}>
                <span style={panelLabelStyle}>Summary + Errors</span>
                {vendorSummaryRows.length > 0 && (
                  <span style={{ fontSize: 10, color: vendorFooter.includes('⚠') ? '#dc2626' : '#15803d', fontWeight: 700 }}>
                    {vendorSummaryRows.length} invoice{vendorSummaryRows.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {vendorSummaryRows.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                        {['Invoice #','PO #','Customer','Qty','Dupes','Already Logged?'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', fontWeight: 800, color: purple, textAlign: 'left', whiteSpace: 'nowrap', fontSize: 10, letterSpacing: '0.04em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vendorSummaryRows.map((row, i) => (
                        <tr key={i} style={{ background: row.alreadyLogged ? '#fff1f2' : i % 2 === 0 ? '#fff' : '#faf8ff', borderBottom: `1px solid ${border}` }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: row.alreadyLogged ? '#dc2626' : '#2d1f6e', fontWeight: 600 }}>{row.invoice}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#555' }}>{row.poNum}</td>
                          <td style={{ padding: '6px 10px', color: '#555', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{row.qty}</td>
                          <td style={{ padding: '6px 10px', color: row.dupes > 0 ? '#f59e0b' : '#aaa' }}>{row.dupes > 0 ? row.dupes : ''}</td>
                          <td style={{ padding: '6px 10px', color: '#dc2626', fontWeight: 700 }}>{row.alreadyLogged ? '⚠ DUPE' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: 24, color: '#c4b5fd', fontSize: 12, textAlign: 'center' }}>Process vendor CSV to see summary</div>
                )}
              </div>
              <div style={{ padding: '6px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: vendorFooter.includes('⚠') ? '#dc2626' : '#9b8ec4' }}>
                {vendorFooter || ' '}
              </div>
            </div>

            {/* PANEL 2 — POS Query input */}
            <div className="acsv-panel acsv-panel-input" style={panelStyle}>
              <div style={panelHeaderStyle}>
                <span style={panelLabelStyle}>POS Query</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {posErrors.length > 0 && (
                    <button onClick={() => setShowErrorModal(true)} style={smBtn('#fff3cd', '#92400e')}>
                      ⚠ Errors ({posErrors.length})
                    </button>
                  )}
                  <button onClick={processPosQuery} style={smBtn('#e0e7ff', '#3730a3')}>▶ Process</button>
                  <button onClick={handleProcessAndLog} style={smBtn(purple, '#fff')}>📥 Log</button>
                </div>
              </div>

              {/* Fixed header row — hidden on mobile to save space */}
              <div style={{ overflowX: 'auto', flexShrink: 0, borderBottom: `1px solid ${border}` }} className="acsv-hdr-hint">
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

              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <textarea
                  ref={posTaRef}
                  value={posQuery}
                  onChange={e => { setPosQuery(e.target.value); requestAnimationFrame(() => { if (posTaRef.current) posTaRef.current.scrollTop = 0 }) }}
                  onBlur={blurZoomReset}
                  placeholder="Paste POS system response here…"
                  className="acsv-ta"
                  style={{ ...taStyle, fontSize: 16 }}
                />
              </div>
              <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 11, color: '#9b8ec4' }}>
                {posRows.length > 0
                  ? `${posRows.length} rows · ${posRows.filter(r=>!r.isError).length} clean · ${posErrors.length} error${posErrors.length !== 1 ? 's' : ''}`
                  : posQuery.trim() ? `${posQuery.trim().split('\n').filter(l => l.trim()).length} rows pasted` : 'No data — paste POS query above'}
              </div>

              {showAddFixed && (
                <div style={{ borderTop: `2px solid #fcd34d`, background: '#fffbeb', padding: 10, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>
                    ✏️ ADD FIXED ROWS — paste corrected rows below
                  </div>
                  <textarea
                    value={fixedInput}
                    onChange={e => setFixedInput(e.target.value)}
                    onBlur={blurZoomReset}
                    placeholder="Paste corrected rows here…"
                    style={{ ...taStyle, height: 90, background: '#fff', border: `1px solid #fcd34d`, borderRadius: 6, fontSize: 16 }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setShowAddFixed(false); setFixedInput('') }} style={smBtn('#f3f4f6', '#6b7280')}>Cancel</button>
                    <button onClick={handleAddFixed} style={smBtn('#16a34a', '#fff')}>✅ Add to Log</button>
                  </div>
                </div>
              )}
            </div>

            {/* PANEL 3 — POS Summary */}
            <div className="acsv-panel acsv-panel-summary" style={panelStyle}>
              <div style={panelHeaderStyle}>
                <span style={panelLabelStyle}>POS Summary</span>
                {posRows.length > 0 && (
                  <span style={{ fontSize: 10, color: posErrors.length > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                    {posErrors.length > 0 ? `⚠ ${posErrors.length} error${posErrors.length !== 1 ? 's' : ''} excluded` : '✅ All rows clean'}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {posSummary ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: purpleLight, borderBottom: `2px solid ${border}` }}>
                        {['Invoice #','PO #','Customer','StoreID','Qty'].map(h => (
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
                            <td style={{ padding: '6px 10px', color: '#555', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer}</td>
                            <td style={{ padding: '6px 10px', color: '#555' }}>{storeID}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{qty}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: 24, color: '#c4b5fd', fontSize: 12, textAlign: 'center' }}>Process POS query to see summary</div>
                )}
              </div>
              {posSummary && (
                <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 11, color: '#9b8ec4' }}>
                  {posSummary.split('\n').length - 1} unique invoice{posSummary.split('\n').length - 1 !== 1 ? 's' : ''}
                </div>
              )}
            </div>

          </div>

          {/* Error Modal */}
          {showErrorModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
            }} onClick={() => setShowErrorModal(false)}>
              <div style={{
                background: '#fff', borderRadius: 14, width: '100%', maxWidth: 900, maxHeight: '80vh',
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
                        {['Invoice #','PO #','Customer','Style','UPC','ShippedQTY','ValidUPC','StoreID'].map(h => (
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
                <div style={{ padding: '10px 20px', borderTop: '1px solid #fecaca', background: '#fff1f2', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowErrorModal(false)} style={smBtn('#dc2626', '#fff')}>Close</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: Log Book                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'logbook' && (
        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          <div className="log-toolbar" style={{ display: 'flex', justifyContent: 'center', padding: '0 16px', marginBottom: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 1100 }}>
            <div className="log-title-block" style={{ flexShrink: 0 }}>
              <h3 style={{ fontSize: 13, fontWeight: 800, color: '#3b1f8c', margin: 0 }}>Push Log &amp; IC Cross-Reference</h3>
              <p style={{ fontSize: 10, color: '#9b8ec4', margin: 0 }}>
                {filteredLog.length} entr{filteredLog.length !== 1 ? 'ies' : 'y'}
                {selectedIds.size > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> · {selectedIds.size} selected</span>}
              </p>
            </div>

            <input
              className="log-search"
              value={logFilter}
              onChange={e => setLogFilter(e.target.value)}
              onBlur={blurZoomReset}
              placeholder="Search"
              style={{
                flex: 1, background: '#f5f3ff', border: `1.5px solid ${border}`,
                borderRadius: 8, padding: '8px 12px', fontSize: 13,
                color: '#3b1f8c', fontWeight: 600, outline: 'none', minWidth: 0,
              }}
            />

            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => copyLog(filteredLog)} style={smBtn('#e0e7ff', '#3730a3')}>📋 Copy</button>
              <button onClick={deleteSelected} disabled={selectedIds.size === 0}
                style={{ ...smBtn('#fee2e2', '#dc2626'), opacity: selectedIds.size === 0 ? 0.4 : 1, cursor: selectedIds.size === 0 ? 'default' : 'pointer' }}>
                🗑{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
            </div>
          </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '0 16px 16px' }}>
          <div style={{ background: '#fff', border: `1px solid #93c5fd`, overflow: 'auto', width: '100%', maxWidth: 1100, alignSelf: 'flex-start' }}>
            <table className="log-table" style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 480 }}>
              <thead>
                <tr style={{ background: '#dbeafe', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '6px 8px', width: 28, borderBottom: '2px solid #93c5fd' }}>
                    <input type="checkbox"
                      checked={filteredLog.length > 0 && selectedIds.size === filteredLog.length}
                      onChange={() => toggleSelectAll(filteredLog.map(e => e.id))}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  {['Date / Time', 'Invoice #', 'PO #', 'Store', 'CSV Qty', 'POS Qty', '✓', 'IC #', 'By', 'Status', 'Note'].map((h, hi) => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#1e3a8a', borderBottom: '2px solid #93c5fd', whiteSpace: 'nowrap', ...(hi === 6 ? { textAlign: 'center' as const, borderRight: '2px solid #93c5fd' } : {}), ...(hi >= 7 ? { color: '#0369a1' } : {}) }}
                      className={h === 'Note' ? 'log-note-col' : ''}
                    >{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logLoading ? (
                  <tr><td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Loading…</td></tr>
                ) : filteredLog.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: 32, textAlign: 'center', color: '#9b8ec4', fontSize: 13 }}>No entries found.</td></tr>
                ) : filteredLog.map((e, i) => {
                  const csvQty = e.qty_total
                  const posQty = e.pos_qty ?? null
                  const match  = posQty !== null ? csvQty === posQty : null
                  const hasIC  = !!e.ic_order_num
                  const isSel  = selectedIds.has(e.id)
                  const d = new Date(e.exported_at)
                  const dateStr = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${String(d.getFullYear()).slice(2)}`
                  const h = d.getHours() % 12 || 12
                  const timeStr = ` ${h}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
                  const rowBg = isSel ? '#ede9fe' : hasIC ? (i%2===0 ? '#dcfce7' : '#d1fae5') : i%2===0 ? '#fff' : '#eff6ff'
                  const textColor = hasIC ? '#15803d' : '#111827'
                  const dimColor  = hasIC ? '#16a34a' : '#6b7280'
                  return (
                    <tr key={e.id} style={{ background: rowBg, cursor: 'default' }}>
                      <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelect(e.id)} style={{ cursor: 'pointer', width: 13, height: 13 }} />
                      </td>
                      <td style={{ padding: '6px 12px', fontSize: 11, color: dimColor, whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>
                        {dateStr}<span className="log-col-hide" style={{ fontSize: 10 }}>{timeStr}</span>
                      </td>
                      <td style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, color: hasIC ? '#15803d' : '#1d4ed8', whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>{e.invoice_num}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12, color: textColor, whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>{e.po_num || '—'}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: textColor, borderBottom: '1px solid #e5e7eb' }}>{e.store}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12, textAlign: 'center', color: textColor, borderBottom: '1px solid #e5e7eb' }}>{csvQty}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12, color: posQty !== null ? textColor : '#d1d5db', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>{posQty ?? '—'}</td>
                      <td style={{ padding: '6px 12px', fontSize: 13, textAlign: 'center', borderRight: '2px solid #93c5fd', borderBottom: '1px solid #e5e7eb' }}>
                        {match === true ? <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span>
                          : match === false ? <span style={{ color: '#dc2626', fontWeight: 800 }}>✗</span>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td style={{ padding: '6px 12px', fontSize: 12, color: hasIC ? '#0369a1' : '#d1d5db', fontWeight: hasIC ? 700 : 400, whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>{e.ic_order_num || '—'}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12, color: e.ic_logged_by ? '#0369a1' : '#d1d5db', whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>{e.ic_logged_by || '—'}</td>
                      <td style={{ padding: '6px 12px', fontSize: 11, whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>
                        {e.ic_status ? (
                          <span style={{
                            background: e.ic_status.toLowerCase().includes('push') ? '#dcfce7' : '#eff6ff',
                            color: e.ic_status.toLowerCase().includes('push') ? '#15803d' : '#1d4ed8',
                            borderRadius: 4, padding: '2px 6px', fontWeight: 700, fontSize: 10,
                          }}>{e.ic_status}</span>
                        ) : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td className="log-note-col" style={{ padding: '6px 12px', fontSize: 11, color: dimColor, borderBottom: '1px solid #e5e7eb' }}>{e.ic_note || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

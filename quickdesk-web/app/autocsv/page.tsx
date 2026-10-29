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
  const [vendorSummary, setVendorSummary] = useState('')
  const [posQuery, setPosQuery] = useState('')
  const [posSummary, setPosSummary] = useState('')

  // Log Book state
  const [logEntries, setLogEntries] = useState<LogBookEntry[]>([])
  const [logFilter, setLogFilter] = useState('')
  const [logLoading, setLogLoading] = useState(false)

  const [toast, setToast] = useState('')

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    if (activeTab === 'logbook') fetchLogEntries()
  }, [activeTab])

  async function fetchLogEntries() {
    setLogLoading(true)
    const { data } = await supabase
      .from('autocsv_log')
      .select('*')
      .order('exported_at', { ascending: false })
    setLogEntries(data || [])
    setLogLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function processVendorCSV() {
    if (!vendorCSV.trim()) { showToast('⚠️ Paste vendor CSV data first'); return }
    const lines = vendorCSV.trim().split('\n').filter(l => l.trim())
    // Parse tab or whitespace separated: InvoiceNoCompany PONum Customer Style UPC ShippedQty
    const parsed: Record<string, { poNum: string; customer: string; qty: number; dupes: number }> = {}
    let total = 0
    const seen = new Set<string>()

    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 6) continue
      const [invoice, poNum, customer, , upc, qtyStr] = parts
      const qty = parseInt(qtyStr) || 0
      const key = `${invoice}|${upc}`
      if (seen.has(key)) {
        if (parsed[invoice]) parsed[invoice].dupes++
      } else {
        seen.add(key)
        if (!parsed[invoice]) {
          parsed[invoice] = { poNum, customer, qty: 0, dupes: 0 }
        }
        parsed[invoice].qty += qty
        total += qty
      }
    }

    const rows = Object.entries(parsed)
    const uniqueCount = rows.length
    const totalDupes = rows.reduce((s, [, v]) => s + v.dupes, 0)

    // Build summary text
    const header = 'InvoiceNoCompany\tPONum\tCustomer\tShippedQty (sum)\tDupes'
    const body = rows.map(([inv, v]) => `${inv}\t${v.poNum}\t${v.customer}\t${v.qty}\t${v.dupes || ''}`).join('\n')
    setVendorSummary([header, body].join('\n'))

    showToast(`✅ ${lines.length} rows · ${uniqueCount} unique · ${totalDupes} dupes`)
  }

  function processPosQuery() {
    if (!posQuery.trim()) { showToast('⚠️ Paste POS query data first'); return }
    const lines = posQuery.trim().split('\n').filter(l => l.trim())
    const parsed: Record<string, { poNum: string; customer: string; storeId: string; qty: number; notOnOrder: number; closedPO: boolean; newPO: string }> = {}
    let errors = 0

    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 7) continue
      const [invoice, poNum, customer, , upc, qty, , , notOnOrder, validUpc, closedPO, storeId, newPO] = parts
      const q = parseInt(qty) || 0
      if (!parsed[invoice]) {
        parsed[invoice] = { poNum, customer, storeId: storeId || '', qty: 0, notOnOrder: 0, closedPO: false, newPO: newPO || '' }
      }
      parsed[invoice].qty += q
      if (notOnOrder && notOnOrder !== 'NO') parsed[invoice].notOnOrder++
      if (closedPO === '✓' || closedPO === 'yes') parsed[invoice].closedPO = true
      if (validUpc === 'NO' || notOnOrder === 'YES') errors++
    }

    const rows = Object.entries(parsed)
    const header = 'InvoiceNoCompany\tPONum\tCustomer\tStoreID\tShippedQty (sum)\tItem Not On Order\tClosed PO?\tNewPO#'
    const body = rows.map(([inv, v]) =>
      `${inv}\t${v.poNum}\t${v.customer}\t${v.storeId}\t${v.qty}\t${v.notOnOrder || ''}\t${v.closedPO ? '✓' : ''}\t${v.newPO || ''}`
    ).join('\n')
    setPosSummary([header, body].join('\n'))

    showToast(`✅ Processed · ${errors} with errors`)
  }

  function copyText(text: string) {
    if (!text) { showToast('Nothing to copy'); return }
    navigator.clipboard.writeText(text)
      .then(() => showToast('📋 Copied'))
      .catch(() => showToast('❌ Clipboard not available'))
  }

  function clearAll() {
    setVendorCSV('')
    setVendorSummary('')
    setPosQuery('')
    setPosSummary('')
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
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setVendorCSV('')} style={smBtn('#fee2e2', '#dc2626')}>Clear</button>
                <button onClick={processVendorCSV} style={smBtn(purple, '#fff')}>▶ Process</button>
              </div>
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
                ? `${vendorCSV.trim().split('\n').filter(l => l.trim()).length} rows`
                : 'No data'}
            </div>
          </div>

          {/* TOP-RIGHT: Vendor Summary + Errors */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>Summary + Errors</span>
              <button onClick={() => copyText(vendorSummary)} style={smBtn('#dbeafe', '#1e40af')}>📋 Copy</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {vendorSummary ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <tbody>
                    {vendorSummary.split('\n').map((line, i) => {
                      const cells = line.split('\t')
                      return (
                        <tr key={i} style={{ background: i === 0 ? purpleLight : i % 2 === 0 ? '#fff' : '#faf8ff', borderBottom: `1px solid ${border}` }}>
                          {cells.map((cell, j) => (
                            <td key={j} style={{
                              padding: '6px 10px',
                              fontWeight: i === 0 ? 800 : 400,
                              color: i === 0 ? purple : '#333',
                              fontFamily: i === 0 ? 'inherit' : 'monospace',
                              whiteSpace: 'nowrap',
                            }}>{cell}</td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: '#c4b5fd', fontSize: 12 }}>
                  Process vendor CSV to see summary
                </div>
              )}
            </div>
            {vendorSummary && (
              <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: '#9b8ec4' }}>
                {vendorSummary.split('\n').length - 1} unique invoices
              </div>
            )}
          </div>

          {/* BOTTOM-LEFT: POS Query input */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>POS Query</span>
              <span style={{ fontSize: 10, color: '#b8aed8' }}>InvoiceNoCompany · PONum · Customer · UPC · ValidUPC ...</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setPosQuery('')} style={smBtn('#fee2e2', '#dc2626')}>Clear</button>
                <button onClick={processPosQuery} style={smBtn(purple, '#fff')}>▶ Process + Log</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <textarea
                value={posQuery}
                onChange={e => setPosQuery(e.target.value)}
                placeholder="Paste POS query data here..."
                style={taStyle}
              />
            </div>
            <div style={{ padding: '5px 12px', borderTop: `1px solid ${border}`, background: '#faf9ff', fontSize: 10, color: '#9b8ec4' }}>
              {posQuery.trim()
                ? `${posQuery.trim().split('\n').filter(l => l.trim()).length} rows`
                : 'No data'}
            </div>
          </div>

          {/* BOTTOM-RIGHT: POS Summary + Errors */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>POS Summary + Errors</span>
              <button onClick={() => copyText(posSummary)} style={smBtn('#dbeafe', '#1e40af')}>📋 Copy</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {posSummary ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <tbody>
                    {posSummary.split('\n').map((line, i) => {
                      const cells = line.split('\t')
                      const hasError = cells.some(c => c && c !== '' && (cells[5] !== '' || cells[6] === '✓'))
                      return (
                        <tr key={i} style={{
                          background: i === 0 ? purpleLight : hasError && i > 0 ? '#fff1f2' : i % 2 === 0 ? '#fff' : '#faf8ff',
                          borderBottom: `1px solid ${border}`,
                        }}>
                          {cells.map((cell, j) => (
                            <td key={j} style={{
                              padding: '6px 10px',
                              fontWeight: i === 0 ? 800 : 400,
                              color: i === 0 ? purple : hasError && i > 0 ? '#dc2626' : '#333',
                              fontFamily: i === 0 ? 'inherit' : 'monospace',
                              whiteSpace: 'nowrap',
                            }}>{cell}</td>
                          ))}
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
                {posSummary.split('\n').length - 1} invoices processed
              </div>
            )}
          </div>

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

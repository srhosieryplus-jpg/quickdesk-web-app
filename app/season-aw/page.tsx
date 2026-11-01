'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

interface AWRow {
  id: string
  store: string
  brand: string
  invoice_no: string
  po_no: string | null
  qty: number | null
  logged: boolean
  logged_by: string | null
  logged_at: string | null
  note: string | null
  flagged: boolean
  created_at: string
}

// ── theme ────────────────────────────────────────────────────────────────────
const blue   = '#1e40af'
const blueD  = '#1e3a8a'
const blueL  = '#eff6ff'
const border = '#93c5fd'
const amber  = '#d97706'
const amberL = '#fffbeb'

const labelSt: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: blueD, whiteSpace: 'nowrap',
}
const inputSt: React.CSSProperties = {
  background: '#fff', border: `1px solid #d1d5db`, borderRadius: 5,
  padding: '4px 8px', fontSize: 12, color: '#111', outline: 'none',
  fontFamily: 'Inter, sans-serif',
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'found';    row: AWRow }
  | { phase: 'notfound'; invoice: string }
  | { phase: 'brand';    results: AWRow[] }
  | { phase: 'create';   invoice: string }

export default function SeasonAWPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  // search
  const [query, setQuery]           = useState('')
  const [searching, setSearching]   = useState(false)
  const [state, setState]           = useState<SearchState>({ phase: 'idle' })

  // brand search
  const [brandQuery, setBrandQuery] = useState('')

  // create-request form
  const [crNote, setCrNote]         = useState('PRIORITY — items on floor, not in system')
  const [crBrand, setCrBrand]       = useState('')
  const [crPO, setCrPO]             = useState('')
  const [crQty, setCrQty]           = useState('')
  const [submitting, setSubmitting] = useState(false)

  // log confirmation
  const [logNote, setLogNote]       = useState('')
  const [logging, setLogging]       = useState(false)

  const [toast, setToast]           = useState('')
  const [toastType, setToastType]   = useState<'ok'|'err'>('ok')

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setUser(u)
  }, [router])

  // ── return to selector after screen lock / idle ───────────────────────────
  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000 // 5 minutes

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) {
          router.push('/selector')
        }
        hiddenAt = null
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [router])

  function showToast(msg: string, type: 'ok'|'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3200)
  }

  // ── search by invoice # ───────────────────────────────────────────────────
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const inv = query.trim()
    if (!inv || !user) return
    setSearching(true)
    const { data } = await supabase
      .from('season_aw')
      .select('*')
      .eq('store', user.store)
      .ilike('invoice_no', inv)
      .maybeSingle()
    setSearching(false)
    if (data) {
      setState({ phase: 'found', row: data as AWRow })
    } else {
      setState({ phase: 'notfound', invoice: inv })
    }
  }

  // ── search by brand ───────────────────────────────────────────────────────
  async function handleBrandSearch(e: React.FormEvent) {
    e.preventDefault()
    const b = brandQuery.trim()
    if (!b || !user) return
    setSearching(true)
    const { data } = await supabase
      .from('season_aw')
      .select('*')
      .eq('store', user.store)
      .eq('logged', false)
      .ilike('brand', `%${b}%`)
      .order('created_at', { ascending: false })
    setSearching(false)
    setState({ phase: 'brand', results: (data || []) as AWRow[] })
  }

  // ── log a found row ───────────────────────────────────────────────────────
  async function logRow(row: AWRow) {
    if (!user) return
    setLogging(true)
    const { error } = await supabase
      .from('season_aw')
      .update({
        logged: true,
        logged_by: user.userid,
        logged_at: new Date().toISOString(),
        note: logNote.trim() || row.note,
      })
      .eq('id', row.id)
    setLogging(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Invoice logged!')
    reset()
  }

  // ── create a flag/request row ─────────────────────────────────────────────
  async function submitCreateRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const inv = state.phase === 'create' ? state.invoice : query.trim()
    setSubmitting(true)
    const { error } = await supabase.from('season_aw').insert({
      store:      user.store,
      brand:      crBrand.trim() || '—',
      invoice_no: inv,
      po_no:      crPO.trim() || null,
      qty:        crQty ? parseInt(crQty) : null,
      logged:     true,
      logged_by:  user.userid,
      logged_at:  new Date().toISOString(),
      note:       crNote.trim(),
      flagged:    true,
    })
    setSubmitting(false)
    if (error) { showToast('❌ ' + error.message, 'err'); return }
    showToast('✅ Log request submitted — admin notified')
    reset()
  }

  function reset() {
    setState({ phase: 'idle' })
    setQuery(''); setBrandQuery('')
    setCrNote('PRIORITY — items on floor, not in system')
    setCrBrand(''); setCrPO(''); setCrQty(''); setLogNote('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', minWidth: 80, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{value ?? '—'}</span>
      </div>
    )
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: blueL, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; }
        .aw-btn { border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; transition: opacity 0.15s; }
        .aw-btn:disabled { opacity: 0.6; cursor: default; }
        .aw-btn-primary { background: ${blue}; color: #fff; }
        .aw-btn-outline { background: #fff; color: ${blueD}; border: 1.5px solid ${border} !important; }
        .aw-btn-amber  { background: ${amber}; color: #fff; }
        .aw-btn-gray   { background: #f3f4f6; color: #374151; }
        .result-card { background: #fff; border: 1.5px solid ${border}; border-radius: 10px; padding: 16px; margin: 0; box-shadow: 0 2px 12px rgba(30,64,175,0.07); }
        .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
        .brand-row:hover { background: ${blueL}; border-color: ${border}; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: blue, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `2px solid ${blueD}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/selector')}
            style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ← Home
          </button>
          <div style={{ width: 1, height: 16, background: '#3b82f6' }} />
          <span style={{ fontSize: 12, color: '#93c5fd' }}>
            <span style={{ fontWeight: 700, color: '#bfdbfe' }}>{user?.userid}</span>
            {user?.store && user.store !== 'ALL' && (
              <span style={{ marginLeft: 6, background: blueD, color: '#bfdbfe', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px' }}>{user.store}</span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 16, color: '#bfdbfe' }}>✻</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: '0.08em' }}>AW SEASON</span>
        </div>
        <div style={{ width: 80 }} />
      </div>

      {/* ── SEARCH BAR ── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '8px 16px', display: 'flex', justifyContent: 'center' }}>
        <form onSubmit={handleSearch} style={{ width: '100%', maxWidth: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={labelSt}>Invoice #:</label>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); if (state.phase !== 'idle') setState({ phase: 'idle' }) }}
            placeholder="Enter invoice number…"
            style={{ ...inputSt, flex: 1 }}
          />
          <button type="submit" disabled={!query.trim() || searching} className="aw-btn aw-btn-primary">
            {searching ? '…' : '🔍 Search'}
          </button>
          {state.phase !== 'idle' && (
            <button type="button" onClick={reset} className="aw-btn aw-btn-gray">✕ Clear</button>
          )}
        </form>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', gap: 16 }}>

        {/* IDLE — hint */}
        {state.phase === 'idle' && (
          <div style={{ color: '#93c5fd', fontSize: 13, marginTop: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✻</div>
            Search by invoice # to log a delivery
          </div>
        )}

        {/* FOUND — show record, confirm log */}
        {state.phase === 'found' && (
          <div className="result-card" style={{ width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: blueD }}>Invoice Found</span>
              {state.row.logged && (
                <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 10px' }}>
                  ✓ Already logged by {state.row.logged_by}
                </span>
              )}
            </div>
            <InfoRow label="Invoice #" value={state.row.invoice_no} />
            <InfoRow label="Brand"     value={state.row.brand} />
            <InfoRow label="PO #"      value={state.row.po_no} />
            <InfoRow label="Qty"       value={state.row.qty} />
            {state.row.note && <InfoRow label="Note"  value={state.row.note} />}

            {!state.row.logged && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={labelSt}>Note:</label>
                  <input value={logNote} onChange={e => setLogNote(e.target.value)}
                    placeholder="optional…" style={{ ...inputSt, flex: 1 }} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={reset} className="aw-btn aw-btn-gray">Cancel</button>
                  <button onClick={() => logRow(state.row)} disabled={logging} className="aw-btn aw-btn-primary">
                    {logging ? '…' : '✓ Log Invoice'}
                  </button>
                </div>
              </div>
            )}
            {state.row.logged && (
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <button onClick={reset} className="aw-btn aw-btn-gray">← Back</button>
              </div>
            )}
          </div>
        )}

        {/* NOT FOUND — three options */}
        {state.phase === 'notfound' && (
          <div className="result-card" style={{ width: '100%', maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#dc2626', marginBottom: 6 }}>
              Invoice not found: <span style={{ fontFamily: 'monospace' }}>{state.invoice}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              This invoice isn't in the system for store <strong>{user?.store}</strong>. What would you like to do?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => { setState({ phase: 'idle' }); setQuery(''); setTimeout(() => inputRef.current?.focus(), 50) }}
                className="aw-btn aw-btn-outline" style={{ textAlign: 'left', padding: '10px 14px' }}>
                🔄 Try another invoice #
              </button>
              <button onClick={() => { setBrandQuery(''); setState({ phase: 'brand', results: [] }) }}
                className="aw-btn aw-btn-outline" style={{ textAlign: 'left', padding: '10px 14px' }}>
                🏷 Search by brand instead
              </button>
              <button onClick={() => setState({ phase: 'create', invoice: state.invoice })}
                className="aw-btn aw-btn-amber" style={{ textAlign: 'left', padding: '10px 14px' }}>
                ⚑ Create log request — items on floor, not in system
              </button>
            </div>
          </div>
        )}

        {/* BRAND SEARCH */}
        {state.phase === 'brand' && (
          <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <form onSubmit={handleBrandSearch}
              style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={labelSt}>Brand:</label>
              <input value={brandQuery} onChange={e => setBrandQuery(e.target.value)}
                placeholder="e.g. Autumn Cashmere…" style={{ ...inputSt, flex: 1 }} autoFocus />
              <button type="submit" disabled={!brandQuery.trim() || searching} className="aw-btn aw-btn-primary">
                {searching ? '…' : '🔍 Search'}
              </button>
            </form>

            {state.results.length === 0 && brandQuery && !searching && (
              <div style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 8, padding: 16, color: '#6b7280', fontSize: 13 }}>
                No unlogged invoices found for "{brandQuery}" at store {user?.store}.
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button onClick={() => setState({ phase: 'create', invoice: query })} className="aw-btn aw-btn-amber">⚑ Create log request</button>
                  <button onClick={reset} className="aw-btn aw-btn-gray">← Back</button>
                </div>
              </div>
            )}

            {state.results.length > 0 && (
              <div className="result-card">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 10 }}>
                  {state.results.length} unlogged invoice{state.results.length !== 1 ? 's' : ''} found
                </div>
                {state.results.map(row => (
                  <div key={row.id} className="brand-row" onClick={() => { setState({ phase: 'found', row }); setQuery(row.invoice_no) }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: blueD }}>{row.brand}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Invoice: {row.invoice_no}{row.po_no ? ` · PO: ${row.po_no}` : ''}{row.qty ? ` · Qty: ${row.qty}` : ''}</div>
                    </div>
                    <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700 }}>Select →</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={reset} className="aw-btn aw-btn-gray" style={{ alignSelf: 'flex-start' }}>← Back</button>
          </div>
        )}

        {/* CREATE LOG REQUEST */}
        {state.phase === 'create' && (
          <div className="result-card" style={{ width: '100%', maxWidth: 520, borderColor: amber, background: amberL }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: amber, marginBottom: 4 }}>⚑ Create Log Request</div>
            <div style={{ fontSize: 12, color: '#92400e', marginBottom: 14 }}>
              Invoice <strong>{state.invoice}</strong> wasn't found. This will be flagged for admin review.
            </div>
            <form onSubmit={submitCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>Brand:</label>
                <input value={crBrand} onChange={e => setCrBrand(e.target.value)}
                  placeholder="Brand name if known…" style={{ ...inputSt, flex: 1 }} autoFocus />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>PO #:</label>
                <input value={crPO} onChange={e => setCrPO(e.target.value)}
                  placeholder="optional…" style={{ ...inputSt, flex: 1 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>Qty:</label>
                <input value={crQty} onChange={e => setCrQty(e.target.value)}
                  placeholder="optional…" type="number" min="0" style={{ ...inputSt, width: 80 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelSt, minWidth: 64 }}>Note:</label>
                <input value={crNote} onChange={e => setCrNote(e.target.value)}
                  style={{ ...inputSt, flex: 1, fontWeight: 700, color: '#92400e' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={reset} className="aw-btn aw-btn-gray">Cancel</button>
                <button type="submit" disabled={submitting} className="aw-btn aw-btn-amber">
                  {submitting ? '…' : '⚑ Submit Request'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#1e3a8a', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

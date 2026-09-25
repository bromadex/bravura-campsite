import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { FIN, finCard, finBtn, finInput, money, useFinanceFonts } from '../../utils/financeTheme'

// Supplier order confirmation (issue #54) — public page, no T-code (not an in-app screen). Opened by a supplier from a link Bravura sends
// (/ack/<token>); no login. The supplier sees only this order, confirms it and gives delivery dates.
export default function SupplierConfirm({ token }) {
  useFinanceFonts()
  const [po, setPo] = useState(null)
  const [err, setErr] = useState(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [dates, setDates] = useState({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    supabase.rpc('proc_po_ack_get', { p_token: token }).then(({ data, error }) => {
      if (error) return setErr('This link could not be opened. Please ask Bravura for a new one.')
      if (data?.error) return setErr(data.error)
      setPo(data)
      setDates(Object.fromEntries((data.lines || []).map(l => [l.id, l.promised_date || data.expected_date || ''])))
    })
  }, [token])

  async function submit() {
    if (!name.trim()) return setErr('Please give your name so Bravura knows who confirmed.')
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('proc_po_ack_submit', { p_token: token, p_name: name, p_note: note,
      p_dates: Object.entries(dates).map(([line_id, date]) => ({ line_id, date })) })
    setBusy(false)
    if (error) return setErr(error.message)
    setDone(data)
  }

  const page = { minHeight: '100dvh', background: FIN.ground, fontFamily: FIN.sans, color: FIN.ink, padding: '24px 16px', boxSizing: 'border-box' }
  const wrap = { maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }
  const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  return (
    <main style={page}>
      <div style={wrap}>
        <header>
          <div style={{ fontSize: 13, color: FIN.maroon, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>Bravura Zimbabwe · Purchase order</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 28 }}>{po ? po.po_number : 'Order confirmation'}</h1>
          {po && <div style={{ fontSize: 14, color: FIN.muted, marginTop: 4 }}>For {po.supplier} · deliver to {po.delivery_address || po.site}</div>}
        </header>

        {err && <div role="alert" style={{ ...finCard, color: FIN.bad, borderColor: '#E8B4B0' }}>{err}</div>}

        {done ? (
          <section style={{ ...finCard, borderColor: '#BFDCCB', background: FIN.goodTint }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Thank you — order confirmed</h2>
            <p style={{ margin: '8px 0 0', fontSize: 14 }}>Bravura has been told{done.delivery_by ? ` you will deliver by ${fmt(done.delivery_by)}` : ''}. If anything changes, open this link again and update the dates.</p>
          </section>
        ) : po && (
          <>
            {po.acknowledged_at && <div style={{ ...finCard, background: FIN.blueTint, borderColor: '#C9D7EA', fontSize: 14 }}>
              Already confirmed by {po.ack_by_name} on {fmt(po.acknowledged_at)}. You can update the delivery dates below.
            </div>}
            <section style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ textAlign: 'left', color: FIN.muted, fontSize: 12 }}>
                  <th style={{ padding: '10px 12px' }}>Item</th><th style={{ padding: '10px 12px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Price</th><th style={{ padding: '10px 12px' }}>You'll deliver by</th>
                </tr></thead>
                <tbody>{po.lines.map(l => (
                  <tr key={l.id} style={{ borderTop: `1px solid ${FIN.lineSoft}` }}>
                    <td style={{ padding: '10px 12px' }}>{l.what}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{Number(l.quantity)} {l.unit || ''}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${money(l.unit_cost)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <input type="date" aria-label={`Delivery date for ${l.what}`} value={dates[l.id] || ''} onChange={e => setDates({ ...dates, [l.id]: e.target.value })} style={finInput} />
                    </td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={2} style={{ padding: '10px 12px', fontWeight: 600 }}>Order total (USD)</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>${money(po.total)}</td><td /></tr></tfoot>
              </table>
            </section>
            {po.notes && <div style={{ fontSize: 14, color: FIN.muted }}>Note from Bravura: {po.notes}</div>}
            <section style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 13, color: FIN.muted }}>Your name
                <input id="ack-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" style={{ ...finInput, width: '100%', marginTop: 4 }} /></label>
              <label style={{ fontSize: 13, color: FIN.muted }}>Anything Bravura should know (optional)
                <textarea id="ack-note" rows={2} value={note} onChange={e => setNote(e.target.value)} style={{ ...finInput, width: '100%', marginTop: 4, resize: 'vertical' }} /></label>
              <button style={{ ...finBtn, minHeight: 50, fontSize: 16 }} disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Confirm this order'}</button>
            </section>
          </>
        )}
        {!po && !err && <div style={{ color: FIN.faint }}>Loading…</div>}
      </div>
    </main>
  )
}

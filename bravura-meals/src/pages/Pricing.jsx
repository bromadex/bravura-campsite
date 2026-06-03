import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, Button, showToast, fmtDate } from '../components/ui'

export default function Pricing() {
  const { profile } = useAuth()
  const [prices,  setPrices]  = useState([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState({ effective_date: '', breakfast_usd: '', lunch_usd: '', supper_usd: '', notes: '' })
  const [saving,  setSaving]  = useState(false)

  useEffect(() => { fetchPrices() }, [])

  async function fetchPrices() {
    setLoading(true)
    const { data } = await supabase
      .from('meal_prices')
      .select('*, set_by_profile:profiles(full_name, username)')
      .order('effective_date', { ascending: false })
      .limit(20)
    setPrices(data || [])
    setLoading(false)

    // Pre-fill form with latest prices
    if (data && data.length > 0) {
      const latest = data[0]
      setForm(f => ({
        ...f,
        breakfast_usd: latest.breakfast_usd,
        lunch_usd:     latest.lunch_usd,
        supper_usd:    latest.supper_usd,
      }))
    }
    // Default effective date to today
    setForm(f => ({ ...f, effective_date: f.effective_date || new Date().toISOString().slice(0,10) }))
  }

  async function savePrices() {
    if (!form.effective_date) { showToast('Please set an effective date', 'red'); return }
    const b = parseFloat(form.breakfast_usd)
    const l = parseFloat(form.lunch_usd)
    const s = parseFloat(form.supper_usd)
    if (isNaN(b) || isNaN(l) || isNaN(s)) { showToast('Please enter valid prices', 'red'); return }
    if (b < 0 || l < 0 || s < 0) { showToast('Prices cannot be negative', 'red'); return }

    setSaving(true)
    const { error } = await supabase
      .from('meal_prices')
      .insert({
        effective_date: form.effective_date,
        breakfast_usd:  b,
        lunch_usd:      l,
        supper_usd:     s,
        notes:          form.notes.trim(),
        set_by:         profile.id,
      })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Prices saved ✓', 'green')
    setForm(f => ({ ...f, notes: '', effective_date: new Date().toISOString().slice(0,10) }))
    fetchPrices()
  }

  const current = prices[0]

  return (
    <div style={{ maxWidth: '720px' }}>
      {/* Current prices */}
      {current && (
        <Card style={{ marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '12px' }}>
            Current Prices (effective {fmtDate(current.effective_date)})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {[
              { label: '🌅 Breakfast', v: current.breakfast_usd, c: '#C55A11' },
              { label: '☀️ Lunch',     v: current.lunch_usd,     c: '#00897B' },
              { label: '🌙 Supper',    v: current.supper_usd,    c: '#5E35B1' },
            ].map(x => (
              <div key={x.label} style={{ textAlign: 'center', background: '#f4f6f9', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: x.c }}>
                  ${Number(x.v).toFixed(2)}
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{x.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>
            Set by: {current.set_by_profile?.full_name || current.set_by_profile?.username || '—'}
            {current.notes && <span> · {current.notes}</span>}
          </div>
        </Card>
      )}

      {/* Set new prices */}
      <Card style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '16px' }}>
          Set New Prices
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Effective Date
            </label>
            <input
              type="date"
              value={form.effective_date}
              onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Notes (optional)
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Q3 rate review"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
          {[
            { key: 'breakfast_usd', label: '🌅 Breakfast (USD)', color: '#C55A11' },
            { key: 'lunch_usd',     label: '☀️ Lunch (USD)',     color: '#00897B' },
            { key: 'supper_usd',    label: '🌙 Supper (USD)',    color: '#5E35B1' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {f.label}
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#888', fontSize: '13px' }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{
                    width: '100%', padding: '8px 12px 8px 22px', border: `1px solid #dde2ea`,
                    borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit',
                    fontWeight: 700, color: f.color, boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <Button onClick={savePrices} variant="primary" disabled={saving}>
          {saving ? 'Saving…' : '💾 Save new prices'}
        </Button>
      </Card>

      {/* Price history */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '12px' }}>
          Price History
        </div>
        {loading ? (
          <div style={{ color: '#888' }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#1F3864', color: '#fff' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Effective From</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Breakfast</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Lunch</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Supper</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Set by</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #eee', background: i === 0 ? '#E2EFDA' : '#fff' }}>
                    <td style={{ padding: '8px 12px', fontWeight: i === 0 ? 700 : 400 }}>
                      {fmtDate(p.effective_date)}
                      {i === 0 && <span style={{ marginLeft: '6px', fontSize: '10px', background: '#375623', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>CURRENT</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#C55A11', fontWeight: 700 }}>${Number(p.breakfast_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#00897B', fontWeight: 700 }}>${Number(p.lunch_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#5E35B1', fontWeight: 700 }}>${Number(p.supper_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{p.set_by_profile?.full_name || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

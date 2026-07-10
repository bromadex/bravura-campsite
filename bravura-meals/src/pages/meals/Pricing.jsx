import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Icon, SectionLabel, showToast, fmtDate, PageHeader } from '../../components/ui'

export default function Pricing() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const [prices,  setPrices]  = useState([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState({ effective_date: '', breakfast_usd: '', lunch_usd: '', supper_usd: '', notes: '' })
  const [saving,  setSaving]  = useState(false)

  // Saturday Supper special pricing (day_of_week=6, meal_type='supper')
  const [satOverride, setSatOverride] = useState(null)
  const [satForm,     setSatForm]     = useState({ price_usd: '', label: 'Saturday Special Supper', notes: '' })
  const [satSaving,   setSatSaving]   = useState(false)

  // Re-fetched whenever the selected site changes — meal_prices has had
  // site_id since the original migration, but this page never actually
  // filtered by it. Found while building site-specific meal providers,
  // fixed in the same pass since the two are directly related — a
  // different caterer very plausibly means different agreed rates too.
  useEffect(() => { if (currentSiteId) { fetchPrices(); fetchSatOverride() } }, [currentSiteId])

  async function fetchSatOverride() {
    const { data } = await supabase
      .from('meal_price_overrides')
      .select('*, set_by_profile:profiles(full_name, username)')
      .eq('site_id', currentSiteId)
      .eq('day_of_week', 6)
      .eq('meal_type', 'supper')
      .eq('is_active', true)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      setSatOverride(data)
      setSatForm({
        price_usd: data.price_usd,
        label: data.label || 'Saturday Special Supper',
        notes: data.notes || '',
      })
    } else {
      // Site switch to a site with no override — clear the previous site's values
      setSatOverride(null)
      setSatForm({ price_usd: '', label: 'Saturday Special Supper', notes: '' })
    }
  }

  async function saveSatOverride() {
    const price = parseFloat(satForm.price_usd)
    if (isNaN(price) || price < 0) { showToast('Enter a valid price', 'red'); return }
    setSatSaving(true)
    const { error } = await supabase.from('meal_price_overrides').insert({
      site_id: currentSiteId,
      day_of_week: 6,
      meal_type: 'supper',
      price_usd: price,
      label: satForm.label.trim() || 'Saturday Special Supper',
      notes: satForm.notes.trim() || null,
      set_by: profile.id,
      effective_date: new Date().toISOString().slice(0, 10),
    })
    setSatSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Saturday supper price saved', 'green')
    fetchSatOverride()
  }

  async function fetchPrices() {
    setLoading(true)
    const { data } = await supabase
      .from('meal_prices')
      .select('*, set_by_profile:profiles(full_name, username)')
      .eq('site_id', currentSiteId)
      .order('effective_date', { ascending: false })
      .limit(20)
    setPrices(data || [])
    setLoading(false)

    // Pre-fill form with latest prices for this site
    if (data && data.length > 0) {
      const latest = data[0]
      setForm(f => ({
        ...f,
        breakfast_usd: latest.breakfast_usd,
        lunch_usd:     latest.lunch_usd,
        supper_usd:    latest.supper_usd,
      }))
    } else {
      setForm(f => ({ ...f, breakfast_usd: '', lunch_usd: '', supper_usd: '' }))
    }
    setForm(f => ({ ...f, effective_date: new Date().toISOString().slice(0,10) }))
  }

  async function savePrices() {
    if (!form.effective_date) { showToast('Please set an effective date', 'red'); return }
    const b = parseFloat(form.breakfast_usd)
    const l = parseFloat(form.lunch_usd)
    const s = parseFloat(form.supper_usd)
    if (isNaN(b) || isNaN(l) || isNaN(s)) { showToast('Please enter valid prices', 'red'); return }
    if (b < 0 || l < 0 || s < 0) { showToast('Prices cannot be negative', 'red'); return }

    setSaving(true)
    // Stamped with the currently selected site — same fix already applied
    // everywhere else a new record gets created in this project.
    const { error } = await supabase
      .from('meal_prices')
      .insert({
        site_id:        currentSiteId,
        effective_date: form.effective_date,
        breakfast_usd:  b,
        lunch_usd:      l,
        supper_usd:     s,
        notes:          form.notes.trim(),
        set_by:         profile.id,
      })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Prices saved', 'green')
    setForm(f => ({ ...f, notes: '', effective_date: new Date().toISOString().slice(0,10) }))
    fetchPrices()
  }

  const current = prices[0]

  return (
    <div style={{ maxWidth: '720px' }}>
      <PageHeader title="Pricing Management" site={currentSite} />

      {/* Current prices */}
      {current ? (
        <Card style={{ marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '12px' }}>
            Current Prices (effective {fmtDate(current.effective_date)})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {[
              { label: 'Breakfast', icon: 'wb_sunny',   v: current.breakfast_usd, c: THEME.breakfastClr },
              { label: 'Lunch',     icon: 'light_mode', v: current.lunch_usd,     c: THEME.lunchClr },
              { label: 'Supper',    icon: 'bedtime',    v: current.supper_usd,    c: THEME.supperClr },
            ].map(x => (
              <div key={x.label} style={{ textAlign: 'center', background: THEME.surfaceVar, borderRadius: '10px', padding: '16px' }}>
                <Icon name={x.icon} size={16} style={{ color: x.c }} />
                <div style={{ fontSize: '24px', fontWeight: 700, color: x.c, marginTop: '4px' }}>
                  ${Number(x.v).toFixed(2)}
                </div>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>{x.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '10px' }}>
            Set by: {current.set_by_profile?.full_name || current.set_by_profile?.username || '—'}
            {current.notes && <span> · {current.notes}</span>}
          </div>
        </Card>
      ) : !loading && (
        <Card style={{ marginBottom: '20px' }}>
          <div style={{ textAlign: 'center', padding: '20px', color: THEME.textLow }}>
            <Icon name="sell" size={28} style={{ color: THEME.outline, display: 'block', margin: '0 auto 8px' }} />
            No prices set yet for {currentSite?.name || 'this site'}.
          </div>
        </Card>
      )}

      {/* Saturday Supper Special */}
      <Card style={{ marginBottom: '20px', border: `1px solid ${THEME.supperClr}55`, background: THEME.supperClr + '08' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <Icon name="celebration" size={20} style={{ color: THEME.supperClr }} />
          <div style={{ fontWeight: 700, fontSize: '15px', color: THEME.text }}>Saturday Supper — Special Meal</div>
        </div>
        <div style={{ fontSize: '13px', color: THEME.textLow, marginBottom: '14px' }}>
          Applied automatically on Saturdays instead of the regular supper price.
          {satOverride && <>{' '}Currently: <strong style={{ color: THEME.supperClr }}>${Number(satOverride.price_usd).toFixed(2)}</strong>{satOverride.label && <> — {satOverride.label}</>}</>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Special Price (USD)</SectionLabel>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow, fontSize: '13px' }}>$</span>
              <input
                type="number" min="0" step="0.01"
                value={satForm.price_usd}
                onChange={e => setSatForm(f => ({ ...f, price_usd: e.target.value }))}
                style={{
                  width: '100%', padding: '9px 12px 9px 22px', border: `1px solid ${THEME.outline}`,
                  borderRadius: '10px', fontSize: '14px', fontFamily: 'inherit', fontWeight: 700,
                  color: THEME.supperClr, boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
          </div>
          <div>
            <SectionLabel>Label</SectionLabel>
            <input
              type="text"
              value={satForm.label}
              onChange={e => setSatForm(f => ({ ...f, label: e.target.value }))}
              placeholder="Saturday Special Supper"
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div>
            <SectionLabel>Notes (optional)</SectionLabel>
            <input
              type="text"
              value={satForm.notes}
              onChange={e => setSatForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. braai menu"
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
        </div>
        <Button onClick={saveSatOverride} variant="filled" icon="save" disabled={satSaving}>
          {satSaving ? 'Saving…' : 'Save Saturday supper price'}
        </Button>
      </Card>

      {/* Set new prices */}
      <Card style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '16px', color: THEME.text }}>
          Set New Prices — {currentSite?.name || 'this site'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Effective Date</SectionLabel>
            <input
              type="date"
              value={form.effective_date}
              onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div>
            <SectionLabel>Notes (optional)</SectionLabel>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Q3 rate review"
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
          {[
            { key: 'breakfast_usd', label: 'Breakfast (USD)', icon: 'wb_sunny',   color: THEME.breakfastClr },
            { key: 'lunch_usd',     label: 'Lunch (USD)',     icon: 'light_mode', color: THEME.lunchClr },
            { key: 'supper_usd',    label: 'Supper (USD)',    icon: 'bedtime',    color: THEME.supperClr },
          ].map(f => (
            <div key={f.key}>
              <SectionLabel>{f.label}</SectionLabel>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow, fontSize: '13px' }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{
                    width: '100%', padding: '9px 12px 9px 22px', border: `1px solid ${THEME.outline}`,
                    borderRadius: '10px', fontSize: '14px', fontFamily: 'inherit',
                    fontWeight: 700, color: f.color, boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <Button onClick={savePrices} variant="filled" icon="save" disabled={saving}>
          {saving ? 'Saving…' : 'Save new prices'}
        </Button>
      </Card>

      {/* Price history */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '12px' }}>
          Price History — {currentSite?.name || 'this site'}
        </div>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>
            <Icon name="progress_activity" size={20} style={{ color: THEME.primary }} />
          </div>
        ) : prices.length === 0 ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>No price history yet for this site.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.primary, color: '#fff' }}>
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
                  <tr key={p.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: i === 0 ? THEME.surfaceVar : '#fff' }}>
                    <td style={{ padding: '8px 12px', fontWeight: i === 0 ? 700 : 400, color: THEME.text }}>
                      {fmtDate(p.effective_date)}
                      {i === 0 && <span style={{ marginLeft: '6px', fontSize: '10px', background: THEME.primary, color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>CURRENT</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: THEME.breakfastClr, fontWeight: 700 }}>${Number(p.breakfast_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: THEME.lunchClr, fontWeight: 700 }}>${Number(p.lunch_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: THEME.supperClr, fontWeight: 700 }}>${Number(p.supper_usd).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', color: THEME.textLow }}>{p.set_by_profile?.full_name || '—'}</td>
                    <td style={{ padding: '8px 12px', color: THEME.textLow }}>{p.notes || '—'}</td>
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

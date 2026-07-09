import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const TABS = [
  { id: 'overview',     label: 'Overview',         icon: 'info' },
  { id: 'pumps',        label: 'Pumps',            icon: 'local_gas_station' },
  { id: 'transactions', label: 'Transactions',     icon: 'receipt_long' },
  { id: 'dips',         label: 'Dip Readings',     icon: 'straighten' },
  { id: 'recon',        label: 'Reconciliations',  icon: 'compare_arrows' },
]

export default function TankDetail() {
  const { tankId } = useParams()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const {
    tanks, pumps, transactions, dipReadings,
    tankBalance, latestDip, loading,
  } = useFuel()

  const canEdit = can('fuel.edit')
  const [tab, setTab] = useState('overview')

  if (loading) return null
  const tank = tanks.find(t => t.id === tankId)
  if (!tank) {
    return (
      <div style={{ padding: '20px', maxWidth: '900px' }}>
        <PageHeader title="Tank Not Found" site={currentSite}
          actions={<Button variant="text" onClick={() => navigate('/fuel/fuel_tanks')} icon="arrow_back">Back to Tanks</Button>}
        />
        <Card>
          <div style={{ padding: '40px 20px', textAlign: 'center', color: THEME.textLow }}>
            That tank doesn't exist at this site, or it has been decommissioned.
          </div>
        </Card>
      </div>
    )
  }

  const capacity = Number(tank.capacity_litres) || 0
  const balance  = tankBalance(tank.id)
  const pct      = capacity ? Math.min(100, Math.max(0, (balance / capacity) * 100)) : 0
  const levelClr = pct > 50 ? THEME.success : pct >= 20 ? THEME.warning : THEME.error
  const ftName   = tank.fuel_types?.name   || 'Unknown'
  const ftColor  = tank.fuel_types?.colour || FUEL_CLR

  const tankTxns = useMemo(
    () => transactions.filter(t => t.tank_id === tank.id).slice(0, 50),
    [transactions, tank.id]
  )
  const tankDips = useMemo(
    () => dipReadings.filter(d => d.tank_id === tank.id),
    [dipReadings, tank.id]
  )
  const tankPumps = useMemo(
    () => pumps.filter(p => p.tank_id === tank.id),
    [pumps, tank.id]
  )

  const dip = latestDip(tank.id)
  const variance = dip ? balance - Number(dip.level_litres) : null

  return (
    <div style={{ padding: '20px', maxWidth: '1100px' }}>
      <PageHeader
        title={tank.name}
        site={currentSite}
        actions={
          <Button variant="text" onClick={() => navigate('/fuel/fuel_tanks')} icon="arrow_back">
            Back to Tanks
          </Button>
        }
      />

      {/* ── Hero card ─────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Identity */}
          <div style={{ flex: '1 1 240px', minWidth: '220px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <Pill color={ftColor}>{ftName}</Pill>
              <StatusPill status={tank.status} />
              <Pill subtle>{(tank.tank_type || '').replace('_', ' ')}</Pill>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textLow }}>
              {tank.code}
            </div>
            {tank.location_description && (
              <div style={{ marginTop: '6px', fontSize: '12px', color: THEME.textMed, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Icon name="location_on" size={13} /> {tank.location_description}
              </div>
            )}
          </div>

          {/* Level */}
          <div style={{ flex: '2 1 380px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
              <span style={{ fontSize: '34px', fontWeight: 600, color: levelClr, letterSpacing: '-0.01em' }}>
                {pct.toFixed(0)}%
              </span>
              <span style={{ fontSize: '14px', color: THEME.textMed }}>
                <strong style={{ color: THEME.text }}>{balance.toFixed(1)} L</strong>
                {' '}of {capacity.toLocaleString()} L
              </span>
            </div>
            <div style={{ height: '14px', borderRadius: '999px', background: THEME.surfaceVar, overflow: 'hidden', position: 'relative' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: levelClr, transition: 'width .25s' }} />
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${Number(tank.min_threshold_percent) || 20}%`, width: '2px', background: THEME.outline,
              }} />
            </div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: THEME.textLow }}>
              Threshold marker at {Number(tank.min_threshold_percent) || 20}%
            </div>
          </div>
        </div>
      </Card>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '18px', background: THEME.surfaceVar, borderRadius: '12px', padding: '4px', width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 500,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
              background: tab === t.id ? THEME.surface : 'transparent',
              color:      tab === t.id ? FUEL_CLR     : THEME.textMed,
              boxShadow:  tab === t.id ? THEME.shadow1 : 'none',
            }}
          >
            <Icon name={t.icon} size={14} style={{ color: 'inherit' }} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview'     && <OverviewTab tank={tank} balance={balance} dip={dip} variance={variance} />}
      {tab === 'pumps'        && <PumpsTab tank={tank} pumps={tankPumps} canEdit={canEdit} />}
      {tab === 'transactions' && <TransactionsTab txns={tankTxns} />}
      {tab === 'dips'         && <DipsTab dips={tankDips} balance={balance} />}
      {tab === 'recon'        && (
        <Card>
          <div style={{ padding: '40px 20px', textAlign: 'center', color: THEME.textLow }}>
            <Icon name="compare_arrows" size={36} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>Reconciliation available in Fuel Phase 2.</p>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────────────────────

function OverviewTab({ tank, balance, dip, variance }) {
  const rows = [
    { label: 'Capacity',          value: `${Number(tank.capacity_litres || 0).toLocaleString()} L` },
    { label: 'Current Level',     value: `${balance.toFixed(1)} L` },
    { label: 'Min Threshold',     value: `${Number(tank.min_threshold_percent) || 20}% (${Number(tank.min_threshold_litres || 0).toFixed(1)} L)` },
    { label: 'Tank Type',         value: (tank.tank_type || '').replace('_', ' ') },
    { label: 'Location',          value: tank.location_description || '—' },
    { label: 'GPS',               value: tank.gps_lat != null && tank.gps_lng != null ? `${tank.gps_lat}, ${tank.gps_lng}` : '—' },
    { label: 'ATG Device ID',     value: tank.atg_device_id || '—' },
    { label: 'Last Dip Date',     value: dip ? fmtDate(dip.reading_date) : '— no dip recorded' },
    { label: 'Last Dip Reading',  value: dip ? `${Number(dip.level_litres).toFixed(1)} L` : '—' },
    {
      label: 'Current Variance',
      value: variance == null
        ? '— no dip to compare'
        : `${variance > 0 ? '+' : ''}${variance.toFixed(1)} L`,
      hint: variance == null
        ? null
        : Math.abs(variance) > 50 ? 'High — investigate' : Math.abs(variance) > 10 ? 'Moderate' : 'Within tolerance',
      hintColor: variance == null ? null
        : Math.abs(variance) > 50 ? THEME.error : Math.abs(variance) > 10 ? THEME.warning : THEME.success,
    },
  ]

  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
        {rows.map(r => (
          <div key={r.label} style={{ padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '4px' }}>
              {r.label}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text, textTransform: r.label === 'Tank Type' ? 'capitalize' : 'none' }}>
              {r.value}
            </div>
            {r.hint && (
              <div style={{ fontSize: '11px', color: r.hintColor, marginTop: '2px', fontWeight: 500 }}>
                {r.hint}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Pumps ──────────────────────────────────────────────────────────────────────

const BLANK_PUMP = { name: '', code: '', current_meter_reading: '0', status: 'active' }

function PumpsTab({ tank, pumps, canEdit }) {
  const { addPump, updatePump, archivePump } = useFuel()
  const [modal,    setModal]    = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form,     setForm]     = useState(BLANK_PUMP)
  const [saving,   setSaving]   = useState(false)
  const [removing, setRemoving] = useState(null)

  function openAdd() {
    setEditItem(null); setForm(BLANK_PUMP); setModal(true)
  }
  function openEdit(p) {
    setEditItem(p)
    setForm({
      name:                  p.name,
      code:                  p.code || '',
      current_meter_reading: String(p.current_meter_reading ?? '0'),
      status:                p.status,
    })
    setModal(true)
  }
  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.name.trim()) { showToast('Enter a pump name', 'red'); return }
    setSaving(true)
    try {
      const data = {
        tank_id: tank.id,
        name:    form.name.trim(),
        code:    form.code.trim() || null,
        current_meter_reading: Number(form.current_meter_reading) || 0,
        status:  form.status,
      }
      if (editItem) {
        await updatePump(editItem.id, data)
        showToast('Pump updated', 'green')
      } else {
        await addPump(data)
        showToast('Pump added', 'green')
      }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmRemove() {
    try {
      await archivePump(removing.id)
      showToast('Pump decommissioned', 'green')
    } catch (err) {
      showToast(err.message || 'Failed', 'red')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: pumps.length ? `1px solid ${THEME.outlineVar}` : 'none' }}>
        <span style={{ fontSize: '13px', color: THEME.textMed }}>
          {pumps.length} pump{pumps.length === 1 ? '' : 's'} linked to this tank
        </span>
        {canEdit && <Button onClick={openAdd} icon="add" size="sm">Add Pump</Button>}
      </div>

      {pumps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: THEME.textLow }}>
          <Icon name="local_gas_station" size={36} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
          <p style={{ fontSize: '13px', margin: 0 }}>No pumps configured for this tank.</p>
        </div>
      ) : (
        <TableWrap>
          <THead color={FUEL_CLR}>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th align="right">Meter Reading</Th>
            <Th>Status</Th>
            {canEdit && <Th />}
          </THead>
          <tbody>
            {pumps.map((p, idx) => (
              <TRow key={p.id} last={idx === pumps.length - 1} onClick={canEdit ? () => openEdit(p) : undefined}>
                <Td><span style={{ fontWeight: 500 }}>{p.name}</span></Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textMed }}>{p.code || '—'}</Td>
                <Td align="right" style={{ fontWeight: 500 }}>{Number(p.current_meter_reading || 0).toFixed(1)}</Td>
                <Td><StatusPill status={p.status} /></Td>
                {canEdit && (
                  <Td>
                    {p.status !== 'decommissioned' && (
                      <button onClick={e => { e.stopPropagation(); setRemoving(p) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', opacity: .6 }}
                        title="Decommission pump">
                        <Icon name="archive" size={16} style={{ color: THEME.error }} />
                      </button>
                    )}
                  </Td>
                )}
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Pump' : 'Add Pump'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Add Pump'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Pump Name *</SectionLabel>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Pump A" style={inputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Code</SectionLabel>
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="optional" style={inputStyle} />
          </div>
        </div>
        <div>
          <SectionLabel>Current Meter Reading</SectionLabel>
          <input
            type="number" min="0" step="0.1"
            value={form.current_meter_reading}
            onChange={e => set('current_meter_reading', e.target.value)}
            style={inputStyle}
          />
        </div>
        {editItem && (
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title="Decommission Pump"
        message={removing ? `Decommission "${removing.name}"? Historical transactions are preserved.` : ''}
      />
    </Card>
  )
}

// ── Transactions ───────────────────────────────────────────────────────────────

function TransactionsTab({ txns }) {
  if (!txns.length) {
    return (
      <Card>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="receipt_long" size={36} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
          <p style={{ fontSize: '13px', margin: 0 }}>No transactions recorded against this tank yet.</p>
        </div>
      </Card>
    )
  }
  return (
    <Card style={{ padding: 0 }}>
      <TableWrap>
        <THead color={FUEL_CLR}>
          <Th>Date</Th>
          <Th>Type</Th>
          <Th align="right">Litres</Th>
          <Th>Vehicle / Equipment</Th>
          <Th>Operator</Th>
          <Th align="right">Before</Th>
          <Th align="right">After</Th>
          <Th>Docket</Th>
        </THead>
        <tbody>
          {txns.map((t, idx) => {
            const typeStyle =
              t.transaction_type === 'issuance'   ? { bg: THEME.statusErrorBg,   fg: THEME.statusErrorText,   label: 'Issuance' }   :
              t.transaction_type === 'delivery'   ? { bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText, label: 'Delivery' }   :
              t.transaction_type === 'adjustment' ? { bg: THEME.statusWarningBg, fg: THEME.statusWarningText, label: 'Adjustment' } :
                                                    { bg: THEME.statusNeutralBg, fg: THEME.statusNeutralText, label: t.transaction_type }
            const asset = t.fleet_asset?.fleet_number || t.fleet_asset?.asset_number || t.fleet_asset?.description || t.asset_description || '—'
            const assetSub = t.fleet_asset?.registration || t.fleet_asset?.serial_number || ''
            return (
              <TRow key={t.id} last={idx === txns.length - 1}>
                <Td>{fmtDate(t.transaction_date)}</Td>
                <Td>
                  <span style={{
                    padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                    background: typeStyle.bg, color: typeStyle.fg,
                  }}>
                    {typeStyle.label}
                  </span>
                </Td>
                <Td align="right" style={{ fontWeight: 600, color: t.transaction_type === 'issuance' ? THEME.error : t.transaction_type === 'delivery' ? THEME.success : THEME.warning }}>
                  {t.transaction_type === 'issuance' ? '−' : t.transaction_type === 'delivery' ? '+' : ''}
                  {Number(t.litres).toFixed(1)}
                </Td>
                <Td>
                  <div style={{ fontSize: '13px', color: THEME.text }}>{asset}</div>
                  {assetSub && <div style={{ fontSize: '11px', color: THEME.textLow }}>{assetSub}</div>}
                </Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{t.operator_id ? '—' : '—'}</Td>
                <Td align="right" style={{ color: THEME.textMed }}>
                  {t.tank_level_before != null ? Number(t.tank_level_before).toFixed(1) : '—'}
                </Td>
                <Td align="right" style={{ color: THEME.textMed }}>
                  {t.tank_level_after != null ? Number(t.tank_level_after).toFixed(1) : '—'}
                </Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textMed }}>
                  {t.docket_number || '—'}
                </Td>
              </TRow>
            )
          })}
        </tbody>
      </TableWrap>
    </Card>
  )
}

// ── Dips ───────────────────────────────────────────────────────────────────────

function DipsTab({ dips }) {
  if (!dips.length) {
    return (
      <Card>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="straighten" size={36} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
          <p style={{ fontSize: '13px', margin: 0 }}>No dip readings recorded for this tank yet.</p>
        </div>
      </Card>
    )
  }
  return (
    <Card style={{ padding: 0 }}>
      <TableWrap>
        <THead color={FUEL_CLR}>
          <Th>Date</Th>
          <Th align="right">Reading (L)</Th>
          <Th>Recorded By</Th>
          <Th>Notes</Th>
        </THead>
        <tbody>
          {dips.map((d, idx) => (
            <TRow key={d.id} last={idx === dips.length - 1}>
              <Td>{fmtDate(d.reading_date)}</Td>
              <Td align="right" style={{ fontWeight: 600 }}>{Number(d.level_litres).toFixed(1)}</Td>
              <Td style={{ color: THEME.textMed }}>{d.recorded_by_name || '—'}</Td>
              <Td style={{ color: THEME.textMed }}>{d.notes || '—'}</Td>
            </TRow>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  )
}

// ── Small UI helpers ───────────────────────────────────────────────────────────

function Pill({ children, color, subtle }) {
  if (subtle) return (
    <span style={{
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
      background: THEME.surfaceVar, color: THEME.textMed, textTransform: 'capitalize',
    }}>{children}</span>
  )
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>{children}</span>
  )
}

function StatusPill({ status }) {
  const map = {
    active:         { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Active' },
    maintenance:    { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Maintenance' },
    decommissioned: { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Decommissioned' },
  }
  const s = map[status] || map.decommissioned
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
      background: s.bg, color: s.text,
    }}>
      {s.label}
    </span>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}

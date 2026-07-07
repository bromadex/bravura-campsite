import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, TableWrap, THead, Th, TRow, Td, fmtDate,
} from '../../components/ui'
import FuelQuickNav from './FuelQuickNav'

const FUEL_CLR = MODULE_COLORS.fuel

const TANK_TYPES = [
  { value: 'above_ground', label: 'Above Ground' },
  { value: 'underground',  label: 'Underground' },
  { value: 'bowser',       label: 'Bowser' },
  { value: 'mobile',       label: 'Mobile' },
]

const STATUS_OPTIONS = [
  { value: 'active',         label: 'Active' },
  { value: 'maintenance',    label: 'Maintenance' },
  { value: 'decommissioned', label: 'Decommissioned' },
]

const BLANK_FORM = {
  name:                  '',
  code:                  '',
  tank_type:             'above_ground',
  fuel_type_id:          '',
  capacity_litres:       '',
  min_threshold_percent: '20',
  location_description:  '',
  gps_lat:               '',
  gps_lng:               '',
  atg_device_id:         '',
  status:                'active',
}

export default function FuelTanks({ setPage }) {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { fuelTypes, tanks, transactions, dipReadings, addTank, updateTank, archiveTank, deleteTank, tankBalance, addTransaction, refresh, loading } = useFuel()

  const openDetail = id => navigate(`/fuel/tanks/${id}`)

  const canEdit = can('fuel.edit')
  const canView = can('fuel.view')

  const [modal,      setModal]      = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [saving,     setSaving]     = useState(false)
  const [archiving,  setArchiving]  = useState(null)
  const [deleting,   setDeleting]   = useState(null)
  const [tab,        setTab]        = useState('overview') // 'overview' | 'analytics' | 'transfers'
  const [view,       setView]       = useState('cards')   // 'cards' | 'table'
  const [filterFuel, setFilterFuel] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterStat, setFilterStat] = useState('active')

  if (!canView) return null

  const defaultFuelTypeId = fuelTypes[0]?.id || ''

  function openAdd() {
    setEditItem(null)
    setForm({ ...BLANK_FORM, fuel_type_id: defaultFuelTypeId })
    setModal(true)
  }

  function openEdit(tank) {
    setEditItem(tank)
    setForm({
      name:                  tank.name,
      code:                  tank.code,
      tank_type:             tank.tank_type,
      fuel_type_id:          tank.fuel_type_id,
      capacity_litres:       tank.capacity_litres != null ? String(tank.capacity_litres) : '',
      min_threshold_percent: tank.min_threshold_percent != null ? String(tank.min_threshold_percent) : '20',
      location_description:  tank.location_description || '',
      gps_lat:               tank.gps_lat != null ? String(tank.gps_lat) : '',
      gps_lng:               tank.gps_lng != null ? String(tank.gps_lng) : '',
      atg_device_id:         tank.atg_device_id || '',
      status:                tank.status,
    })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.name.trim())  { showToast('Enter a tank name', 'red'); return }
    if (!form.code.trim())  { showToast('Enter a tank code (e.g. T-001)', 'red'); return }
    if (!form.fuel_type_id) { showToast('Select a fuel type', 'red'); return }
    const capacity = Number(form.capacity_litres)
    if (!capacity || capacity <= 0) {
      showToast('Enter the tank capacity in litres', 'red'); return
    }
    // Hard guard: never let an edit reduce capacity below what is currently in the tank.
    if (editItem) {
      const currentLevel = Number(editItem.current_level_litres) || 0
      if (capacity < currentLevel) {
        showToast(`Capacity cannot be below current level (${currentLevel.toFixed(1)} L)`, 'red')
        return
      }
    }

    setSaving(true)
    try {
      const data = {
        name:                  form.name.trim(),
        code:                  form.code.trim().toUpperCase(),
        tank_type:             form.tank_type,
        fuel_type_id:          form.fuel_type_id,
        capacity_litres:       capacity,
        min_threshold_percent: Number(form.min_threshold_percent) || 20,
        min_threshold_litres:  (capacity * (Number(form.min_threshold_percent) || 20)) / 100,
        location_description:  form.location_description.trim() || null,
        gps_lat:               form.gps_lat ? Number(form.gps_lat) : null,
        gps_lng:               form.gps_lng ? Number(form.gps_lng) : null,
        atg_device_id:         form.atg_device_id.trim() || null,
        status:                form.status,
      }
      if (editItem) {
        await updateTank(editItem.id, data)
        showToast('Tank updated', 'green')
      } else {
        await addTank(data)
        showToast('Tank added', 'green')
      }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(tank, newStatus) {
    try {
      await updateTank(tank.id, { status: newStatus })
      showToast(`Tank marked ${newStatus}`, 'green')
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'red')
    }
  }

  async function confirmArchive() {
    try {
      await archiveTank(archiving.id)
      showToast('Tank decommissioned', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to decommission', 'red')
    } finally {
      setArchiving(null)
    }
  }

  async function confirmDelete() {
    try {
      await deleteTank(deleting.id)
      showToast('Tank deleted', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'red')
    } finally {
      setDeleting(null)
    }
  }

  // ── Filtering ────────────────────────────────────────────────────────────────
  const displayed = useMemo(() => tanks.filter(t => {
    if (filterFuel !== 'all' && t.fuel_type_id !== filterFuel) return false
    if (filterType !== 'all' && t.tank_type !== filterType)    return false
    if (filterStat !== 'all' && t.status !== filterStat)       return false
    return true
  }), [tanks, filterFuel, filterType, filterStat])

  if (loading) return null

  // ── Transfer tab state ──────────────────────────────────────────────────────
  const activeTanks = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])
  const [trfFrom, setTrfFrom]     = useState('')
  const [trfTo, setTrfTo]         = useState('')
  const [trfLitres, setTrfLitres] = useState('')
  const [trfNotes, setTrfNotes]   = useState('')
  const [trfDocket, setTrfDocket] = useState('')
  const [trfSaving, setTrfSaving] = useState(false)

  const trfFromTank = activeTanks.find(t => t.id === trfFrom)
  const trfToTank   = activeTanks.find(t => t.id === trfTo)
  const trfDestTanks = useMemo(() => {
    if (!trfFromTank) return activeTanks
    return activeTanks.filter(t => t.id !== trfFrom && t.fuel_type_id === trfFromTank.fuel_type_id)
  }, [activeTanks, trfFrom, trfFromTank])
  const trfFromBal = trfFromTank ? tankBalance(trfFromTank.id) : 0
  const trfToBal   = trfToTank   ? tankBalance(trfToTank.id)   : 0
  const trfLitresNum = Number(trfLitres) || 0
  const trfCanSubmit = trfFrom && trfTo && trfLitresNum > 0 && trfLitresNum <= trfFromBal && !trfSaving

  const handleTransfer = useCallback(async () => {
    if (!trfCanSubmit) return
    setTrfSaving(true)
    try {
      const outRow = await addTransaction({
        tank_id: trfFrom,
        transaction_type: 'transfer_out',
        litres: trfLitresNum,
        docket_number: trfDocket || null,
        notes: trfNotes ? `Transfer to ${trfToTank.name}. ${trfNotes}` : `Transfer to ${trfToTank.name}`,
      })
      await addTransaction({
        tank_id: trfTo,
        transaction_type: 'transfer_in',
        litres: trfLitresNum,
        original_transaction_id: outRow.id,
        docket_number: trfDocket || null,
        notes: trfNotes ? `Transfer from ${trfFromTank.name}. ${trfNotes}` : `Transfer from ${trfFromTank.name}`,
      })
      showToast(`Transferred ${trfLitresNum.toLocaleString()} L from ${trfFromTank.name} to ${trfToTank.name}`, 'green')
      setTrfLitres(''); setTrfNotes(''); setTrfDocket(''); setTrfFrom(''); setTrfTo('')
      await refresh()
    } catch (err) {
      showToast(err.message || 'Transfer failed', 'red')
    } finally {
      setTrfSaving(false)
    }
  }, [trfCanSubmit, trfFrom, trfTo, trfLitresNum, trfDocket, trfNotes, trfFromTank, trfToTank, addTransaction, refresh])

  const recentTransfers = useMemo(() =>
    transactions.filter(t => t.transaction_type === 'transfer_out').slice(0, 20),
  [transactions])

  // ── Analytics tab data ────────────────────────────────────────────────────
  const tankStats = useMemo(() =>
    activeTanks.map(t => {
      const bal = tankBalance(t.id)
      const cap = Number(t.capacity_litres) || 0
      const pct = cap ? Math.min(100, Math.max(0, (bal / cap) * 100)) : null
      const monthIss = transactions.filter(tx => tx.transaction_type === 'issuance' && tx.tank_id === t.id && tx.transaction_date?.startsWith(new Date().toISOString().slice(0, 7))).reduce((s, tx) => s + Number(tx.litres), 0)
      const monthDel = transactions.filter(tx => tx.transaction_type === 'delivery' && tx.tank_id === t.id && tx.transaction_date?.startsWith(new Date().toISOString().slice(0, 7))).reduce((s, tx) => s + Number(tx.litres), 0)
      return { ...t, bal, cap, pct, monthIss, monthDel }
    }),
  [activeTanks, tankBalance, transactions])

  // ── Top consumers by vehicle & operator ──────────────────────────────────
  const issuances = useMemo(() => transactions.filter(t => t.transaction_type === 'issuance'), [transactions])
  const totalIssued = useMemo(() => issuances.reduce((s, t) => s + Number(t.litres), 0), [issuances])

  const topVehicles = useMemo(() => {
    const m = new Map()
    for (const t of issuances) {
      const label = t.fuel_vehicles
        ? (t.fuel_vehicles.registration || t.fuel_vehicles.fleet_number)
        : t.asset_description || 'Other'
      m.set(label, (m.get(label) || 0) + Number(t.litres))
    }
    return [...m.entries()].sort(([, a], [, b]) => b - a).slice(0, 8)
  }, [issuances])

  const topOperators = useMemo(() => {
    const m = new Map()
    for (const t of issuances) {
      const label = t.fuel_operators
        ? `${t.fuel_operators.first_name || ''} ${t.fuel_operators.last_name || ''}`.trim()
        : '—'
      m.set(label, (m.get(label) || 0) + Number(t.litres))
    }
    return [...m.entries()].sort(([, a], [, b]) => b - a).slice(0, 8)
  }, [issuances])

  // ── Dipstick history for selected tank ──────────────────────────────────
  const [dipTankSel, setDipTankSel] = useState('')
  const dipTankId = dipTankSel || activeTanks[0]?.id || ''
  const dipHistory = useMemo(() =>
    dipReadings
      .filter(d => d.tank_id === dipTankId)
      .sort((a, b) => a.reading_date.localeCompare(b.reading_date))
      .slice(-30),
  [dipReadings, dipTankId])

  const TABS = [
    { id: 'overview',  label: 'Overview',   icon: 'grid_view' },
    { id: 'analytics', label: 'Analytics',  icon: 'bar_chart' },
    { id: 'transfers', label: 'Transfers',  icon: 'swap_horiz' },
  ]

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <FuelQuickNav setPage={setPage} current="fuel_tanks" />

      <PageHeader
        title="Fuel Tanks"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {tab === 'overview' && (
              <div style={{ display: 'flex', background: THEME.surfaceVar, borderRadius: '10px', padding: '3px' }}>
                {[
                  { id: 'cards', icon: 'grid_view',     label: 'Cards' },
                  { id: 'table', icon: 'table_rows',    label: 'Table' },
                ].map(v => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: view === v.id ? THEME.surface : 'transparent',
                      color:      view === v.id ? THEME.text    : THEME.textMed,
                      boxShadow:  view === v.id ? THEME.shadow1 : 'none',
                    }}
                  >
                    <Icon name={v.icon} size={14} />
                    {v.label}
                  </button>
                ))}
              </div>
            )}
            {tab === 'transfers' && can('fuel.create') && (
              <Button variant="filled" icon="swap_horiz" onClick={handleTransfer} disabled={!trfCanSubmit} style={{ background: FUEL_CLR, borderColor: FUEL_CLR }}>
                {trfSaving ? 'Transferring…' : 'Transfer'}
              </Button>
            )}
            {canEdit && tab === 'overview' && <Button onClick={openAdd} icon="add">Add Tank</Button>}
          </div>
        }
      />

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '0', borderBottom: `2px solid ${THEME.outlineVar}`, marginBottom: '20px' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '10px 20px', fontSize: '13px', fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? FUEL_CLR : THEME.textMed,
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              borderBottom: tab === t.id ? `2px solid ${FUEL_CLR}` : '2px solid transparent',
              marginBottom: '-2px', transition: 'color .15s',
            }}
          >
            <Icon name={t.icon} size={16} style={{ color: 'inherit' }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
        <>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
            <FilterSelect label="Fuel Type" value={filterFuel} onChange={setFilterFuel}>
              <option value="all">All Fuels</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Tank Type" value={filterType} onChange={setFilterType}>
              <option value="all">All Types</option>
              {TANK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Status" value={filterStat} onChange={setFilterStat}>
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </FilterSelect>
            {(filterFuel !== 'all' || filterType !== 'all' || filterStat !== 'active') && (
              <button
                onClick={() => { setFilterFuel('all'); setFilterType('all'); setFilterStat('active') }}
                style={{ background: 'none', border: 'none', color: FUEL_CLR, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Reset filters
              </button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
              {displayed.length} of {tanks.length}
            </span>
          </div>

          {displayed.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '40px 20px', color: THEME.textLow }}>
                <Icon name="propane_tank" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
                <p style={{ fontSize: '14px', margin: '0 0 16px' }}>
                  {tanks.length === 0 ? 'No tanks configured yet.' : 'No tanks match the current filters.'}
                </p>
                {canEdit && tanks.length === 0 && <Button onClick={openAdd} icon="add">Add First Tank</Button>}
              </div>
            </Card>
          ) : view === 'cards' ? (
            <TankCardGrid
              tanks={displayed}
              tankBalance={tankBalance}
              canEdit={canEdit}
              onOpen={openDetail}
              onEdit={openEdit}
              onStatus={setStatus}
              onDecommission={t => setArchiving(t)}
              onDelete={t => setDeleting(t)}
            />
          ) : (
            <TankTable
              tanks={displayed}
              tankBalance={tankBalance}
              canEdit={canEdit}
              onOpen={openDetail}
              onDecommission={t => setArchiving(t)}
              onDelete={t => setDeleting(t)}
            />
          )}
        </>
      )}

      {/* ── Analytics tab ── */}
      {tab === 'analytics' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            {tankStats.map(t => {
              const levelClr = t.pct === null ? FUEL_CLR : t.pct <= 20 ? THEME.error : t.pct < 40 ? THEME.warning : THEME.success
              return (
                <Card key={t.id} style={{ padding: '16px 18px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>{t.name}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '12px' }}>{t.fuel_types?.name || 'Fuel'} · {t.tank_type?.replace('_', ' ')}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                    <span style={{ fontSize: '24px', fontWeight: 700, color: levelClr }}>{t.pct !== null ? `${t.pct.toFixed(0)}%` : '—'}</span>
                    <span style={{ fontSize: '12px', color: THEME.textMed }}>{Math.round(t.bal).toLocaleString()} / {t.cap.toLocaleString()} L</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: THEME.outlineVar, marginBottom: '12px' }}>
                    <div style={{ height: '100%', borderRadius: '3px', width: `${t.pct || 0}%`, background: levelClr }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ background: THEME.surfaceVar, borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase' }}>Issued (month)</div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.warning }}>{Math.round(t.monthIss).toLocaleString()} L</div>
                    </div>
                    <div style={{ background: THEME.surfaceVar, borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase' }}>Delivered (month)</div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.success }}>{Math.round(t.monthDel).toLocaleString()} L</div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          {tankStats.length === 0 && (
            <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
              <Icon name="bar_chart" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
              No active tanks to analyse.
            </Card>
          )}

          {/* ── By Vehicle / By Operator ── */}
          {issuances.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <Card style={{ padding: '20px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>By Vehicle (top 8)</div>
                {topVehicles.map(([label, litres], i) => {
                  const pct = totalIssued ? (litres / totalIssued) * 100 : 0
                  const maxLitres = topVehicles[0]?.[1] || 1
                  return (
                    <div key={i} style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{label}</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, fontFamily: 'monospace' }}>
                          {Math.round(litres).toLocaleString()} L ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '3px', background: THEME.outlineVar }}>
                        <div style={{ height: '100%', borderRadius: '3px', width: `${(litres / maxLitres) * 100}%`, background: '#00897B', transition: 'width .2s' }} />
                      </div>
                    </div>
                  )
                })}
                {topVehicles.length === 0 && <div style={{ color: THEME.textLow, fontSize: '13px' }}>No vehicle issuances.</div>}
              </Card>

              <Card style={{ padding: '20px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>By Driver / Operator (top 8)</div>
                {topOperators.map(([label, litres], i) => {
                  const pct = totalIssued ? (litres / totalIssued) * 100 : 0
                  const maxLitres = topOperators[0]?.[1] || 1
                  return (
                    <div key={i} style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{label}</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, fontFamily: 'monospace' }}>
                          {Math.round(litres).toLocaleString()} L ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '3px', background: THEME.outlineVar }}>
                        <div style={{ height: '100%', borderRadius: '3px', width: `${(litres / maxLitres) * 100}%`, background: FUEL_CLR, transition: 'width .2s' }} />
                      </div>
                    </div>
                  )
                })}
                {topOperators.length === 0 && <div style={{ color: THEME.textLow, fontSize: '13px' }}>No operator issuances.</div>}
              </Card>
            </div>
          )}

          {/* ── Tank Level History (Dipstick) ── */}
          <Card style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Tank Level History (Dipstick)</div>
              {activeTanks.length > 1 && (
                <select
                  value={dipTankId}
                  onChange={e => setDipTankSel(e.target.value)}
                  style={{
                    padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
                    fontSize: '12px', color: THEME.text, background: THEME.surface,
                    fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
                  }}
                >
                  {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
            <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '16px' }}>End-of-day levels from dipstick readings</div>
            {dipHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow, fontSize: '13px' }}>
                No dip readings recorded yet.
              </div>
            ) : (
              <DipBarChart readings={dipHistory} tank={activeTanks.find(t => t.id === dipTankId)} />
            )}
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '8px' }}>
              Last {dipHistory.length} readings · hover to see value
            </div>
          </Card>
        </div>
      )}

      {/* ── Transfers tab ── */}
      {tab === 'transfers' && (
        <div>
          {can('fuel.create') && (
            <Card style={{ padding: '24px', marginBottom: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'start', marginBottom: '20px' }}>
                <div>
                  <div style={trfLbl}>Source Tank</div>
                  <select value={trfFrom} onChange={e => { setTrfFrom(e.target.value); setTrfTo('') }} style={{ ...trfInp, cursor: 'pointer' }}>
                    <option value="">Select source tank…</option>
                    {activeTanks.map(t => (
                      <option key={t.id} value={t.id}>{t.name} — {t.fuel_types?.name || 'Fuel'} ({Math.round(tankBalance(t.id)).toLocaleString()} L)</option>
                    ))}
                  </select>
                  {trfFromTank && <TankMiniPreview tank={trfFromTank} balance={trfFromBal} delta={-trfLitresNum} color={THEME.warning} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '28px' }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: FUEL_CLR + '14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="arrow_forward" size={22} style={{ color: FUEL_CLR }} />
                  </div>
                </div>
                <div>
                  <div style={trfLbl}>Destination Tank</div>
                  <select value={trfTo} onChange={e => setTrfTo(e.target.value)} disabled={!trfFrom} style={{ ...trfInp, cursor: 'pointer' }}>
                    <option value="">Select destination tank…</option>
                    {trfDestTanks.map(t => (
                      <option key={t.id} value={t.id}>{t.name} — {t.fuel_types?.name || 'Fuel'} ({Math.round(tankBalance(t.id)).toLocaleString()} L)</option>
                    ))}
                  </select>
                  {trfToTank && <TankMiniPreview tank={trfToTank} balance={trfToBal} delta={trfLitresNum} color={THEME.success} />}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <div style={trfLbl}>Volume (Litres)</div>
                  <input type="number" min="0" step="0.1" value={trfLitres} onChange={e => setTrfLitres(e.target.value)} placeholder="Enter litres" style={trfInp} />
                  {trfLitresNum > 0 && trfLitresNum > trfFromBal && (
                    <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px', fontWeight: 600 }}>Exceeds available ({Math.round(trfFromBal).toLocaleString()} L)</div>
                  )}
                </div>
                <div>
                  <div style={trfLbl}>Docket (optional)</div>
                  <input type="text" value={trfDocket} onChange={e => setTrfDocket(e.target.value)} placeholder="e.g. TRF-001" style={trfInp} />
                </div>
                <div>
                  <div style={trfLbl}>Notes (optional)</div>
                  <input type="text" value={trfNotes} onChange={e => setTrfNotes(e.target.value)} placeholder="Reason for transfer" style={trfInp} />
                </div>
              </div>

              {trfCanSubmit && (
                <Card style={{ background: FUEL_CLR + '08', borderColor: FUEL_CLR + '30', padding: '12px 16px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: THEME.text }}>
                    <Icon name="swap_horiz" size={20} style={{ color: FUEL_CLR }} />
                    Transfer <strong style={{ color: FUEL_CLR }}>{trfLitresNum.toLocaleString()} L</strong> of{' '}
                    <strong>{trfFromTank?.fuel_types?.name || 'fuel'}</strong> from{' '}
                    <strong>{trfFromTank?.name}</strong> to <strong>{trfToTank?.name}</strong>
                  </div>
                </Card>
              )}
            </Card>
          )}

          {recentTransfers.length > 0 && (
            <Card style={{ padding: 0 }}>
              <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="history" size={18} style={{ color: FUEL_CLR }} />
                <span style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Recent Transfers</span>
              </div>
              <TableWrap>
                <THead>
                  <Th>Date</Th>
                  <Th>From Tank</Th>
                  <Th>To Tank</Th>
                  <Th align="right">Volume (L)</Th>
                  <Th>Docket</Th>
                  <Th>Notes</Th>
                </THead>
                <tbody>
                  {recentTransfers.map((tx, idx) => {
                    const linkedIn = transactions.find(t => t.original_transaction_id === tx.id && t.transaction_type === 'transfer_in')
                    const srcTank = tanks.find(t => t.id === tx.tank_id)
                    const dstTank = linkedIn ? tanks.find(t => t.id === linkedIn.tank_id) : null
                    return (
                      <TRow key={tx.id} last={idx === recentTransfers.length - 1}>
                        <Td style={{ whiteSpace: 'nowrap', color: THEME.textMed }}>{fmtDate(tx.transaction_date)}</Td>
                        <Td style={{ fontWeight: 600, color: THEME.text }}>{srcTank?.name || '—'}</Td>
                        <Td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: THEME.text }}>
                            <Icon name="arrow_forward" size={14} style={{ color: FUEL_CLR }} />
                            {dstTank?.name || '—'}
                          </span>
                        </Td>
                        <Td align="right" style={{ fontWeight: 700, color: FUEL_CLR }}>{Number(tx.litres).toLocaleString(undefined, { maximumFractionDigits: 1 })}</Td>
                        <Td style={{ color: THEME.textMed }}>{tx.docket_number || '—'}</Td>
                        <Td style={{ color: THEME.textLow, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.notes || '—'}</Td>
                      </TRow>
                    )
                  })}
                </tbody>
              </TableWrap>
            </Card>
          )}

          {recentTransfers.length === 0 && (
            <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
              <Icon name="swap_horiz" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
              No transfers recorded yet.
            </Card>
          )}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Tank' : 'Add Tank'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update Tank' : 'Add Tank'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Tank Name *</SectionLabel>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Diesel Tank" style={inputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Tank Code *</SectionLabel>
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. T-001" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Tank Type *</SectionLabel>
            <select value={form.tank_type} onChange={e => set('tank_type', e.target.value)} style={inputStyle}>
              {TANK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Fuel Type *</SectionLabel>
            <select value={form.fuel_type_id} onChange={e => set('fuel_type_id', e.target.value)} style={inputStyle}>
              <option value="">— Select —</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Capacity (Litres) *</SectionLabel>
            <input
              type="number" min="1" step="1"
              value={form.capacity_litres}
              onChange={e => set('capacity_litres', e.target.value)}
              placeholder="e.g. 10000"
              style={inputStyle}
            />
            {editItem && (
              <div style={{ marginTop: '-8px', marginBottom: '14px', fontSize: '11px', color: THEME.textLow }}>
                Current level: {Number(editItem.current_level_litres || 0).toFixed(1)} L — capacity cannot drop below this.
              </div>
            )}
          </div>
          <div>
            <SectionLabel>Low-Fuel Alert Threshold (%)</SectionLabel>
            <input
              type="number" min="0" max="100" step="1"
              value={form.min_threshold_percent}
              onChange={e => set('min_threshold_percent', e.target.value)}
              placeholder="20"
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <SectionLabel>Location Description</SectionLabel>
          <input value={form.location_description} onChange={e => set('location_description', e.target.value)} placeholder="e.g. Near main gate, pump house" style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>GPS Latitude</SectionLabel>
            <input
              type="number" step="0.0000001"
              value={form.gps_lat}
              onChange={e => set('gps_lat', e.target.value)}
              placeholder="-17.8252"
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>GPS Longitude</SectionLabel>
            <input
              type="number" step="0.0000001"
              value={form.gps_lng}
              onChange={e => set('gps_lng', e.target.value)}
              placeholder="31.0335"
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>ATG Device ID</SectionLabel>
            <input
              value={form.atg_device_id}
              onChange={e => set('atg_device_id', e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </div>
        </div>

        {editItem && (
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
              <option value="active">Active</option>
              <option value="maintenance">Under Maintenance</option>
            </select>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={confirmArchive}
        title="Decommission Tank"
        message={archiving
          ? `Decommission "${archiving.name}"? The tank will be hidden from all dropdowns. Transaction history is preserved. This cannot be undone.`
          : ''}
      />

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete Tank"
        danger
        confirmLabel="Delete permanently"
        message={deleting
          ? `Delete "${deleting.name}" permanently? This removes the tank, its pumps, dip readings, and calibration chart. The action is refused if any transaction has ever been recorded against this tank — in that case decommission instead.`
          : ''}
      />
    </div>
  )
}

// ── Card Grid ──────────────────────────────────────────────────────────────────

function TankCardGrid({ tanks, tankBalance, canEdit, onOpen, onEdit, onStatus, onDecommission, onDelete }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '14px' }}>
      {tanks.map(tank => (
        <TankCard
          key={tank.id}
          tank={tank}
          balance={tankBalance(tank.id)}
          canEdit={canEdit}
          onOpen={() => onOpen(tank.id)}
          onEdit={() => onEdit(tank)}
          onStatus={s => onStatus(tank, s)}
          onDecommission={() => onDecommission(tank)}
          onDelete={() => onDelete(tank)}
        />
      ))}
    </div>
  )
}

function TankCard({ tank, balance, canEdit, onOpen, onEdit, onStatus, onDecommission, onDelete }) {
  const capacity = Number(tank.capacity_litres) || 0
  const pct      = capacity ? Math.min(100, Math.max(0, (balance / capacity) * 100)) : 0
  const minPct   = Number(tank.min_threshold_percent) || 20
  const isLow    = pct <= minPct
  const isWarn   = pct > minPct && pct < minPct * 1.5
  const levelClr = isLow ? THEME.error : isWarn ? THEME.warning : THEME.success
  const ftName   = tank.fuel_types?.name   || 'Unknown'
  const ftColor  = tank.fuel_types?.colour || FUEL_CLR
  const isDecom  = tank.status === 'decommissioned'

  return (
    <div
      onClick={onOpen}
      style={{
        background: THEME.surface, border: `1px solid ${isLow ? THEME.error + '55' : THEME.outlineVar}`,
        borderRadius: '10px', padding: '16px', boxShadow: THEME.shadow1,
        display: 'flex', flexDirection: 'column', gap: '12px',
        opacity: isDecom ? 0.6 : 1,
        cursor: 'pointer', transition: 'transform .12s, box-shadow .12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = THEME.shadow2 }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';   e.currentTarget.style.boxShadow = THEME.shadow1 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '2px' }}>
            {tank.name}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: THEME.textLow }}>
            {tank.code}
          </div>
        </div>
        <span style={{
          padding: '2px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
          background: ftColor + '22', color: ftColor, border: `1px solid ${ftColor}44`,
          whiteSpace: 'nowrap',
        }}>
          {ftName}
        </span>
      </div>

      {/* Level bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
          <span style={{ fontSize: '22px', fontWeight: 600, color: levelClr, letterSpacing: '-0.01em' }}>
            {pct.toFixed(0)}%
          </span>
          <span style={{ fontSize: '12px', color: THEME.textMed }}>
            {balance.toFixed(0)} / {capacity.toLocaleString()} L
          </span>
        </div>
        <div style={{ height: '10px', borderRadius: '999px', background: THEME.surfaceVar, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: levelClr, transition: 'width .25s',
          }} />
          {/* Threshold marker */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${minPct}%`, width: '2px', background: THEME.outline,
          }} />
        </div>
      </div>

      {/* Status + alert badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <StatusBadge status={tank.status} />
        {isLow && !isDecom && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
            background: THEME.statusErrorBg, color: THEME.statusErrorText,
          }}>
            <Icon name="warning" size={12} /> Low Fuel
          </span>
        )}
        <span style={{
          padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
          background: THEME.surfaceVar, color: THEME.textMed, textTransform: 'capitalize',
        }}>
          {tank.tank_type?.replace('_', ' ')}
        </span>
      </div>

      {tank.location_description && (
        <div style={{ fontSize: '11px', color: THEME.textLow, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="location_on" size={12} /> {tank.location_description}
        </div>
      )}

      {/* Actions */}
      {canEdit && !isDecom && (
        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
          <button onClick={e => { e.stopPropagation(); onEdit() }} style={cardBtn(false)}>
            <Icon name="edit" size={13} /> Edit
          </button>
          {tank.status === 'active' ? (
            <button onClick={e => { e.stopPropagation(); onStatus('maintenance') }} style={cardBtn(false)}>
              <Icon name="build" size={13} /> Maintenance
            </button>
          ) : (
            <button onClick={e => { e.stopPropagation(); onStatus('active') }} style={cardBtn(false)}>
              <Icon name="play_arrow" size={13} /> Reactivate
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onDecommission() }} style={cardBtn(true)} title="Decommission">
            <Icon name="archive" size={13} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }} style={cardBtn(true)} title="Delete permanently">
            <Icon name="delete" size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Table view ─────────────────────────────────────────────────────────────────

function TankTable({ tanks, tankBalance, canEdit, onOpen, onDecommission, onDelete }) {
  return (
    <Card style={{ padding: 0 }}>
      <TableWrap>
        <THead color={FUEL_CLR}>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Fuel</Th>
          <Th align="right">Capacity (L)</Th>
          <Th align="right">Level</Th>
          <Th align="right">%</Th>
          <Th>Status</Th>
          {canEdit && <Th />}
        </THead>
        <tbody>
          {tanks.map((tank, idx) => {
            const balance = tankBalance(tank.id)
            const pct = tank.capacity_litres
              ? Math.min(100, Math.max(0, (balance / Number(tank.capacity_litres)) * 100))
              : null
            const minPct = Number(tank.min_threshold_percent) || 20
            const isLow  = pct !== null && pct <= minPct
            const levelClr = isLow ? THEME.error : pct < minPct * 1.5 ? THEME.warning : THEME.success
            const ftName  = tank.fuel_types?.name   || '—'
            const ftColor = tank.fuel_types?.colour || FUEL_CLR

            return (
              <TRow
                key={tank.id}
                last={idx === tanks.length - 1}
                onClick={() => onOpen(tank.id)}
              >
                <Td><span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: THEME.textMed }}>{tank.code}</span></Td>
                <Td><span style={{ fontWeight: 500 }}>{tank.name}</span></Td>
                <Td style={{ color: THEME.textMed, textTransform: 'capitalize' }}>
                  {TANK_TYPES.find(t => t.value === tank.tank_type)?.label || tank.tank_type}
                </Td>
                <Td>
                  <span style={{
                    padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                    background: ftColor + '22', color: ftColor, border: `1px solid ${ftColor}44`,
                  }}>
                    {ftName}
                  </span>
                </Td>
                <Td align="right" style={{ fontWeight: 500 }}>
                  {tank.capacity_litres != null ? Number(tank.capacity_litres).toLocaleString() : '—'}
                </Td>
                <Td align="right">
                  <span style={{ fontWeight: 600, color: isLow ? THEME.error : THEME.text }}>
                    {balance.toFixed(0)}
                  </span>
                </Td>
                <Td align="right">
                  {pct !== null ? (
                    <span style={{ fontWeight: 600, fontSize: '13px', color: levelClr }}>
                      {pct.toFixed(0)}%
                    </span>
                  ) : '—'}
                </Td>
                <Td><StatusBadge status={tank.status} /></Td>
                {canEdit && (
                  <Td>
                    {tank.status !== 'decommissioned' && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={e => { e.stopPropagation(); onDecommission(tank) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', opacity: .6 }}
                          title="Decommission tank"
                        >
                          <Icon name="archive" size={16} style={{ color: THEME.warning }} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(tank) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', opacity: .6 }}
                          title="Delete tank permanently"
                        >
                          <Icon name="delete" size={16} style={{ color: THEME.error }} />
                        </button>
                      </div>
                    )}
                  </Td>
                )}
              </TRow>
            )
          })}
        </tbody>
      </TableWrap>
    </Card>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
      <span>{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
          fontSize: '12px', color: THEME.text, background: THEME.surface,
          fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        }}
      >
        {children}
      </select>
    </label>
  )
}

function StatusBadge({ status }) {
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

function cardBtn(danger) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '6px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 500,
    border: `1px solid ${danger ? THEME.error + '55' : THEME.outline}`,
    background: 'transparent',
    color: danger ? THEME.error : THEME.textMed,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  }
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}

const trfLbl = {
  fontSize: '12px', fontWeight: 600, color: THEME.textMed,
  marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.03em',
}

const trfInp = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}

function DipBarChart({ readings, tank }) {
  const [hover, setHover] = useState(null)
  const cap = Number(tank?.capacity_litres) || 0
  const minThresh = cap ? cap * (Number(tank?.min_threshold_percent || 20) / 100) : 0
  const maxVal = Math.max(cap, ...readings.map(r => Number(r.level_litres)))
  const W = 960, H = 260
  const PAD = { top: 16, right: 16, bottom: 50, left: 54 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / readings.length
  const barW = Math.min(28, slot * 0.65)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        {/* threshold line */}
        {minThresh > 0 && (
          <>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={PAD.top + innerH - (minThresh / maxVal) * innerH}
              y2={PAD.top + innerH - (minThresh / maxVal) * innerH}
              stroke={THEME.error} strokeWidth="1" strokeDasharray="6 3" opacity="0.5"
            />
            <text x={PAD.left - 6} y={PAD.top + innerH - (minThresh / maxVal) * innerH + 3} textAnchor="end" fontSize="9" fill={THEME.error} fontFamily="inherit">
              Low
            </text>
          </>
        )}
        {/* baseline */}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke={THEME.outlineVar} strokeWidth="1" />
        {readings.map((r, i) => {
          const litres = Number(r.level_litres)
          const h = (litres / maxVal) * innerH
          const cx = PAD.left + slot * i + slot / 2
          const y = PAD.top + innerH - h
          const isLow = litres <= minThresh
          const isHover = hover === i
          return (
            <g key={i}>
              <rect
                x={cx - barW / 2} y={y} width={barW} height={Math.max(2, h)} rx="3"
                fill={isLow ? THEME.error : '#00897B'}
                opacity={isHover ? 0.8 : 1}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'default', transition: 'opacity .12s' }}
              />
              {isHover && (
                <text x={cx} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill={isLow ? THEME.error : '#00897B'} fontFamily="inherit">
                  {Math.round(litres).toLocaleString()} L
                </text>
              )}
              {(i % Math.max(1, Math.ceil(readings.length / 12)) === 0 || i === readings.length - 1) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">
                  {r.reading_date?.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function TankMiniPreview({ tank, balance, delta, color }) {
  const cap = Number(tank.capacity_litres) || 0
  const after = Math.max(0, balance + delta)
  const pctBefore = cap ? (balance / cap) * 100 : 0
  const pctAfter  = cap ? (after / cap) * 100 : 0
  return (
    <div style={{ marginTop: '10px', padding: '10px 12px', background: THEME.surfaceVar, borderRadius: '8px' }}>
      <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '6px' }}>{tank.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
        <span style={{ fontWeight: 600, color: THEME.textMed }}>{Math.round(balance).toLocaleString()} L</span>
        {delta !== 0 && (
          <>
            <Icon name="arrow_forward" size={14} style={{ color }} />
            <span style={{ fontWeight: 700, color }}>{Math.round(after).toLocaleString()} L</span>
          </>
        )}
      </div>
      <div style={{ height: '4px', borderRadius: '2px', background: THEME.outlineVar, marginTop: '6px', position: 'relative' }}>
        <div style={{ height: '100%', borderRadius: '2px', width: `${Math.min(100, pctAfter)}%`, background: color, transition: 'width .2s' }} />
      </div>
    </div>
  )
}

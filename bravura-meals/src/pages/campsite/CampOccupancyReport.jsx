import { useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, fmtDate, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'

export default function CampOccupancyReport() {
  const { currentSite } = useSite()
  const { blocks, rooms, assignments, loading } = useCampsite()

  const blockStats = useMemo(() => blocks.map(block => {
    const blockRooms     = rooms.filter(r => r.block_id === block.id)
    const occupied       = blockRooms.filter(r => r.status === 'occupied').length
    const available      = blockRooms.filter(r => r.status === 'available').length
    const maintenance    = blockRooms.filter(r => r.status === 'maintenance').length
    const totalResidents = assignments.filter(a => a.status === 'active' && a.room?.block_id === block.id).length
    const pct            = blockRooms.length > 0 ? Math.round(occupied / blockRooms.length * 100) : 0
    return { ...block, total: blockRooms.length, occupied, available, maintenance, totalResidents, pct }
  }), [blocks, rooms, assignments])

  const grandTotals = blockStats.reduce((acc, b) => ({
    total:     acc.total     + b.total,
    occupied:  acc.occupied  + b.occupied,
    available: acc.available + b.available,
    maintenance: acc.maintenance + b.maintenance,
    residents: acc.residents + b.totalResidents,
  }), { total: 0, occupied: 0, available: 0, maintenance: 0, residents: 0 })

  const overallPct = grandTotals.total > 0 ? Math.round(grandTotals.occupied / grandTotals.total * 100) : 0
  const pctColor   = overallPct > 90 ? THEME.error : overallPct > 70 ? THEME.warning : THEME.success

  if (loading) return (
    <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
      <Icon name="progress_activity" size={24} style={{ color: MODULE_COLORS.campsite }} />
    </div>
  )

  return (
    <div className="print-page">
      {/* Print header */}
      <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
        <div style={{ borderBottom: `3px solid ${MODULE_COLORS.campsite}`, paddingBottom: '10px', marginBottom: '12px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{currentSite?.name || 'Bravura Campsite'}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>Campsite Occupancy Report</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Printed: {new Date().toLocaleString('en-GB')}</div>
        </div>
      </div>

      <PageHeader
        title="Occupancy Reports"
        actions={
          <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: MODULE_COLORS.campsite, fontFamily: 'inherit' }}>
            <Icon name="print" size={16} style={{ color: MODULE_COLORS.campsite }} /> Print
          </button>
        }
      />

      {/* Overall stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Rooms',     v: grandTotals.total,       c: MODULE_COLORS.campsite },
          { label: 'Occupied',        v: grandTotals.occupied,    c: THEME.error },
          { label: 'Available',       v: grandTotals.available,   c: THEME.success },
          { label: 'Maintenance',     v: grandTotals.maintenance, c: THEME.warning },
          { label: 'Total Residents', v: grandTotals.residents,   c: '#1558A6' },
          { label: 'Occupancy Rate',  v: `${overallPct}%`,        c: pctColor },
        ].map(s => (
          <div key={s.label} style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: 300, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Per-block breakdown */}
      <Card style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '14px' }}>Occupancy by Block</div>
        {blockStats.length === 0 ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>No blocks configured.</div>
        ) : blockStats.map(b => (
          <div key={b.id} style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{b.name}</span>
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                <span style={{ color: THEME.error }}>{b.occupied} occ</span>
                <span style={{ color: THEME.success }}>{b.available} avail</span>
                {b.maintenance > 0 && <span style={{ color: THEME.warning }}>{b.maintenance} maint</span>}
                <span style={{ fontWeight: 700, color: MODULE_COLORS.campsite }}>{b.pct}%</span>
              </div>
            </div>
            <div style={{ height: '10px', background: THEME.outlineVar, borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${b.pct}%`, background: b.pct > 90 ? THEME.error : b.pct > 70 ? THEME.warning : THEME.success, borderRadius: '5px', transition: 'width .4s' }} />
            </div>
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '3px' }}>
              {b.total} rooms · {b.totalResidents} residents
            </div>
          </div>
        ))}
      </Card>

      {/* Per-block table */}
      <TableWrap>
        <THead color={MODULE_COLORS.campsite}>
          {['Block','Total Rooms','Occupied','Available','Maintenance','Residents','Occ %'].map((h, i) => (
            <Th key={h} align={i === 0 ? 'left' : 'center'}>{h}</Th>
          ))}
        </THead>
        <tbody>
          {blockStats.map(b => (
            <TRow key={b.id}>
              <Td style={{ fontWeight: 600 }}>{b.name}</Td>
              <Td align="center">{b.total}</Td>
              <Td align="center" style={{ color: THEME.error, fontWeight: 600 }}>{b.occupied}</Td>
              <Td align="center" style={{ color: THEME.success, fontWeight: 600 }}>{b.available}</Td>
              <Td align="center" style={{ color: THEME.warning }}>{b.maintenance}</Td>
              <Td align="center" style={{ color: THEME.info, fontWeight: 600 }}>{b.totalResidents}</Td>
              <Td align="center" style={{ fontWeight: 700, color: b.pct > 90 ? THEME.error : b.pct > 70 ? THEME.warning : THEME.success }}>{b.pct}%</Td>
            </TRow>
          ))}
          <tr style={{ background: MODULE_COLORS.campsite, color: '#fff', fontWeight: 600 }}>
            <td style={{ padding: '11px 14px' }}>Grand Total</td>
            <td style={{ padding: '11px 14px', textAlign: 'center' }}>{grandTotals.total}</td>
            <td style={{ padding: '11px 14px', textAlign: 'center' }}>{grandTotals.occupied}</td>
            <td style={{ padding: '11px 14px', textAlign: 'center' }}>{grandTotals.available}</td>
            <td style={{ padding: '11px 14px', textAlign: 'center' }}>{grandTotals.maintenance}</td>
            <td style={{ padding: '11px 14px', textAlign: 'center' }}>{grandTotals.residents}</td>
            <td style={{ padding: '11px 14px', textAlign: 'center' }}>{overallPct}%</td>
          </tr>
        </tbody>
      </TableWrap>
    </div>
  )
}

import { useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle, DonutGauge, ProgressRow } from '../../components/dash'
import QuickNav, { CAMPSITE_PILLS } from '../../components/QuickNav'

const CLR = MODULE_COLORS.campsite

export default function CampOccupancyReport({ setPage }) {
  const { currentSite } = useSite()
  const { blocks, rooms, assignments, loading } = useCampsite()

  const blockStats = useMemo(() => {
    // Occupancy is derived from live assignments, not camp_rooms.status —
    // assignRoom/transferRoom never write 'occupied' to the room row, so
    // reading r.status here would report 0 occupied forever. Mirrors the
    // getRoomStatus logic in CampsiteContext.
    const occupiedRoomIds = new Set(
      assignments.filter(a => a.status === 'active').map(a => a.room_id || a.room?.id).filter(Boolean)
    )
    return blocks.map(block => {
      // Exclude non-residential rooms so this report agrees with the
      // dashboard KPIs, which skip store/maintenance room types.
      const blockRooms     = rooms.filter(r =>
        r.block_id === block.id && r.room_type !== 'store' && r.room_type !== 'maintenance'
      )
      const occupied       = blockRooms.filter(r => occupiedRoomIds.has(r.id)).length
      const maintenance    = blockRooms.filter(r => r.status === 'maintenance' && !occupiedRoomIds.has(r.id)).length
      const available      = Math.max(0, blockRooms.length - occupied - maintenance)
      const totalResidents = assignments.filter(a => a.status === 'active' && a.room?.block_id === block.id).length
      const pct            = blockRooms.length > 0 ? Math.round(occupied / blockRooms.length * 100) : 0
      return { ...block, total: blockRooms.length, occupied, available, maintenance, totalResidents, pct }
    })
  }, [blocks, rooms, assignments])

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
      <Icon name="progress_activity" size={24} style={{ color: CLR }} />
    </div>
  )

  const thStyle = align => ({
    padding: '9px 14px', textAlign: align, fontSize: '11px', fontWeight: 600,
    color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em',
    borderBottom: `1px solid ${THEME.outlineVar}`,
  })

  return (
    <div className="print-page">
      <QuickNav pills={CAMPSITE_PILLS} setPage={setPage} current="camp_occ_report" />
      {/* Print header */}
      <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
        <div style={{ borderBottom: `3px solid ${CLR}`, paddingBottom: '10px', marginBottom: '12px' }}>
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
          <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: CLR, fontFamily: 'inherit' }}>
            <Icon name="print" size={16} style={{ color: CLR }} /> Print
          </button>
        }
      />

      {/* Overall stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard icon="meeting_room" label="Total Rooms" value={grandTotals.total} accent={CLR}
          sub={`${blockStats.length} block${blockStats.length === 1 ? '' : 's'}`} />
        <KpiCard icon="bed" label="Occupied" value={grandTotals.occupied} accent={THEME.error}
          progress={grandTotals.total > 0 ? grandTotals.occupied / grandTotals.total * 100 : 0}
          sub="Share of all rooms" />
        <KpiCard icon="check_circle" label="Available" value={grandTotals.available} accent={THEME.success}
          progress={grandTotals.total > 0 ? grandTotals.available / grandTotals.total * 100 : 0}
          sub="Share of all rooms" />
        <KpiCard icon="build" label="Maintenance" value={grandTotals.maintenance} accent={THEME.warning}
          progress={grandTotals.total > 0 ? grandTotals.maintenance / grandTotals.total * 100 : 0}
          sub="Share of all rooms" />
        <KpiCard icon="groups" label="Total Residents" value={grandTotals.residents} accent="#1558A6" />
      </div>

      {/* Per-block breakdown + overall gauge */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch', flexWrap: 'wrap', marginBottom: '20px' }}>
        <DashCard style={{ flex: '1 1 480px', minWidth: 0 }}>
          <SectionTitle title="Occupancy by Block" subtitle="Occupied rooms as a share of residential rooms" />
          {blockStats.length === 0 ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>No blocks configured.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {blockStats.map(b => (
                <div key={b.id}>
                  <ProgressRow
                    label={b.name}
                    value={`${b.pct}%`}
                    pct={b.pct}
                    color={b.pct > 90 ? THEME.error : b.pct > 70 ? THEME.warning : THEME.success}
                  />
                  <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px', marginLeft: '120px' }}>
                    {b.occupied} occ · {b.available} avail{b.maintenance > 0 ? ` · ${b.maintenance} maint` : ''} · {b.total} rooms · {b.totalResidents} residents
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashCard>
        <DashCard style={{ flex: '0 1 240px' }}>
          <SectionTitle title="Overall Occupancy" subtitle="All residential rooms" />
          <DonutGauge
            pct={grandTotals.total > 0 ? overallPct : null}
            color={pctColor}
            size={140}
            label="occupied"
            legend={[[THEME.error, 'Occupied'], [THEME.success, 'Available']]}
          />
        </DashCard>
      </div>

      {/* Per-block table */}
      <DashCard style={{ padding: '20px 22px 8px' }}>
        <SectionTitle title="Block Summary" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Block','Total Rooms','Occupied','Available','Maintenance','Residents','Occ %'].map((h, i) => (
                  <th key={h} style={thStyle(i === 0 ? 'left' : 'center')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blockStats.map(b => (
                <tr key={b.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text }}>{b.name}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: THEME.text }}>{b.total}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: THEME.error, fontWeight: 600 }}>{b.occupied}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: THEME.success, fontWeight: 600 }}>{b.available}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: THEME.warning }}>{b.maintenance}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: THEME.info, fontWeight: 600 }}>{b.totalResidents}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: b.pct > 90 ? THEME.error : b.pct > 70 ? THEME.warning : THEME.success }}>{b.pct}%</td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${THEME.outlineVar}`, fontWeight: 700, color: THEME.text }}>
                <td style={{ padding: '11px 14px' }}>Grand Total</td>
                <td style={{ padding: '11px 14px', textAlign: 'center' }}>{grandTotals.total}</td>
                <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.error }}>{grandTotals.occupied}</td>
                <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.success }}>{grandTotals.available}</td>
                <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.warning }}>{grandTotals.maintenance}</td>
                <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.info }}>{grandTotals.residents}</td>
                <td style={{ padding: '11px 14px', textAlign: 'center', color: CLR }}>{overallPct}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  )
}

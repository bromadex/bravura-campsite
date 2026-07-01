import { useMemo } from 'react'
import { Icon, SortTh, useSortState, sortRows } from '../../../components/ui'
import { THEME } from '../../../utils/permissions'

// ── Contractor colour pool ──────────────────────────────────────────────────
export const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457']
export function coColor(contractors, id) {
  const idx = contractors.findIndex(c => c.id === id)
  return CO_COLORS[idx >= 0 ? idx % CO_COLORS.length : 0]
}

// ── Print-only header shown when printing a report ─────────────────────────
export function PrintHeader({ title, subtitle, site }) {
  return (
    <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
      <div style={{ borderBottom: `3px solid ${THEME.primary}`, paddingBottom: '10px', marginBottom: '12px' }}>
        <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.primary }}>
          {site?.name || 'Bravura Campsite'}
        </div>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '2px' }}>Meal Management System</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          {subtitle} &nbsp;|&nbsp; Printed: {new Date().toLocaleString('en-GB')}
        </div>
      </div>
    </div>
  )
}

// ── Shared sortable report table ────────────────────────────────────────────
// Used by the daily, range, and monthly report pages.
// isRange=true swaps the check-mark cells for numeric counts.
export function ReportTable({ rows, showCosts = false, prices = null, isRange = false, contractors = [] }) {
  const [sortState, onSort] = useSortState('name', 'asc')

  const sorted = useMemo(() => {
    const mapped = rows.map(r => ({
      ...r,
      contractorName: contractors.find(c => c.id === r.contractor_id)?.name || r.contractor?.name || '—',
    }))
    return sortRows(mapped, sortState.key, sortState.dir)
  }, [rows, sortState, contractors])

  let totB = 0, totL = 0, totS = 0
  sorted.forEach(r => { totB += r.b||0; totL += r.l||0; totS += r.s||0 })
  const grandTotal = totB + totL + totS

  const hStyle       = { background: THEME.surfaceVar, color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }
  const hStyleTintB  = { ...hStyle, background: THEME.breakfastClr + '18' }
  const hStyleTintL  = { ...hStyle, background: THEME.lunchClr     + '18' }
  const hStyleTintS  = { ...hStyle, background: THEME.supperClr    + '18' }
  const chkCell = (v, color) => v
    ? <Icon name="check_circle" size={18} filled style={{ color }} />
    : <span style={{ color: THEME.outlineVar, fontSize: '14px' }}>—</span>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th style={{ ...hStyle, padding: '10px 10px', width: '40px', textAlign: 'center', fontWeight: 600, fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase' }}>#</th>
            <SortTh label="Employee"   sortKey="name"           sortState={sortState} onSort={onSort} style={hStyle} />
            <SortTh label="Contractor" sortKey="contractorName" sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
            <SortTh label="Breakfasts" sortKey="b"              sortState={sortState} onSort={onSort} style={{ ...hStyleTintB, textAlign: 'center' }} />
            <SortTh label="Lunches"    sortKey="l"              sortState={sortState} onSort={onSort} style={{ ...hStyleTintL, textAlign: 'center' }} />
            <SortTh label="Suppers"    sortKey="s"              sortState={sortState} onSort={onSort} style={{ ...hStyleTintS, textAlign: 'center' }} />
            <SortTh label="Total"      sortKey="total"          sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
            {showCosts && prices && (
              <th style={{ ...hStyle, padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase' }}>Cost (USD)</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const tot   = (r.b||0) + (r.l||0) + (r.s||0)
            const isAny = tot > 0
            const color = coColor(contractors, r.contractor_id)
            return (
              <tr
                key={r.employee_id || r.id || i}
                style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: isAny ? '#fff' : '#FAFAFA' }}
                onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                onMouseLeave={e => e.currentTarget.style.background = isAny ? '#fff' : '#FAFAFA'}
              >
                <td style={{ padding: '9px 10px', textAlign: 'center', color: THEME.textLow, fontSize: '11px' }}>{i+1}</td>
                <td style={{ padding: '9px 14px', fontWeight: isAny ? 500 : 400, color: isAny ? THEME.text : THEME.textLow }}>
                  {r.name}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {r.contractorName !== '—' ? (
                    <span style={{
                      background: color + '18', color, padding: '3px 10px',
                      borderRadius: '8px', fontSize: '11px', fontWeight: 500,
                    }}>
                      {r.contractorName}
                    </span>
                  ) : <span style={{ color: THEME.textLow }}>—</span>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {isRange
                    ? <span style={{ fontWeight: 600, color: r.b ? THEME.breakfastClr : THEME.textLow }}>{r.b || '—'}</span>
                    : chkCell(r.b, THEME.breakfastClr)
                  }
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {isRange
                    ? <span style={{ fontWeight: 600, color: r.l ? THEME.lunchClr : THEME.textLow }}>{r.l || '—'}</span>
                    : chkCell(r.l, THEME.lunchClr)
                  }
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {isRange
                    ? <span style={{ fontWeight: 600, color: r.s ? THEME.supperClr : THEME.textLow }}>{r.s || '—'}</span>
                    : chkCell(r.s, THEME.supperClr)
                  }
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: isAny ? THEME.primary : THEME.textLow }}>
                  {tot || '—'}
                </td>
                {showCosts && prices && (
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: isAny ? 600 : 400, color: isAny ? THEME.text : THEME.textLow }}>
                    {isAny ? `$${((r.b||0)*prices.b + (r.l||0)*prices.l + (r.s||0)*prices.s).toFixed(2)}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: THEME.surfaceVar, color: THEME.text, fontWeight: 600, borderTop: `2px solid ${THEME.outlineVar}` }}>
            <td colSpan={3} style={{ padding: '12px 14px', fontSize: '13px' }}>Grand Total</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: THEME.breakfastClr }}>{totB}</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: THEME.lunchClr }}>{totL}</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: THEME.supperClr }}>{totS}</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '16px', fontWeight: 700, color: THEME.primary }}>{grandTotal}</td>
            {showCosts && prices && (
              <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: '14px' }}>
                ${(totB*prices.b + totL*prices.l + totS*prices.s).toFixed(2)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'

const color = MODULE_COLORS.finance || '#1565C0'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtK(v) {
  const abs = Math.abs(v)
  if (abs >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}
function fmt(v) {
  const neg = v < 0
  return `${neg ? '(' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}${neg ? ')' : ''}`
}

function GaugeChart({ value, target, label, color: gaugeColor, size = 120 }) {
  const pct = Math.min(Math.max(value, 0), 100)
  const r = (size - 16) / 2
  const cx = size / 2, cy = size / 2
  const circumference = Math.PI * r
  const offset = circumference - (pct / 100) * circumference
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{ textAlign: 'center', position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <svg width={size} height={size / 2 + 16} viewBox={`0 0 ${size} ${size / 2 + 16}`}>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={THEME.outline} strokeWidth={10} strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={gaugeColor} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: THEME.text }}>{pct.toFixed(0)}%</text>
      </svg>
      <div style={{ fontSize: 11, color: THEME.textMed, marginTop: -4 }}>Target {target}%</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text, marginTop: 4 }}>{label}</div>
      {hover && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none', marginBottom: 4 }}>
          {label}: {pct.toFixed(1)}% (Target: {target}%)
        </div>
      )}
    </div>
  )
}

function BarChart({ data, width = 500, height = 220 }) {
  const [tooltip, setTooltip] = useState(null)
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expenses]), 1)
  const barW = Math.min(20, (width - 80) / data.length / 2.5)
  const chartH = height - 50
  const chartL = 55, chartR = width - 10

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = 10 + chartH * (1 - f)
          return (
            <g key={f}>
              <line x1={chartL} y1={y} x2={chartR} y2={y} stroke={THEME.outline} strokeWidth={0.5} />
              <text x={chartL - 6} y={y + 4} textAnchor="end" style={{ fontSize: 9, fill: THEME.textMed }}>{fmtK(maxVal * f)}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const groupX = chartL + ((chartR - chartL) / data.length) * (i + 0.5)
          const incH = (d.income / maxVal) * chartH
          const expH = (d.expenses / maxVal) * chartH
          return (
            <g key={d.month}
              onMouseEnter={(e) => setTooltip({ x: groupX, month: d.month, income: d.income, expenses: d.expenses })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={groupX - barW - 1} y={10 + chartH - incH} width={barW} height={incH} rx={2} fill="#43A047" opacity={0.85} />
              <rect x={groupX + 1} y={10 + chartH - expH} width={barW} height={expH} rx={2} fill="#E53935" opacity={0.85} />
              <text x={groupX} y={height - 6} textAnchor="middle" style={{ fontSize: 10, fill: THEME.textMed }}>{d.month}</text>
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div style={{
          position: 'absolute', top: 0, left: `${(tooltip.x / width) * 100}%`, transform: 'translateX(-50%)',
          background: THEME.text, color: THEME.surface, padding: '8px 12px', borderRadius: 8, fontSize: 12, zIndex: 10, pointerEvents: 'none', lineHeight: 1.6, whiteSpace: 'nowrap'
        }}>
          <div style={{ fontWeight: 700 }}>{tooltip.month}</div>
          <div><span style={{ color: '#81C784' }}>Income:</span> {fmt(tooltip.income)}</div>
          <div><span style={{ color: '#EF9A9A' }}>Expenses:</span> {fmt(tooltip.expenses)}</div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 2, marginTop: 2 }}>Net: {fmt(tooltip.income - tooltip.expenses)}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: THEME.textMed }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#43A047', display: 'inline-block' }}></span> Income
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: THEME.textMed }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#E53935', display: 'inline-block' }}></span> Expenses
        </span>
      </div>
    </div>
  )
}

function DonutChart({ segments, size = 140, label, centerValue }) {
  const [hover, setHover] = useState(null)
  const r = (size - 24) / 2
  const cx = size / 2, cy = size / 2
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  let cumAngle = -90

  const arcs = segments.map(seg => {
    const pct = total > 0 ? seg.value / total : 0
    const angle = pct * 360
    const startAngle = cumAngle
    cumAngle += angle
    const endAngle = cumAngle
    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180
    const largeArc = angle > 180 ? 1 : 0
    const x1 = cx + r * Math.cos(startRad), y1 = cy + r * Math.sin(startRad)
    const x2 = cx + r * Math.cos(endRad), y2 = cy + r * Math.sin(endRad)
    return { ...seg, pct, d: pct >= 0.999 ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx - r - 0.01} ${cy}` : `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}` }
  })

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={THEME.outline} strokeWidth={16} />
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={16} strokeLinecap="butt"
            onMouseEnter={() => setHover(arc)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer', opacity: hover && hover.label !== arc.label ? 0.4 : 1, transition: 'opacity .2s' }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: 16, fontWeight: 700, fill: THEME.text }}>{centerValue}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 9, fill: THEME.textMed }}>{label}</text>
      </svg>
      {hover && (
        <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none' }}>
          {hover.label}: {fmt(hover.value)} ({(hover.pct * 100).toFixed(1)}%)
        </div>
      )}
    </div>
  )
}

function SparkLine({ data, width = 100, height = 30, color: lineColor = '#43A047' }) {
  if (!data.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

function MiniLineChart({ data, width = 500, height = 160 }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data.length) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const chartL = 55, chartR = width - 10, chartH = height - 40

  const pts = data.map((d, i) => ({
    x: chartL + ((chartR - chartL) / (data.length - 1)) * i,
    y: 10 + chartH - (d.value / max) * chartH,
    ...d,
  }))
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        {[0, 0.5, 1].map(f => {
          const y = 10 + chartH * (1 - f)
          return (
            <g key={f}>
              <line x1={chartL} y1={y} x2={chartR} y2={y} stroke={THEME.outline} strokeWidth={0.5} />
              <text x={chartL - 6} y={y + 4} textAnchor="end" style={{ fontSize: 9, fill: THEME.textMed }}>{fmtK(max * f)}</text>
            </g>
          )
        })}
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        <polygon points={`${pts[0].x},${10 + chartH} ${polyline} ${pts[pts.length - 1].x},${10 + chartH}`} fill={color} opacity={0.08} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={tooltip?.month === p.month ? 5 : 3} fill={color} stroke={THEME.surface} strokeWidth={2}
            onMouseEnter={() => setTooltip(p)}
            onMouseLeave={() => setTooltip(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}
        {data.map((d, i) => (
          <text key={i} x={pts[i].x} y={height - 6} textAnchor="middle" style={{ fontSize: 10, fill: THEME.textMed }}>{d.month}</text>
        ))}
      </svg>
      {tooltip && (
        <div style={{
          position: 'absolute', top: Math.max(0, tooltip.y - 50), left: `${(tooltip.x / width) * 100}%`, transform: 'translateX(-50%)',
          background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none'
        }}>
          <div style={{ fontWeight: 600 }}>{tooltip.month}</div>
          <div>Net P&L: {fmt(tooltip.value)}</div>
        </div>
      )}
    </div>
  )
}

export default function FinanceDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [accounts, setAccounts] = useState([])
  const [entries, setEntries] = useState([])
  const [lines, setLines] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [statementLines, setStatementLines] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [acctRes, entryRes, lineRes, bankRes, stmtRes] = await Promise.all([
      supabase.from('accounts').select('id, code, name, account_type, sub_type, balance').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('journal_entries').select('id, entry_number, status, entry_date, description, created_at').eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }).limit(50),
      supabase.from('journal_lines').select('account_id, debit, credit, journal_entries!inner(site_id, status, entry_date, is_archived)').eq('journal_entries.site_id', currentSiteId).eq('journal_entries.status', 'posted').eq('journal_entries.is_archived', false),
      supabase.from('bank_accounts').select('id, name, current_balance, currency, is_active').eq('site_id', currentSiteId).eq('is_active', true),
      supabase.from('bank_statement_lines').select('id, is_reconciled, bank_account_id').eq('site_id', currentSiteId),
    ])
    if (acctRes.error) showToast('Failed to load accounts', 'error')
    setAccounts(acctRes.data || [])
    setEntries(entryRes.data || [])
    setLines(lineRes.data || [])
    setBankAccounts(bankRes.data || [])
    setStatementLines(stmtRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const stats = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()

    const byMonth = {}
    for (let m = 0; m < 12; m++) byMonth[m] = { income: 0, expenses: 0 }

    const acctMap = {}
    accounts.forEach(a => { acctMap[a.id] = a })

    lines.forEach(l => {
      const d = l.journal_entries?.entry_date
      if (!d) return
      const dt = new Date(d)
      if (dt.getFullYear() !== year) return
      const m = dt.getMonth()
      const a = acctMap[l.account_id]
      if (!a) return
      const debit = Number(l.debit || 0), credit = Number(l.credit || 0)
      if (a.account_type === 'Revenue') byMonth[m].income += (credit - debit)
      if (a.account_type === 'Expense') byMonth[m].expenses += (debit - credit)
    })

    const currentMonth = now.getMonth()
    const monthRevenue = byMonth[currentMonth].income
    const monthExpenses = byMonth[currentMonth].expenses
    const netPL = monthRevenue - monthExpenses

    const ytdRevenue = Object.values(byMonth).reduce((s, m) => s + m.income, 0)
    const ytdExpenses = Object.values(byMonth).reduce((s, m) => s + m.expenses, 0)

    const grossMargin = ytdRevenue > 0 ? ((ytdRevenue - ytdExpenses) / ytdRevenue) * 100 : 0
    const expenseRatio = ytdRevenue > 0 ? (ytdExpenses / ytdRevenue) * 100 : 0
    const netMargin = ytdRevenue > 0 ? ((ytdRevenue - ytdExpenses) / ytdRevenue) * 100 : 0

    const cashAccounts = accounts.filter(a => a.account_type === 'Asset' && ((a.sub_type || '').toLowerCase().includes('bank') || (a.sub_type || '').toLowerCase().includes('cash')))
    const cashPosition = cashAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)

    const totalAssets = accounts.filter(a => a.account_type === 'Asset').reduce((s, a) => s + Number(a.balance || 0), 0)
    const totalLiabilities = accounts.filter(a => a.account_type === 'Liability').reduce((s, a) => s + Number(a.balance || 0), 0)

    const pendingApprovals = entries.filter(e => e.status === 'draft').length
    const postedCount = entries.filter(e => e.status === 'posted').length
    const unreconciledCount = statementLines.filter(s => !s.is_reconciled).length

    const monthlyData = []
    for (let m = 0; m <= currentMonth; m++) {
      monthlyData.push({ month: MONTHS[m], income: byMonth[m].income, expenses: byMonth[m].expenses })
    }

    const netTrend = monthlyData.map(d => ({ month: d.month, value: d.income - d.expenses }))

    const revenueSparkline = monthlyData.map(d => d.income)
    const expenseSparkline = monthlyData.map(d => d.expenses)

    const recentEntries = entries.slice(0, 8)
    const pendingEntries = entries.filter(e => e.status === 'draft').slice(0, 5)

    const accountBreakdown = [
      { label: 'Assets', value: Math.abs(totalAssets), color: '#43A047' },
      { label: 'Liabilities', value: Math.abs(totalLiabilities), color: '#E53935' },
      { label: 'Equity', value: Math.abs(totalAssets - totalLiabilities), color: '#1565C0' },
    ].filter(s => s.value > 0)

    return {
      cashPosition, monthRevenue, monthExpenses, netPL,
      ytdRevenue, ytdExpenses, grossMargin, expenseRatio, netMargin,
      totalAssets, totalLiabilities,
      pendingApprovals, postedCount, unreconciledCount,
      monthlyData, netTrend, revenueSparkline, expenseSparkline,
      recentEntries, pendingEntries, accountBreakdown,
    }
  }, [accounts, entries, lines, statementLines])

  const Card = ({ children, style: s, onClick }) => (
    <div onClick={onClick} style={{ background: THEME.surface, borderRadius: 12, border: `1px solid ${THEME.outline}`, padding: '20px', cursor: onClick ? 'pointer' : 'default', ...s }}>{children}</div>
  )

  const CardTitle = ({ icon, children, action }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span className="material-symbols-rounded" style={{ fontSize: 18, color }}>{icon}</span>}
        <span style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>{children}</span>
      </div>
      {action}
    </div>
  )

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: THEME.text }}>Finance Dashboard</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{currentSite?.name || 'All Sites'} — {new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setPage('fi_journal_entries')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</span>New Entry
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 36, display: 'block', marginBottom: 8, animation: 'spin 1s linear infinite' }}>progress_activity</span>
          Loading dashboard…
        </div>
      ) : (
        <>
          {/* Row 1: KPI Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Card onClick={() => setPage('fi_balance_sheet')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Cash Position</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: stats.cashPosition >= 0 ? THEME.success : THEME.error }}>{fmtK(stats.cashPosition)}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>Total bank balance</div>
                </div>
                <span className="material-symbols-rounded" style={{ fontSize: 28, color, opacity: 0.3 }}>account_balance_wallet</span>
              </div>
            </Card>

            <Card onClick={() => setPage('fi_profit_and_loss')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Monthly Revenue</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: THEME.success }}>{fmtK(stats.monthRevenue)}</div>
                </div>
                <SparkLine data={stats.revenueSparkline} color="#43A047" />
              </div>
            </Card>

            <Card onClick={() => setPage('fi_profit_and_loss')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Monthly Expenses</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: THEME.error }}>{fmtK(stats.monthExpenses)}</div>
                </div>
                <SparkLine data={stats.expenseSparkline} color="#E53935" />
              </div>
            </Card>

            <Card onClick={() => setPage('fi_profit_and_loss')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Net P&L</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: stats.netPL >= 0 ? THEME.success : THEME.error }}>{fmtK(stats.netPL)}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>Current month</div>
                </div>
                <span className="material-symbols-rounded" style={{ fontSize: 28, color: stats.netPL >= 0 ? '#43A047' : '#E53935', opacity: 0.3 }}>{stats.netPL >= 0 ? 'trending_up' : 'trending_down'}</span>
              </div>
            </Card>
          </div>

          {/* Row 2: Gauges + Income/Expenses chart */}
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, marginBottom: 20, alignItems: 'stretch' }}>
            <Card>
              <CardTitle icon="speed">Financial Ratios</CardTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
                <GaugeChart value={stats.grossMargin} target={100} label="Gross Profit Margin" color="#43A047" size={110} />
                <GaugeChart value={Math.min(stats.expenseRatio, 100)} target={80} label="Expense Ratio" color="#FF9800" size={110} />
                <GaugeChart value={Math.max(stats.netMargin, 0)} target={50} label="Net Profit Margin" color="#1565C0" size={110} />
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: THEME.textMed, textAlign: 'center' }}>YTD Performance</div>
            </Card>

            <Card>
              <CardTitle icon="bar_chart">Income vs Expenses</CardTitle>
              <BarChart data={stats.monthlyData} />
            </Card>
          </div>

          {/* Row 3: Net P&L Trend + Account Breakdown + Bank Balances */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 1fr', gap: 16, marginBottom: 20 }}>
            <Card>
              <CardTitle icon="show_chart">Net P&L Trend</CardTitle>
              <MiniLineChart data={stats.netTrend} />
            </Card>

            <Card>
              <CardTitle icon="donut_large">Account Mix</CardTitle>
              <DonutChart
                segments={stats.accountBreakdown}
                label="Total"
                centerValue={fmtK(stats.totalAssets)}
                size={130}
              />
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {stats.accountBreakdown.map(s => (
                  <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }}></span>
                      <span style={{ color: THEME.textMed }}>{s.label}</span>
                    </span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtK(s.value)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardTitle icon="account_balance">Bank Balances</CardTitle>
              {bankAccounts.length === 0 ? (
                <div style={{ fontSize: 12, color: THEME.textMed, textAlign: 'center', padding: 20 }}>No bank accounts</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                      <th style={{ textAlign: 'left', padding: '6px 0', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Account</th>
                      <th style={{ textAlign: 'center', padding: '6px 0', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Currency</th>
                      <th style={{ textAlign: 'right', padding: '6px 0', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map(ba => (
                      <tr key={ba.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => setPage('fi_bank_accounts')}>
                        <td style={{ padding: '8px 0', fontWeight: 600, color: THEME.text }}>{ba.name}</td>
                        <td style={{ padding: '8px 0', textAlign: 'center', color: THEME.textMed }}>{ba.currency || 'USD'}</td>
                        <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: Number(ba.current_balance) >= 0 ? THEME.success : THEME.error }}>{fmt(Number(ba.current_balance || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {/* Row 4: Pending Actions + Recent Journal Entries */}
          <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, marginBottom: 20 }}>
            <Card>
              <CardTitle icon="pending_actions">Pending Actions</CardTitle>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div onClick={() => setPage('fi_journal_entries')} style={{ flex: 1, background: THEME.surfaceVar, borderRadius: 8, padding: '12px', textAlign: 'center', cursor: 'pointer' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#FF9800' }}>{stats.pendingApprovals}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 2 }}>Draft Entries</div>
                </div>
                <div onClick={() => setPage('fi_bank_accounts')} style={{ flex: 1, background: THEME.surfaceVar, borderRadius: 8, padding: '12px', textAlign: 'center', cursor: 'pointer' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#E53935' }}>{stats.unreconciledCount}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 2 }}>Unreconciled</div>
                </div>
              </div>
              {stats.pendingEntries.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Drafts Awaiting Approval</div>
                  {stats.pendingEntries.map(e => (
                    <div key={e.id} onClick={() => setPage(`fi_journal_detail:${e.id}`)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontSize: 12 }}>
                      <div>
                        <span style={{ fontWeight: 600, color }}>{e.entry_number}</span>
                        <span style={{ color: THEME.textMed, marginLeft: 6 }}>{e.description || 'No description'}</span>
                      </div>
                      <span style={{ fontSize: 10, color: THEME.textMed }}>{e.entry_date}</span>
                    </div>
                  ))}
                </>
              )}
            </Card>

            <Card>
              <CardTitle
                icon="receipt_long"
                action={<button onClick={() => setPage('fi_journal_entries')} style={{ fontSize: 11, color, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>View All →</button>}
              >
                Recent Journal Entries
              </CardTitle>
              {stats.recentEntries.length === 0 ? (
                <div style={{ fontSize: 12, color: THEME.textMed, textAlign: 'center', padding: 20 }}>No entries yet</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Entry</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Description</th>
                        <th style={{ textAlign: 'center', padding: '6px 8px', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Status</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: THEME.textMed, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentEntries.map(e => {
                        const statusColors = { draft: { bg: THEME.statusWarningBg, text: THEME.statusWarningText }, posted: { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText }, void: { bg: THEME.statusErrorBg, text: THEME.statusErrorText } }
                        const sc = statusColors[e.status] || statusColors.draft
                        return (
                          <tr key={e.id} onClick={() => setPage(`fi_journal_detail:${e.id}`)} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}>
                            <td style={{ padding: '8px', fontWeight: 600, color }}>{e.entry_number}</td>
                            <td style={{ padding: '8px', color: THEME.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description || '—'}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.text, textTransform: 'capitalize' }}>{e.status}</span>
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{e.entry_date}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Row 5: Quick Links */}
          <Card>
            <CardTitle icon="grid_view">Quick Navigation</CardTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {[
                { icon: 'account_balance', label: 'Chart of Accounts', page: 'fi_chart_of_accounts' },
                { icon: 'receipt_long', label: 'Journal Entries', page: 'fi_journal_entries' },
                { icon: 'account_balance_wallet', label: 'Bank Accounts', page: 'fi_bank_accounts' },
                { icon: 'balance', label: 'Trial Balance', page: 'fi_trial_balance' },
                { icon: 'trending_up', label: 'Profit & Loss', page: 'fi_profit_and_loss' },
                { icon: 'account_tree', label: 'Balance Sheet', page: 'fi_balance_sheet' },
                { icon: 'water_drop', label: 'Cash Flow', page: 'fi_cash_flow' },
                { icon: 'category', label: 'Cost Centres', page: 'fi_cost_centres' },
                { icon: 'bar_chart', label: 'Cost Report', page: 'fi_cost_report' },
              ].map(link => (
                <button key={link.page} onClick={() => setPage(link.page)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  background: THEME.surfaceVar, border: 'none', borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: THEME.text,
                  transition: 'background .15s',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18, color }}>{link.icon}</span>
                  {link.label}
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

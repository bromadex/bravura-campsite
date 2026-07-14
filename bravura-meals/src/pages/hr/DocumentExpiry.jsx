import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, PageHeader, Button, showToast } from '../../components/ui'
import { DashCard, KpiCard, DonutGauge, SectionTitle } from '../../components/dash'

const ACCENT = MODULE_COLORS.workforce
const DAY = 24 * 60 * 60 * 1000

function daysLeft(expiry) {
  return Math.floor((new Date(expiry) - new Date()) / DAY)
}

function statusOf(days) {
  if (days < 0) return 'expired'
  if (days <= 30) return 'expiring'
  return 'valid'
}

const STATUS_META = {
  valid:    { label: 'Valid',    color: THEME.success },
  expiring: { label: 'Expiring', color: THEME.warning },
  expired:  { label: 'Expired',  color: THEME.error },
}

export default function DocumentExpiry({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState([])
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('employee_documents')
        .select('id, file_name, issue_date, expiry_date, is_verified, document_type:document_types(id, name), employee:employees(id, name, employee_number, status, is_archived)')
        .eq('site_id', currentSiteId)
        .eq('is_archived', false)
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true })
      if (error) throw error
      setDocs((data || []).filter(d => d.employee && !d.employee.is_archived))
    } catch (err) {
      console.error('DocumentExpiry fetch:', err)
      showToast('Failed to load document expiry data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetch()
  }, [currentSiteId, fetch])

  const rows = useMemo(() => docs.map(d => {
    const days = daysLeft(d.expiry_date)
    return { doc: d, days, status: statusOf(days) }
  }), [docs])

  const docTypes = useMemo(() => {
    const names = new Set(rows.map(r => r.doc.document_type?.name).filter(Boolean))
    return [...names].sort()
  }, [rows])

  const kpis = useMemo(() => ({
    total: rows.length,
    expiring30: rows.filter(r => r.days >= 0 && r.days <= 30).length,
    expiring90: rows.filter(r => r.days >= 0 && r.days <= 90).length,
    expired: rows.filter(r => r.status === 'expired').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(({ doc, status }) => {
      if (typeFilter && (doc.document_type?.name || '') !== typeFilter) return false
      if (statusFilter && status !== statusFilter) return false
      if (q && !(doc.employee?.name || '').toLowerCase().includes(q)
            && !(doc.employee?.employee_number || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, typeFilter, statusFilter, search])

  const handleExport = useCallback(() => {
    const headers = ['Employee #', 'Employee', 'Document Type', 'File Name', 'Issue Date', 'Expiry Date', 'Days Remaining', 'Status', 'Verified']
    const rowsOut = filtered.map(({ doc, days, status }) => [
      doc.employee?.employee_number || '', doc.employee?.name || '',
      doc.document_type?.name || '', doc.file_name || '',
      doc.issue_date || '', doc.expiry_date, days, STATUS_META[status].label,
      doc.is_verified ? 'Yes' : 'No',
    ])
    exportCsv(`document_expiry_${new Date().toISOString().slice(0, 10)}.csv`, headers, rowsOut)
  }, [filtered])

  if (!can('hr.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view the document expiry register.
        </div>
      </Card>
    )
  }

  const selectStyle = { padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px' }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const td = { padding: '8px 10px', color: THEME.text }

  const validCount = kpis.total - kpis.expired - kpis.expiring30
  const validPct = kpis.total > 0 ? (validCount / kpis.total) * 100 : null

  return (
    <div>
      <PageHeader title="Document Expiry Register" site={currentSite} />

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input placeholder="Search name or number..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...selectStyle, minWidth: '200px' }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="">All document types</option>
          {docTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">All statuses</option>
          <option value="valid">Valid</option>
          <option value="expiring">Expiring (30 days)</option>
          <option value="expired">Expired</option>
        </select>
        <Button icon="download" onClick={handleExport} style={{ marginLeft: 'auto' }}>Export CSV</Button>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <KpiCard label="Documents Tracked" value={kpis.total} icon="folder" accent={ACCENT} />
            <KpiCard label="Expiring in 30 Days" value={kpis.expiring30} icon="schedule" accent={THEME.warning}
              progress={kpis.total > 0 ? (kpis.expiring30 / kpis.total) * 100 : undefined} />
            <KpiCard label="Expiring in 90 Days" value={kpis.expiring90} icon="event" accent={THEME.info}
              progress={kpis.total > 0 ? (kpis.expiring90 / kpis.total) * 100 : undefined} />
            <KpiCard label="Expired" value={kpis.expired} icon="error" accent={THEME.error}
              progress={kpis.total > 0 ? (kpis.expired / kpis.total) * 100 : undefined} />
          </div>

          {/* Validity gauge */}
          <DashCard style={{ marginBottom: '18px' }}>
            <SectionTitle title="Document Validity" subtitle="Share of tracked documents not expired or due within 30 days" />
            <DonutGauge
              pct={validPct}
              color={THEME.success}
              label="valid"
              legend={[
                [THEME.success, `Valid ${validCount}`],
                [THEME.warning, `Expiring 30d ${kpis.expiring30}`],
                [THEME.error, `Expired ${kpis.expired}`],
              ]}
            />
          </DashCard>

          <DashCard>
            <SectionTitle title={`Expiring Documents (${filtered.length})`} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    {['Employee #', 'Employee', 'Document Type', 'File Name', 'Expiry Date', 'Days Remaining', 'Status'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} style={{ ...td, color: THEME.textMed, textAlign: 'center', padding: '20px' }}>No documents match the filters.</td></tr>
                  )}
                  {filtered.map(({ doc, days, status }) => {
                    const meta = STATUS_META[status]
                    return (
                      <tr key={doc.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={td}>{doc.employee?.employee_number || '-'}</td>
                        <td style={td}>{doc.employee?.name || '-'}</td>
                        <td style={td}>{doc.document_type?.name || '-'}</td>
                        <td style={{ ...td, color: THEME.textMed }}>{doc.file_name || '-'}</td>
                        <td style={{ ...td, color: meta.color }}>{doc.expiry_date}</td>
                        <td style={{ ...td, color: meta.color, fontWeight: 600 }}>{days < 0 ? `${Math.abs(days)} overdue` : days}</td>
                        <td style={td}>
                          <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, color: meta.color, background: meta.color + '18' }}>
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </DashCard>
        </>
      )}
    </div>
  )
}

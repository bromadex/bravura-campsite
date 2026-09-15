import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const LIKELIHOOD_LABELS = { 1: 'Rare', 2: 'Unlikely', 3: 'Possible', 4: 'Likely', 5: 'Almost Certain' }
const SEVERITY_LABELS = { 1: 'Insignificant', 2: 'Minor', 3: 'Moderate', 4: 'Major', 5: 'Catastrophic' }
const LEVELS = ['low', 'medium', 'high', 'critical']
const LEVEL_COLORS = { low: '#2E7D32', medium: '#F59E0B', high: '#E65100', critical: '#D32F2F' }
const LEVEL_BG = { low: '#2E7D3220', medium: '#F59E0B20', high: '#E6510020', critical: '#D32F2F20' }
const LEVEL_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

export default function SheqRiskMatrix({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [matrix, setMatrix] = useState([])
  const [riskStats, setRiskStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState(null) // {likelihood, severity}
  const [dirty, setDirty] = useState({}) // key -> new level
  const [saving, setSaving] = useState(false)

  const canEdit = can('sheq.edit')

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data: matrixData, error: mErr }, { data: regData, error: rErr }] = await Promise.all([
      supabase
        .from('sheq_risk_matrix')
        .select('*')
        .eq('site_id', currentSiteId),
      supabase
        .from('sheq_risk_register')
        .select('risk_level')
        .eq('site_id', currentSiteId)
        .is('is_archived', false),
    ])
    if (mErr) showToast(mErr.message, 'error')
    else setMatrix(matrixData || [])
    if (rErr) showToast(rErr.message, 'error')
    else {
      const stats = {}
      ;(regData || []).forEach(r => {
        const lv = r.risk_level || 'unknown'
        stats[lv] = (stats[lv] || 0) + 1
      })
      setRiskStats(stats)
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData])

  // Build lookup: "L-S" -> row
  const matrixMap = useMemo(() => {
    const m = {}
    matrix.forEach(r => { m[`${r.likelihood}-${r.severity}`] = r })
    // Also apply dirty overrides
    Object.entries(dirty).forEach(([key, level]) => {
      if (m[key]) m[key] = { ...m[key], risk_level: level }
    })
    return m
  }, [matrix, dirty])

  function getCell(l, s) {
    const key = `${l}-${s}`
    const row = matrixMap[key]
    return {
      score: l * s,
      level: row?.risk_level || getDefaultLevel(l * s),
      id: row?.id,
      key,
    }
  }

  function getDefaultLevel(score) {
    if (score <= 4) return 'low'
    if (score <= 9) return 'medium'
    if (score <= 16) return 'high'
    return 'critical'
  }

  function handleCellClick(l, s) {
    if (!canEdit) return
    const key = `${l}-${s}`
    if (editingCell === key) {
      setEditingCell(null)
    } else {
      setEditingCell(key)
    }
  }

  function handleLevelChange(key, newLevel) {
    setDirty(prev => ({ ...prev, [key]: newLevel }))
    setEditingCell(null)
  }

  async function handleSave() {
    if (Object.keys(dirty).length === 0) {
      showToast('No changes to save'); return
    }
    setSaving(true)
    try {
      for (const [key, level] of Object.entries(dirty)) {
        const [likelihood, severity] = key.split('-').map(Number)
        const existing = matrix.find(r => r.likelihood === likelihood && r.severity === severity)
        if (existing) {
          const { error } = await supabase
            .from('sheq_risk_matrix')
            .update({ risk_level: level, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .eq('site_id', currentSiteId)
          if (error) throw error
        } else {
          const { error } = await supabase
            .from('sheq_risk_matrix')
            .insert({
              site_id: currentSiteId,
              likelihood,
              severity,
              risk_level: level,
              risk_score: likelihood * severity,
            })
          if (error) throw error
        }
      }
      showToast('Risk matrix saved')
      setDirty({})
      fetchData()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!can('sheq.view')) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_matrix" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view the risk matrix.</p>
        </Card>
      </div>
    )
  }

  const hasDirty = Object.keys(dirty).length > 0

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_matrix" />

      <PageHeader
        title="Risk Matrix Configuration"
        actions={
          canEdit && hasDirty ? (
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          ) : null
        }
      />

      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading risk matrix...</div>
        </Card>
      ) : (
        <>
          {/* Risk stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {LEVELS.map(lv => (
              <Card key={lv} style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: LEVEL_COLORS[lv] }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>{LEVEL_LABELS[lv]} Risks</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: THEME.text }}>{riskStats[lv] || 0}</div>
              </Card>
            ))}
          </div>

          {/* Matrix grid */}
          <Card style={{ padding: '24px', overflow: 'visible' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <Icon name="grid_on" size={20} style={{ color: ACCENT }} />
              <span style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>5 x 5 Risk Matrix</span>
              {canEdit && <span style={{ fontSize: '11px', color: THEME.textMed, marginLeft: '8px' }}>Click a cell to change its classification</span>}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'inline-block', minWidth: '520px' }}>
                {/* Header row - severity labels */}
                <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '4px', marginBottom: '4px' }}>
                  <div />
                  {[1, 2, 3, 4, 5].map(s => (
                    <div key={s} style={{ textAlign: 'center', padding: '8px 4px', fontSize: '10px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', lineHeight: 1.3 }}>
                      {s}<br />{SEVERITY_LABELS[s]}
                    </div>
                  ))}
                </div>

                {/* Severity axis label */}
                <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '8px', paddingLeft: '120px' }}>
                  Severity &rarr;
                </div>

                {/* Matrix rows (likelihood 5 at top, 1 at bottom) */}
                {[5, 4, 3, 2, 1].map(l => (
                  <div key={l} style={{ display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '4px', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '10px', fontSize: '10px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', lineHeight: 1.3, textAlign: 'right' }}>
                      {l} - {LIKELIHOOD_LABELS[l]}
                    </div>
                    {[1, 2, 3, 4, 5].map(s => {
                      const cell = getCell(l, s)
                      const isEditing = editingCell === cell.key
                      const isDirty = dirty[cell.key] !== undefined
                      return (
                        <div
                          key={s}
                          onClick={() => handleCellClick(l, s)}
                          style={{
                            position: 'relative',
                            background: LEVEL_COLORS[cell.level] + (canEdit ? '30' : '25'),
                            border: `2px solid ${isDirty ? ACCENT : LEVEL_COLORS[cell.level] + '60'}`,
                            borderRadius: '10px',
                            padding: '14px 8px',
                            textAlign: 'center',
                            cursor: canEdit ? 'pointer' : 'default',
                            transition: 'all .15s',
                            minHeight: '60px',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <div style={{ fontSize: '20px', fontWeight: 700, color: LEVEL_COLORS[cell.level] }}>{cell.score}</div>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: LEVEL_COLORS[cell.level], textTransform: 'uppercase', marginTop: '2px' }}>
                            {LEVEL_LABELS[cell.level]}
                          </div>
                          {isDirty && (
                            <div style={{ position: 'absolute', top: '4px', right: '6px', width: '6px', height: '6px', borderRadius: '50%', background: ACCENT }} />
                          )}

                          {/* Dropdown for editing */}
                          {isEditing && canEdit && (
                            <div
                              onClick={e => e.stopPropagation()}
                              style={{
                                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                                zIndex: 100, background: THEME.surface, borderRadius: '10px',
                                boxShadow: THEME.shadow3, padding: '6px', marginTop: '4px',
                                minWidth: '110px',
                              }}
                            >
                              {LEVELS.map(lv => (
                                <button
                                  key={lv}
                                  onClick={() => handleLevelChange(cell.key, lv)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                                    padding: '7px 10px', border: 'none', borderRadius: '6px',
                                    background: cell.level === lv ? LEVEL_COLORS[lv] + '20' : 'transparent',
                                    cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px',
                                    fontWeight: cell.level === lv ? 700 : 500,
                                    color: LEVEL_COLORS[lv],
                                    transition: 'background .1s',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = LEVEL_COLORS[lv] + '15'}
                                  onMouseLeave={e => e.currentTarget.style.background = cell.level === lv ? LEVEL_COLORS[lv] + '20' : 'transparent'}
                                >
                                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: LEVEL_COLORS[lv] }} />
                                  {LEVEL_LABELS[lv]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}

                {/* Likelihood axis label */}
                <div style={{ textAlign: 'right', fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: '4px', width: '120px' }}>
                  &uarr; Likelihood
                </div>
              </div>
            </div>
          </Card>

          {/* Legend */}
          <Card style={{ padding: '20px', marginTop: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, marginBottom: '12px' }}>Legend</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {[
                { level: 'low', desc: 'Acceptable risk. Monitor and review periodically.' },
                { level: 'medium', desc: 'Tolerable with controls. Review within 30 days.' },
                { level: 'high', desc: 'Significant risk. Implement controls promptly.' },
                { level: 'critical', desc: 'Intolerable. Immediate action required. Stop work.' },
              ].map(item => (
                <div key={item.level} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '14px', height: '14px', borderRadius: '4px', flexShrink: 0, marginTop: '2px',
                    background: LEVEL_COLORS[item.level],
                  }} />
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: LEVEL_COLORS[item.level], textTransform: 'uppercase' }}>
                      {LEVEL_LABELS[item.level]}
                    </div>
                    <div style={{ fontSize: '11px', color: THEME.textMed, lineHeight: 1.4 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

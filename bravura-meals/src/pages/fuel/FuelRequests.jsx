import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, showToast } from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel

// ── Badge helpers ─────────────────────────────────────────────────────────────

const STATUS_META = {
  pending:   { label: 'Pending',   bg: THEME.statusWarningBg,  text: THEME.statusWarningText,  icon: 'schedule'       },
  approved:  { label: 'Approved',  bg: THEME.statusInfoBg,     text: THEME.statusInfoText,     icon: 'check_circle'   },
  rejected:  { label: 'Rejected',  bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    icon: 'cancel'         },
  issued:    { label: 'Issued',    bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  icon: 'local_shipping' },
  cancelled: { label: 'Cancelled', bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  icon: 'block'          },
}

const PRIORITY_META = {
  normal:    { label: 'Normal',    color: THEME.textMed,  icon: 'circle'         },
  urgent:    { label: 'Urgent',    color: THEME.warning,  icon: 'warning'        },
  emergency: { label: 'Emergency', color: THEME.error,    icon: 'emergency_home' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px',
      background: m.bg, color: m.text,
      fontSize: '11px', fontWeight: 600,
    }}>
      <Icon name={m.icon} size={12} style={{ color: m.text }} />
      {m.label}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.normal
  if (priority === 'normal') return <span style={{ fontSize: '12px', color: THEME.textLow }}>—</span>
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '6px',
      background: m.color + '18', color: m.color,
      fontSize: '11px', fontWeight: 600,
    }}>
      <Icon name={m.icon} size={11} style={{ color: m.color }} />
      {m.label}
    </span>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inpStyle = {
  padding: '8px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}
const selStyle = { ...inpStyle, cursor: 'pointer' }

// ── Approve modal ─────────────────────────────────────────────────────────────

function ApproveModal({ req, onConfirm, onClose, saving }) {
  const [note, setNote] = useState('')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: THEME.surface, borderRadius: '14px', padding: '28px 32px',
          width: '480px', maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: THEME.statusInfoBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check_circle" size={20} style={{ color: THEME.statusInfoText }} />
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Approve Request</div>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>{req.request_number}</div>
          </div>
        </div>

        <div style={{ background: THEME.surfaceVar, borderRadius: '12px', padding: '14px 16px', marginBottom: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              ['Requested By', req.requested_by_profile?.full_name || '—'],
              ['Asset', req.fleet_asset?.fleet_number || req.fleet_asset?.asset_number || req.fleet_asset?.description || '—'],
              ['Fuel Type', req.fuel_types?.name || '—'],
              ['Quantity', `${Number(req.quantity_requested).toLocaleString()} L`],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text, marginTop: '2px' }}>{value}</div>
              </div>
            ))}
          </div>
          {req.intended_use && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>Intended Use</div>
              <div style={{ fontSize: '13px', color: THEME.text, marginTop: '2px' }}>{req.intended_use}</div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Approval Note <span style={{ color: THEME.textLow, fontWeight: 400, textTransform: 'none' }}>(optional)</span>
          </label>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder="Any instructions for the issuer…"
            rows={2}
            style={{ ...inpStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: '14px', borderRadius: '12px', padding: '10px 14px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '12px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onConfirm(note.trim())} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: '12px', border: 'none', background: saving ? THEME.outline : FUEL_CLR, color: '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? <><Icon name="progress_activity" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Approving…</> : <><Icon name="check_circle" size={15} /> Approve</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reject modal ──────────────────────────────────────────────────────────────

function RejectModal({ req, onConfirm, onClose, saving }) {
  const [reason, setReason] = useState('')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: THEME.surface, borderRadius: '14px', padding: '28px 32px',
          width: '440px', maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: THEME.statusErrorBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="cancel" size={20} style={{ color: THEME.statusErrorText }} />
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Reject Request</div>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>{req.request_number}</div>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Reason <span style={{ color: THEME.error }}>*</span>
          </label>
          <textarea
            autoFocus value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Explain why this request is being rejected…" rows={3}
            style={{ ...inpStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: '14px', borderRadius: '12px', padding: '10px 14px', border: `1px solid ${reason.trim() ? THEME.outline : THEME.error}` }}
          />
          {!reason.trim() && <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px' }}>A reason is required</div>}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '12px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={saving || !reason.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: '12px', border: 'none', background: saving || !reason.trim() ? THEME.outline : THEME.error, color: '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: saving || !reason.trim() ? 'not-allowed' : 'pointer' }}>
            {saving ? <><Icon name="progress_activity" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Rejecting…</> : <><Icon name="cancel" size={15} /> Reject</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail slide-over ─────────────────────────────────────────────────────────

function DetailPanel({ req, onClose, onApprove, onReject, onIssue, canApprove, canIssue }) {
  if (!req) return null
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 100,
        width: '380px', background: THEME.surface,
        borderLeft: `1px solid ${THEME.outlineVar}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,.08)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text, fontFamily: 'monospace' }}>{req.request_number}</div>
            <StatusBadge status={req.status} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {[
            ['Requested By', req.requested_by_profile?.full_name || '—'],
            ['Date', new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
            ['Asset', req.fleet_asset ? `${req.fleet_asset.fleet_number || req.fleet_asset.asset_number || ''}${req.fleet_asset.registration ? ' (' + req.fleet_asset.registration + ')' : ''}`.trim() || req.fleet_asset.description || '—' : '—'],
            ['Fuel Type', req.fuel_types?.name || '—'],
            ['Quantity Requested', `${Number(req.quantity_requested).toLocaleString()} L`],
            ['Intended Use', req.intended_use || '—'],
            ['Priority', <PriorityBadge key="p" priority={req.priority} />],
          ].map(([label, value]) => (
            <div key={label} style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>{label}</div>
              <div style={{ fontSize: '13px', color: THEME.text }}>{value}</div>
            </div>
          ))}

          {req.notes && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>Notes</div>
              <div style={{ fontSize: '13px', color: THEME.text }}>{req.notes}</div>
            </div>
          )}

          {req.status === 'approved' && req.approved_by_profile && (
            <div style={{ background: THEME.statusInfoBg, borderRadius: '10px', padding: '12px', marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.statusInfoText, marginBottom: '4px' }}>Approved by {req.approved_by_profile.full_name}</div>
              <div style={{ fontSize: '11px', color: THEME.statusInfoText }}>{new Date(req.approved_at).toLocaleString('en-GB')}</div>
            </div>
          )}

          {req.status === 'rejected' && req.rejected_reason && (
            <div style={{ background: THEME.statusErrorBg, borderRadius: '10px', padding: '12px', marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.statusErrorText, marginBottom: '2px' }}>Rejection Reason</div>
              <div style={{ fontSize: '12px', color: THEME.statusErrorText }}>{req.rejected_reason}</div>
            </div>
          )}
        </div>

        {(req.status === 'pending' && canApprove) && (
          <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', gap: '10px' }}>
            <button onClick={() => onReject(req)} style={{ flex: 1, padding: '10px', borderRadius: '12px', border: `1px solid ${THEME.error}55`, background: THEME.statusErrorBg, color: THEME.error, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Icon name="cancel" size={15} /> Reject
            </button>
            <button onClick={() => onApprove(req)} style={{ flex: 1, padding: '10px', borderRadius: '12px', border: 'none', background: FUEL_CLR, color: '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Icon name="check_circle" size={15} /> Approve
            </button>
          </div>
        )}
        {(req.status === 'approved' && canIssue) && (
          <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}` }}>
            <button onClick={() => onIssue(req)} style={{ width: '100%', padding: '11px', borderRadius: '12px', border: 'none', background: FUEL_CLR, color: '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Icon name="output" size={16} /> Issue Fuel Against This Request
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Request card (for card view) ─────────────────────────────────────────────

function RequestCard({ req, onClick, canApprove, canIssue, onApprove, onReject, onIssue }) {
  const s = STATUS_META[req.status] || STATUS_META.pending
  const asset = req.fleet_asset
    ? `${req.fleet_asset.fleet_number || req.fleet_asset.asset_number || ''}${req.fleet_asset.registration ? ' · ' + req.fleet_asset.registration : ''}`.trim() || req.fleet_asset.description || '—'
    : '—'

  return (
    <div
      onClick={onClick}
      style={{
        background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '12px', padding: '16px', cursor: 'pointer',
        transition: 'box-shadow .15s, border-color .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = FUEL_CLR + '55'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = THEME.outlineVar; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.04)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, color: FUEL_CLR }}>{req.request_number}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
            {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <StatusBadge status={req.status} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <Icon name="person" size={14} style={{ color: THEME.textLow }} />
        <span style={{ fontSize: '13px', color: THEME.text, fontWeight: 500 }}>{req.requested_by_profile?.full_name || '—'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <Icon name={req.fleet_asset ? 'directions_car' : 'construction'} size={14} style={{ color: THEME.textLow }} />
        <span style={{ fontSize: '12px', color: THEME.textMed }}>{asset}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${THEME.outlineVar}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="local_gas_station" size={14} style={{ color: FUEL_CLR }} />
          <span style={{ fontSize: '14px', fontWeight: 700, color: THEME.text }}>{Number(req.quantity_requested).toLocaleString()} L</span>
          <span style={{ fontSize: '11px', color: THEME.textLow, marginLeft: '4px' }}>{req.fuel_types?.name || ''}</span>
        </div>
        <PriorityBadge priority={req.priority} />
      </div>

      {req.status === 'pending' && canApprove && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onReject(req)} style={{ flex: 1, padding: '7px', borderRadius: '8px', border: `1px solid ${THEME.error}44`, background: THEME.statusErrorBg, color: THEME.error, fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Icon name="close" size={12} /> Reject
          </button>
          <button onClick={() => onApprove(req)} style={{ flex: 1, padding: '7px', borderRadius: '8px', border: 'none', background: FUEL_CLR, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Icon name="check" size={12} /> Approve
          </button>
        </div>
      )}
      {req.status === 'approved' && canIssue && (
        <div style={{ marginTop: '10px' }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onIssue(req)} style={{ width: '100%', padding: '7px', borderRadius: '8px', border: 'none', background: FUEL_CLR, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Icon name="output" size={12} /> Issue
          </button>
        </div>
      )}
    </div>
  )
}

// ── Section with its own search ──────────────────────────────────────────────

function RequestSection({ title, icon, iconColor, rows, view, setDetailReq, canApprove, canIssue, onApprove, onReject, onIssue }) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r => {
      const hay = [
        r.request_number, r.requested_by_profile?.full_name,
        r.fleet_asset?.fleet_number, r.fleet_asset?.asset_number, r.fleet_asset?.description,
        r.fuel_types?.name, r.notes, r.intended_use,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search])

  if (rows.length === 0) return null

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Icon name={icon} size={18} style={{ color: iconColor }} />
          <span style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{title}</span>
          <span style={{ fontSize: '12px', color: THEME.textLow, fontWeight: 400 }}>({rows.length})</span>
          <Icon name={collapsed ? 'expand_more' : 'expand_less'} size={18} style={{ color: THEME.textLow }} />
        </button>
        {!collapsed && rows.length > 3 && (
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ ...inpStyle, paddingLeft: '30px', width: '200px', fontSize: '12px' }}
            />
          </div>
        )}
      </div>

      {!collapsed && (
        view === 'cards' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
            {filtered.map(req => (
              <RequestCard
                key={req.id} req={req}
                onClick={() => setDetailReq(req)}
                canApprove={canApprove} canIssue={canIssue}
                onApprove={onApprove} onReject={onReject} onIssue={onIssue}
              />
            ))}
          </div>
        ) : (
          <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  {['Request No', 'Date', 'Requested By', 'Asset', 'Fuel Type', 'Qty (L)', 'Priority', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Qty (L)' ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((req, i) => {
                  const asset = req.fleet_asset?.fleet_number || req.fleet_asset?.asset_number || req.fleet_asset?.description || '—'
                  const isHighPriority = req.priority !== 'normal'
                  const rowBg = req.status === 'pending' && isHighPriority
                    ? (req.priority === 'emergency' ? THEME.error + '08' : THEME.warning + '08')
                    : 'transparent'
                  return (
                    <tr key={req.id} onClick={() => setDetailReq(req)}
                      style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none', background: rowBg, cursor: 'pointer', transition: 'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}
                    >
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, color: FUEL_CLR, whiteSpace: 'nowrap' }}>{req.request_number}</td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: THEME.text }}>{req.requested_by_profile?.full_name || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: THEME.text, whiteSpace: 'nowrap' }}>{asset}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: THEME.text }}>{req.fuel_types?.name || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: THEME.text, textAlign: 'right', fontFamily: 'monospace' }}>{Number(req.quantity_requested).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td style={{ padding: '10px 14px' }}><PriorityBadge priority={req.priority} /></td>
                      <td style={{ padding: '10px 14px' }}><StatusBadge status={req.status} /></td>
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {req.status === 'pending' && canApprove && (
                            <>
                              <button onClick={() => onApprove(req)} title="Approve" style={{ padding: '5px 10px', borderRadius: '8px', border: 'none', background: FUEL_CLR, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Icon name="check" size={13} /> Approve
                              </button>
                              <button onClick={() => onReject(req)} title="Reject" style={{ padding: '5px 10px', borderRadius: '8px', border: `1px solid ${THEME.error}55`, background: THEME.statusErrorBg, color: THEME.error, fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Icon name="close" size={13} /> Reject
                              </button>
                            </>
                          )}
                          {req.status === 'approved' && canIssue && (
                            <button onClick={() => onIssue(req)} title="Issue fuel" style={{ padding: '5px 10px', borderRadius: '8px', border: 'none', background: FUEL_CLR, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Icon name="output" size={13} /> Issue
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {!collapsed && search && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px', color: THEME.textLow, fontSize: '13px' }}>
          No matches for "{search}"
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FuelRequests({ setPage }) {
  const { can }           = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile }       = useAuth()

  const [requests,      setRequests]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [actionSaving,  setActionSaving]  = useState(false)
  const [view,          setView]          = useState('cards')

  // Global filters
  const [globalSearch,    setGlobalSearch]    = useState('')
  const [filterPriority,  setFilterPriority]  = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [dateTo,          setDateTo]          = useState('')

  // Modal state
  const [approveTarget, setApproveTarget] = useState(null)
  const [rejectTarget,  setRejectTarget]  = useState(null)
  const [detailReq,     setDetailReq]     = useState(null)

  const canApprove = can('fuel.approve')
  const canIssue   = can('fuel.create')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fuel_requests')
      .select(`
        *,
        requested_by_profile:profiles!fuel_requests_requested_by_fkey(id, full_name),
        approved_by_profile:profiles!fuel_requests_approved_by_fkey(id, full_name),
        fuel_types(id, name, code),
        fleet_asset:fleet_assets(id, asset_number, fleet_number, registration, description, serial_number)
      `)
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); showToast('Failed to load requests', 'red') }
    setRequests(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  // Apply global filters to all requests first
  const globalFiltered = useMemo(() => {
    return requests.filter(r => {
      if (filterPriority !== 'all' && r.priority !== filterPriority) return false
      if (dateFrom && r.created_at.slice(0, 10) < dateFrom) return false
      if (dateTo   && r.created_at.slice(0, 10) > dateTo)   return false
      if (globalSearch) {
        const q = globalSearch.toLowerCase()
        const hay = [
          r.request_number, r.requested_by_profile?.full_name,
          r.fleet_asset?.fleet_number, r.fleet_asset?.asset_number, r.fleet_asset?.description,
          r.fuel_types?.name,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [requests, filterPriority, dateFrom, dateTo, globalSearch])

  // Split by status groups
  const pending   = useMemo(() => globalFiltered.filter(r => r.status === 'pending'), [globalFiltered])
  const approved  = useMemo(() => globalFiltered.filter(r => r.status === 'approved'), [globalFiltered])
  const issued    = useMemo(() => globalFiltered.filter(r => r.status === 'issued'), [globalFiltered])
  const rejected  = useMemo(() => globalFiltered.filter(r => r.status === 'rejected'), [globalFiltered])
  const cancelled = useMemo(() => globalFiltered.filter(r => r.status === 'cancelled'), [globalFiltered])

  const pendingCount = requests.filter(r => r.status === 'pending').length

  async function handleApprove(note) {
    if (!approveTarget) return
    setActionSaving(true)
    try {
      const { error } = await supabase
        .from('fuel_requests')
        .update({ status: 'approved', approved_by: profile.id, approved_at: new Date().toISOString(), notes: note || null })
        .eq('id', approveTarget.id)
      if (error) throw error
      showToast(`Request ${approveTarget.request_number} approved`, 'green')
      setApproveTarget(null); setDetailReq(null)
      await load()
    } catch (err) {
      showToast(err.message || 'Failed to approve', 'red')
    } finally { setActionSaving(false) }
  }

  async function handleReject(reason) {
    if (!rejectTarget) return
    setActionSaving(true)
    try {
      const { error } = await supabase
        .from('fuel_requests')
        .update({ status: 'rejected', rejected_reason: reason })
        .eq('id', rejectTarget.id)
      if (error) throw error
      showToast(`Request ${rejectTarget.request_number} rejected`, 'red')
      setRejectTarget(null); setDetailReq(null)
      await load()
    } catch (err) {
      showToast(err.message || 'Failed to reject', 'red')
    } finally { setActionSaving(false) }
  }

  function handleIssue(req) {
    sessionStorage.setItem('fuel_request_prefill', JSON.stringify({
      request_id: req.id, request_number: req.request_number,
      fleet_asset_id: req.fleet_asset_id || null,
      quantity_requested: req.quantity_requested, fuel_type_id: req.fuel_type_id,
    }))
    setPage('fuel_issuance')
  }

  if (!can('fuel.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p style={{ fontSize: '14px' }}>You do not have access to Fuel.</p>
    </div>
  )

  const hasGlobalFilters = globalSearch || filterPriority !== 'all' || dateFrom || dateTo

  // Shared section props
  const sectionProps = { view, setDetailReq, canApprove, canIssue, onApprove: r => setApproveTarget(r), onReject: r => setRejectTarget(r), onIssue: handleIssue }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="Fuel Requests"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Cards / Table toggle */}
            <div style={{ display: 'flex', background: THEME.surfaceVar, borderRadius: '10px', padding: '3px' }}>
              {[
                { id: 'cards', icon: 'grid_view',   label: 'Cards' },
                { id: 'table', icon: 'table_rows',  label: 'Table' },
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
            <button
              onClick={() => setPage('fuel_request_form')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '10px 20px', borderRadius: '12px', border: 'none',
                background: FUEL_CLR, color: '#fff',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Icon name="add" size={16} /> New Request
            </button>
          </div>
        }
      />

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Pending',   count: pendingCount, icon: 'schedule',       color: THEME.warning },
          { label: 'Approved',  count: requests.filter(r => r.status === 'approved').length,  icon: 'check_circle',   color: THEME.info },
          { label: 'Issued',    count: requests.filter(r => r.status === 'issued').length,    icon: 'local_shipping', color: THEME.success },
          { label: 'Rejected',  count: requests.filter(r => r.status === 'rejected').length,  icon: 'cancel',         color: THEME.error },
          { label: 'Total',     count: requests.length, icon: 'assignment', color: FUEL_CLR },
        ].map(c => (
          <div key={c.label} style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Icon name={c.icon} size={14} style={{ color: c.color, opacity: .8 }} />
              <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{c.label}</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: c.color }}>{c.count}</div>
          </div>
        ))}
      </div>

      {/* Global filters */}
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center',
        background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '14px', padding: '12px 16px', marginBottom: '20px',
      }}>
        <div style={{ position: 'relative', flex: '2 1 200px' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search request no, requester, asset…" style={{ ...inpStyle, paddingLeft: '32px', width: '100%', boxSizing: 'border-box' }} />
        </div>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ ...selStyle, flex: '1 1 120px' }}>
          <option value="all">All Priorities</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inpStyle, flex: '1 1 130px' }} title="From date" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={{ ...inpStyle, flex: '1 1 130px' }} title="To date" />
        {hasGlobalFilters && (
          <button onClick={() => { setGlobalSearch(''); setFilterPriority('all'); setDateFrom(''); setDateTo('') }}
            style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.textMed, cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}>
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* ── Pending Requests ── */}
          {pending.length > 0 ? (
            <RequestSection title="Pending Approval" icon="schedule" iconColor={THEME.warning} rows={pending} {...sectionProps} />
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 24px 40px', marginBottom: '24px', background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
              <div style={{
                width: '80px', height: '80px', borderRadius: '50%',
                background: THEME.statusSuccessBg, margin: '0 auto 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="check_circle" size={40} style={{ color: THEME.success }} />
              </div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>No pending fuel requests</div>
              <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '20px' }}>All requests have been processed. You're up to date.</div>
              {can('fuel.view') && (
                <button
                  onClick={() => setPage('fuel_request_form')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '7px',
                    padding: '10px 24px', borderRadius: '12px', border: 'none',
                    background: FUEL_CLR, color: '#fff',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <Icon name="add" size={16} /> Create Request
                </button>
              )}
            </div>
          )}

          {/* ── Approved (awaiting issuance) ── */}
          <RequestSection title="Approved — Awaiting Issuance" icon="check_circle" iconColor={THEME.info} rows={approved} {...sectionProps} />

          {/* ── Recently Issued / Completed ── */}
          <RequestSection title="Completed Requests" icon="local_shipping" iconColor={THEME.success} rows={issued} {...sectionProps} />

          {/* ── Rejected ── */}
          <RequestSection title="Rejected Requests" icon="cancel" iconColor={THEME.error} rows={rejected} {...sectionProps} />

          {/* ── Cancelled ── */}
          <RequestSection title="Cancelled Requests" icon="block" iconColor={THEME.textLow} rows={cancelled} {...sectionProps} />

          {/* If truly nothing at all */}
          {globalFiltered.length === 0 && !hasGlobalFilters && (
            <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
              <div style={{
                width: '80px', height: '80px', borderRadius: '50%',
                background: FUEL_CLR + '12', margin: '0 auto 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="assignment" size={40} style={{ color: FUEL_CLR }} />
              </div>
              <div style={{ fontSize: '16px', fontWeight: 500, color: THEME.text, marginBottom: '6px' }}>No fuel requests yet</div>
              <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '20px' }}>Start by creating your first fuel request.</div>
              <button
                onClick={() => setPage('fuel_request_form')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '7px',
                  padding: '10px 24px', borderRadius: '12px', border: 'none',
                  background: FUEL_CLR, color: '#fff',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Icon name="add" size={16} /> Create Request
              </button>
            </div>
          )}

          {globalFiltered.length === 0 && hasGlobalFilters && (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: THEME.textLow }}>
              <Icon name="filter_list_off" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
              <div style={{ fontSize: '14px' }}>No requests match the current filters</div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {approveTarget && <ApproveModal req={approveTarget} saving={actionSaving} onConfirm={handleApprove} onClose={() => setApproveTarget(null)} />}
      {rejectTarget && <RejectModal req={rejectTarget} saving={actionSaving} onConfirm={handleReject} onClose={() => setRejectTarget(null)} />}
      <DetailPanel req={detailReq} onClose={() => setDetailReq(null)} onApprove={r => { setDetailReq(null); setApproveTarget(r) }} onReject={r => { setDetailReq(null); setRejectTarget(r) }} onIssue={handleIssue} canApprove={canApprove} canIssue={canIssue} />
    </div>
  )
}

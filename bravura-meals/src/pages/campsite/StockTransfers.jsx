import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useCampsite } from '../../contexts/CampsiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, StatusBadge, showToast } from '../../components/ui'

// ── Inter-site Stock Transfers ───────────────────────────────────────────────
// Deliberately simple, matching the actual requirement: request → source
// approves & dispatches → destination confirms receipt → the two linked
// supply transactions (issue at source, receive at destination) get
// created automatically, fully auditable throughout via the existing
// audit_log triggers already attached to this table.
//
// Approve & Dispatch and Confirm Receipt only ever act on the site
// currently being viewed — dispatching only shows on a transfer where this
// site is the source, receiving only where this site is the destination.
// That means both actions can safely reuse CampsiteContext's already
// site-scoped supplies data and mutation functions directly, rather than
// needing fresh cross-site queries.
export default function StockTransfers() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite, accessibleSites } = useSite()
  const { can } = usePermissions()
  const { supplies, recordSupplyTxn, addSupplyItem } = useCampsite()

  const canRequest  = can('supplies.create')
  const canDispatch = can('supplies.approve')
  const canReceive  = can('supplies.create')

  const [transfers, setTransfers] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [tab,       setTab]       = useState('active') // active | history
  const [processingId, setProcessingId] = useState(null)

  const [requestModal, setRequestModal] = useState(false)
  const [direction,    setDirection]    = useState('send') // send | request
  const [otherSiteId,  setOtherSiteId]  = useState('')
  const [itemId,       setItemId]       = useState('')   // for sending — picked from this site's catalog
  const [itemName,     setItemName]     = useState('')   // for requesting — free text, matched at the source later
  const [quantity,     setQuantity]     = useState('')
  const [saving,        setSaving]      = useState(false)

  const [cancelTarget, setCancelTarget] = useState(null)

  useEffect(() => { if (currentSiteId) fetchTransfers() }, [currentSiteId])

  async function fetchTransfers() {
    setLoading(true)
    const { data } = await supabase
      .from('stock_transfers')
      .select(`
        *,
        from_site:sites!stock_transfers_from_site_id_fkey(id,name),
        to_site:sites!stock_transfers_to_site_id_fkey(id,name),
        requested_by_profile:profiles!stock_transfers_requested_by_fkey(full_name,username),
        approved_by_profile:profiles!stock_transfers_approved_by_fkey(full_name,username)
      `)
      .or(`from_site_id.eq.${currentSiteId},to_site_id.eq.${currentSiteId}`)
      .order('created_at', { ascending: false })
      .limit(100)
    setTransfers(data || [])
    setLoading(false)
  }

  const otherSites = accessibleSites.filter(s => s.id !== currentSiteId)
  const active  = useMemo(() => transfers.filter(t => t.status === 'pending' || t.status === 'in_transit'), [transfers])
  const history = useMemo(() => transfers.filter(t => t.status === 'completed' || t.status === 'cancelled'), [transfers])

  function openRequest() {
    setDirection('send'); setOtherSiteId(''); setItemId(''); setItemName(''); setQuantity('')
    setRequestModal(true)
  }

  async function doRequest() {
    if (!otherSiteId) { showToast('Select the other site', 'red'); return }
    if (!quantity || parseFloat(quantity) <= 0) { showToast('Enter a valid quantity', 'red'); return }
    const isSend = direction === 'send'
    const resolvedItemName = isSend ? supplies.find(s => s.id === itemId)?.name : itemName.trim()
    if (isSend && !itemId) { showToast('Select an item to send', 'red'); return }
    if (!isSend && !itemName.trim()) { showToast('Enter the item name you need', 'red'); return }

    setSaving(true)
    try {
      const { error } = await supabase.from('stock_transfers').insert({
        item_name:    resolvedItemName,
        from_site_id: isSend ? currentSiteId : otherSiteId,
        to_site_id:   isSend ? otherSiteId   : currentSiteId,
        quantity:     parseFloat(quantity),
        status:       'pending',
        requested_by: profile?.id,
      })
      if (error) throw error
      showToast('Transfer request created', 'green')
      setRequestModal(false)
      fetchTransfers()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function doDispatch(transfer) {
    setProcessingId(transfer.id)
    try {
      const sourceItem = supplies.find(s => s.name.toLowerCase() === transfer.item_name.toLowerCase())
      if (!sourceItem) {
        throw new Error(`No item named "${transfer.item_name}" found in this site's catalog — add it under Camp Supplies first, then try again.`)
      }
      const txn = await recordSupplyTxn({
        itemId:     sourceItem.id,
        txnType:    'issue',
        quantity:   transfer.quantity,
        reference:  `Transfer to ${transfer.to_site?.name || 'another site'}`,
        recordedBy: profile?.id,
      })
      const { error } = await supabase.from('stock_transfers').update({
        status: 'in_transit',
        approved_by: profile?.id,
        transfer_out_txn_id: txn.id,
      }).eq('id', transfer.id)
      if (error) throw error
      showToast('Dispatched — awaiting receipt at the destination', 'green')
      fetchTransfers()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setProcessingId(null)
    }
  }

  async function doConfirmReceipt(transfer) {
    setProcessingId(transfer.id)
    try {
      let destItem = supplies.find(s => s.name.toLowerCase() === transfer.item_name.toLowerCase())
      if (!destItem) {
        // Auto-provision a matching catalog entry at the destination —
        // otherwise confirming receipt would be blocked just because
        // nobody had set this item up here yet, which would be an
        // avoidable friction point for what should be a quick step.
        // Defaults to "Units"; correct it under Camp Supplies if needed.
        destItem = await addSupplyItem({ name: transfer.item_name, unit: 'Units' })
      }
      const txn = await recordSupplyTxn({
        itemId:     destItem.id,
        txnType:    'receive',
        quantity:   transfer.quantity,
        reference:  `Transfer from ${transfer.from_site?.name || 'another site'}`,
        recordedBy: profile?.id,
      })
      const { error } = await supabase.from('stock_transfers').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        transfer_in_txn_id: txn.id,
      }).eq('id', transfer.id)
      if (error) throw error
      showToast('Receipt confirmed — transfer complete', 'green')
      fetchTransfers()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setProcessingId(null)
    }
  }

  async function doCancel() {
    const { error } = await supabase.from('stock_transfers').update({ status: 'cancelled' }).eq('id', cancelTarget.id)
    if (error) { showToast(error.message, 'red'); setCancelTarget(null); return }
    showToast('Transfer request cancelled', 'red')
    setCancelTarget(null)
    fetchTransfers()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>
          Stock Transfers
          <span style={{ marginLeft: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.primary, verticalAlign: 'middle' }}>
            <Icon name="location_on" size={12} style={{ color: THEME.primary }} />
            {currentSite?.name || '—'}
          </span>
        </h2>
        {canRequest && otherSites.length > 0 && (
          <Button onClick={openRequest} variant="filled" icon="add">New Transfer</Button>
        )}
      </div>

      {otherSites.length === 0 && (
        <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: '#FFF8E1' }}>
          <Icon name="info" size={18} style={{ color: '#7D5700', flexShrink: 0 }} />
          <div style={{ fontSize: '12px', color: '#7D5700' }}>
            No other sites are accessible to you, so there's nowhere to transfer to or from yet.
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[['active','Active'],['history','History']].map(([v,l]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${tab === v ? THEME.primary : THEME.outline}`,
            background: tab === v ? THEME.surfaceVar : 'transparent',
            color: tab === v ? THEME.primary : THEME.textMed,
          }}>
            {l}{v === 'active' && active.length > 0 ? ` (${active.length})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(tab === 'active' ? active : history).length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
                <Icon name="sync_alt" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                {tab === 'active' ? 'No active transfers' : 'No completed or cancelled transfers yet'}
              </div>
            </Card>
          ) : (tab === 'active' ? active : history).map(t => {
            const isOutgoing = t.from_site_id === currentSiteId
            const otherSiteName = isOutgoing ? t.to_site?.name : t.from_site?.name
            const processing = processingId === t.id
            return (
              <Card key={t.id} style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Icon name={isOutgoing ? 'north_east' : 'south_west'} size={20} style={{ color: isOutgoing ? THEME.warning : THEME.success }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: THEME.text }}>
                        {t.quantity} × {t.item_name}
                      </div>
                      <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>
                        {isOutgoing ? `To ${otherSiteName || '—'}` : `From ${otherSiteName || '—'}`}
                        {' · Requested by '}
                        {t.requested_by_profile?.full_name || t.requested_by_profile?.username || '—'}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </div>

                {t.status === 'in_transit' && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: THEME.textLow }}>
                    Approved by {t.approved_by_profile?.full_name || t.approved_by_profile?.username || '—'}
                  </div>
                )}

                {/* Actions — only the side whose turn it is sees a button */}
                {t.status === 'pending' && isOutgoing && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    {canDispatch ? (
                      <Button onClick={() => doDispatch(t)} variant="filled" icon="local_shipping" disabled={processing}>
                        {processing ? 'Dispatching…' : 'Approve & Dispatch'}
                      </Button>
                    ) : (
                      <div style={{ fontSize: '12px', color: THEME.textLow }}>Awaiting approval from someone with dispatch authority.</div>
                    )}
                    <Button onClick={() => setCancelTarget(t)} variant="text" icon="close">Cancel</Button>
                  </div>
                )}
                {t.status === 'pending' && !isOutgoing && (
                  <div style={{ marginTop: '12px', fontSize: '12px', color: THEME.textLow }}>
                    Awaiting approval at {otherSiteName} before this can be dispatched.
                  </div>
                )}
                {t.status === 'in_transit' && !isOutgoing && (
                  <div style={{ marginTop: '12px' }}>
                    {canReceive ? (
                      <Button onClick={() => doConfirmReceipt(t)} variant="filled" icon="inventory" disabled={processing}>
                        {processing ? 'Confirming…' : 'Confirm Receipt'}
                      </Button>
                    ) : (
                      <div style={{ fontSize: '12px', color: THEME.textLow }}>Dispatched — waiting for receipt to be confirmed here.</div>
                    )}
                  </div>
                )}
                {t.status === 'in_transit' && isOutgoing && (
                  <div style={{ marginTop: '12px', fontSize: '12px', color: THEME.textLow }}>
                    Dispatched — awaiting confirmation at {otherSiteName}.
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* New Transfer Modal */}
      <Modal open={requestModal} onClose={() => setRequestModal(false)} title="New Transfer Request"
        footer={<>
          <Button onClick={() => setRequestModal(false)} variant="text">Cancel</Button>
          <Button onClick={doRequest} variant="filled" disabled={saving}>{saving ? 'Creating…' : 'Create Request'}</Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Direction</SectionLabel>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { v: 'send',    l: `Send from ${currentSite?.name || 'here'}` },
              { v: 'request', l: `Request to ${currentSite?.name || 'here'}` },
            ].map(opt => (
              <button key={opt.v} onClick={() => { setDirection(opt.v); setItemId(''); setItemName('') }} style={{
                flex: 1, padding: '10px', borderRadius: '10px', cursor: 'pointer',
                border: `2px solid ${direction === opt.v ? THEME.primary : THEME.outline}`,
                background: direction === opt.v ? THEME.surfaceVar : '#fff',
                fontSize: '12px', fontWeight: 600, color: direction === opt.v ? THEME.primary : THEME.textMed,
              }}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>{direction === 'send' ? 'Destination Site' : 'Source Site'}</SectionLabel>
          <select value={otherSiteId} onChange={e => setOtherSiteId(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="">— Select site —</option>
            {otherSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Item</SectionLabel>
          {direction === 'send' ? (
            <select value={itemId} onChange={e => setItemId(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
              <option value="">— Select item from this site's stock —</option>
              {supplies.map(s => <option key={s.id} value={s.id}>{s.name} (balance: {s.balance} {s.unit})</option>)}
            </select>
          ) : (
            <input type="text" value={itemName} onChange={e => setItemName(e.target.value)}
              placeholder="e.g. Soap — matched against the source site's catalog when they approve"
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
          )}
        </div>

        <div>
          <SectionLabel>Quantity</SectionLabel>
          <input type="number" min="0.01" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)}
            style={{ width: '140px', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }} />
        </div>
      </Modal>

      {/* Cancel confirm */}
      <ConfirmModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={doCancel}
        title="Cancel this transfer request?"
        message={`Cancel the request for ${cancelTarget?.quantity} × ${cancelTarget?.item_name}? Nothing has been dispatched yet, so this is safe to cancel.`}
        confirmLabel="Cancel Request"
        danger
      />
    </div>
  )
}

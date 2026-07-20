import { useState, useEffect, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast, fmtDate, MONTHS, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import QuickNav, { CAMPSITE_PILLS } from '../../components/QuickNav'

export default function CampSupplies({ setPage }) {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const canEdit   = can('supplies.edit')
  const canDelete = can('supplies.delete')
  const {
    supplies, supplyTxns, employees,
    addSupplyItem, recordSupplyTxn, updateSupplyTxn, deleteSupplyTxn,
    loading,
  } = useCampsite()

  const [tab,         setTab]         = useState('balance')
  const [txnModal,    setTxnModal]    = useState(false)
  const [txnType,     setTxnType]     = useState('receive')
  const [itemModal,   setItemModal]   = useState(false)
  const [saving,      setSaving]      = useState(false)

  // Bulk issue
  const makeBulkRow = () => ({ itemId: '', quantity: '', issuedToEmployeeId: '', issuedToText: '', notes: '' })
  const [bulkModal,    setBulkModal]    = useState(false)
  const [bulkHeader,   setBulkHeader]   = useState({ txnDate: new Date().toISOString().slice(0,10), reference: '' })
  const [bulkRows,     setBulkRows]     = useState(() => Array.from({ length: 5 }, makeBulkRow))
  const [bulkSaving,   setBulkSaving]   = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null) // { done, total }

  // Transaction form
  const [txnForm, setTxnForm] = useState({ itemId: '', quantity: '', reference: '', notes: '', txnDate: new Date().toISOString().slice(0,10), issuedToEmployeeId: '', issuedToText: '' })

  // New item form
  const [itemForm, setItemForm] = useState({ name: '', unit: 'Units' })

  // Edit / delete transaction
  const [editTxn,     setEditTxn]     = useState(null) // the txn being edited
  const [editForm,    setEditForm]    = useState(null)
  const [deleteTxn,   setDeleteTxn]   = useState(null) // the txn being deleted

  // Monthly report filters
  const now = new Date()
  const [repMonth, setRepMonth] = useState(now.getMonth())
  const [repYear,  setRepYear]  = useState(now.getFullYear())

  function openTxn(type) {
    setTxnType(type)
    setTxnForm({ itemId: '', quantity: '', reference: '', notes: '', txnDate: new Date().toISOString().slice(0,10), issuedToEmployeeId: '', issuedToText: '' })
    setTxnModal(true)
  }

  async function doTxn() {
    if (!txnForm.itemId)   { showToast('Select an item', 'red'); return }
    if (!txnForm.quantity) { showToast('Enter quantity', 'red'); return }
    setSaving(true)
    try {
      await recordSupplyTxn({
        itemId:             txnForm.itemId,
        txnType:             txnType,
        quantity:            txnForm.quantity,
        reference:           txnForm.reference,
        notes:               txnForm.notes,
        txnDate:             txnForm.txnDate,
        recordedBy:          profile?.id,
        issuedToEmployeeId:  txnForm.issuedToEmployeeId || null,
        issuedToText:        txnForm.issuedToText || null,
      })
      showToast(`Stock ${txnType === 'receive' ? 'received' : 'issued'} successfully`, 'green')
      setTxnModal(false)
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  function openBulk() {
    setBulkHeader({ txnDate: new Date().toISOString().slice(0,10), reference: '' })
    setBulkRows(Array.from({ length: 5 }, makeBulkRow))
    setBulkProgress(null)
    setBulkModal(true)
  }

  function updateBulkRow(idx, patch) {
    setBulkRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const bulkValidRows = bulkRows.filter(r => r.itemId && parseFloat(r.quantity) > 0)

  async function doBulkIssue() {
    const valid = bulkValidRows
    if (valid.length === 0) { showToast('Add at least one row with an item and quantity', 'red'); return }

    // Block if cumulative quantity per item exceeds a known balance
    const perItem = {}
    valid.forEach(r => { perItem[r.itemId] = (perItem[r.itemId] || 0) + parseFloat(r.quantity) })
    for (const [itemId, qty] of Object.entries(perItem)) {
      const item = supplies.find(s => s.id === itemId)
      if (item && item.balance != null && qty > parseFloat(item.balance)) {
        showToast(`"${item.name}": total ${qty} exceeds balance of ${parseFloat(item.balance)} ${item.unit}`, 'red')
        return
      }
    }

    setBulkSaving(true)
    let done = 0
    try {
      for (const r of valid) {
        setBulkProgress({ done: done + 1, total: valid.length })
        await recordSupplyTxn({
          itemId:             r.itemId,
          txnType:            'issue',
          quantity:           r.quantity,
          reference:          bulkHeader.reference,
          notes:              r.notes,
          txnDate:            bulkHeader.txnDate,
          recordedBy:         profile?.id,
          issuedToEmployeeId: r.issuedToEmployeeId || null,
          issuedToText:       r.issuedToText || null,
        })
        done++
      }
      showToast(`${done} issue${done > 1 ? 's' : ''} recorded`, 'green')
      setBulkModal(false)
    } catch (err) {
      showToast(`${err.message}${done > 0 ? ` — ${done} of ${valid.length} saved before the error` : ''}`, 'red')
    } finally {
      setBulkSaving(false)
      setBulkProgress(null)
    }
  }

  function openEditTxn(txn) {
    setEditTxn(txn)
    setEditForm({
      quantity:            txn.quantity,
      reference:           txn.reference || '',
      notes:               txn.notes || '',
      txnDate:             txn.txn_date,
      issuedToEmployeeId:  txn.issued_to_employee_id || '',
      issuedToText:        txn.issued_to_text || '',
    })
  }

  async function doEditTxn() {
    if (!editForm.quantity) { showToast('Enter quantity', 'red'); return }
    setSaving(true)
    try {
      await updateSupplyTxn({
        txnId:              editTxn.id,
        quantity:           editForm.quantity,
        reference:          editForm.reference,
        notes:              editForm.notes,
        txnDate:            editForm.txnDate,
        issuedToEmployeeId: editForm.issuedToEmployeeId || null,
        issuedToText:       editForm.issuedToText || null,
        updatedBy:          profile?.id,
      })
      showToast('Transaction updated', 'green')
      setEditTxn(null)
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function doDeleteTxn() {
    setSaving(true)
    try {
      await deleteSupplyTxn(deleteTxn.id)
      showToast('Transaction deleted', 'red')
      setDeleteTxn(null)
    } catch (err) { showToast(err.message, 'red'); setDeleteTxn(null) }
    finally { setSaving(false) }
  }

  async function doAddItem() {
    if (!itemForm.name.trim()) { showToast('Item name required', 'red'); return }
    setSaving(true)
    try {
      await addSupplyItem({ name: itemForm.name.trim(), unit: itemForm.unit || 'Units' })
      showToast('Item added', 'green')
      setItemModal(false)
      setItemForm({ name: '', unit: 'Units' })
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  // Monthly consumption report
  const monthlyData = useMemo(() => {
    const pad = n => String(n).padStart(2,'0')
    const prefix = `${repYear}-${pad(repMonth+1)}`
    const monthTxns = supplyTxns.filter(t => t.txn_date?.startsWith(prefix))
    return supplies.map(item => {
      const itemTxns = monthTxns.filter(t => t.item_id === item.id)
      const received = itemTxns.filter(t => t.txn_type === 'receive').reduce((a,t) => a + parseFloat(t.quantity||0), 0)
      const issued   = itemTxns.filter(t => t.txn_type === 'issue').reduce((a,t)   => a + parseFloat(t.quantity||0), 0)
      return { ...item, received, issued }
    }).filter(i => i.received > 0 || i.issued > 0)
  }, [supplies, supplyTxns, repMonth, repYear])

  // ── Request from Central Stores ──
  const [reqModal, setReqModal] = useState(false)
  const [reqSaving, setReqSaving] = useState(false)
  const [invItems, setInvItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [reqForm, setReqForm] = useState({ warehouse_id: '', priority: 'normal', notes: '' })
  const makeReqLine = () => ({ item_id: '', quantity: '', notes: '' })
  const [reqLines, setReqLines] = useState(() => Array.from({ length: 3 }, makeReqLine))

  useEffect(() => {
    if (!reqModal) return
    supabase.from('items').select('id, item_code, description').eq('is_active', true).order('item_code').then(({ data }) => setInvItems(data || []))
    supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).then(({ data }) => {
      setWarehouses(data || [])
      if (data?.length === 1) setReqForm(f => ({ ...f, warehouse_id: data[0].id }))
    })
  }, [reqModal, currentSiteId])

  async function submitRequisition() {
    const validLines = reqLines.filter(l => l.item_id && parseFloat(l.quantity) > 0)
    if (!reqForm.warehouse_id) { showToast('Select a warehouse', 'red'); return }
    if (validLines.length === 0) { showToast('Add at least one item', 'red'); return }
    setReqSaving(true)
    try {
      const { data: req, error } = await supabase.from('purchase_requisitions').insert({
        site_id: currentSiteId, warehouse_id: reqForm.warehouse_id,
        priority: reqForm.priority, notes: reqForm.notes || 'Camp supplies request',
        status: 'submitted', requested_by: profile?.id,
      }).select('id').single()
      if (error) throw error
      const { error: lineErr } = await supabase.from('requisition_lines').insert(
        validLines.map(l => ({ requisition_id: req.id, item_id: l.item_id, quantity: parseFloat(l.quantity), notes: l.notes }))
      )
      if (lineErr) throw lineErr
      showToast('Requisition submitted to Central Stores', 'green')
      setReqModal(false)
      setReqLines(Array.from({ length: 3 }, makeReqLine))
      setReqForm({ warehouse_id: '', priority: 'normal', notes: '' })
    } catch (err) { showToast(err.message, 'red') }
    finally { setReqSaving(false) }
  }

  const balanceColor = (balance) => parseFloat(balance) <= 0 ? THEME.error : parseFloat(balance) < 10 ? THEME.warning : THEME.success

  return (
    <div>
      <PageHeader
        title="Camp Supplies"
        actions={<>
          <Button onClick={() => openTxn('receive')} variant="filled"   icon="add_box">Receive Stock</Button>
          <Button onClick={() => openTxn('issue')}   variant="tonal"    icon="remove_circle">Issue Stock</Button>
          <Button onClick={openBulk}                 variant="tonal"    icon="playlist_remove">Bulk Issue</Button>
          <Button onClick={() => setItemModal(true)} variant="outlined" icon="add">Add Item</Button>
          <Button onClick={() => setReqModal(true)} variant="outlined" icon="inventory_2">Request from Stores</Button>
        </>}
      />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: `2px solid ${THEME.outlineVar}` }}>
        {[
          { id: 'balance',  label: 'Stock Balance' },
          { id: 'movement', label: 'Movement History' },
          { id: 'monthly',  label: 'Monthly Report' },
        ].map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
            color: tab === t.id ? THEME.primary : THEME.textMed,
            borderBottom: `2px solid ${tab === t.id ? THEME.primary : 'transparent'}`,
            marginBottom: '-2px',
          }}>
            {t.label}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : (

        /* ── Stock Balance ── */
        tab === 'balance' ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '14px', marginBottom: '20px' }}>
              {supplies.filter(s => s.is_active).map(item => {
                const bal = parseFloat(item.balance || 0)
                const color = balanceColor(bal)
                return (
                  <Card key={item.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>{item.name}</div>
                        <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{item.unit}</div>
                      </div>
                      <Icon name="inventory_2" size={20} style={{ color: THEME.textLow }} />
                    </div>
                    <div style={{ fontSize: '36px', fontWeight: 300, color, lineHeight: 1, marginBottom: '8px' }}>
                      {parseFloat(item.balance || 0).toFixed(item.unit === 'Kg' ? 1 : 0)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: THEME.textLow }}>
                      <span>Received: {parseFloat(item.total_received||0).toFixed(item.unit === 'Kg' ? 1 : 0)}</span>
                      <span>Issued: {parseFloat(item.total_issued||0).toFixed(item.unit === 'Kg' ? 1 : 0)}</span>
                    </div>
                    {bal <= 0 && (
                      <div style={{ marginTop: '8px', padding: '5px 10px', background: THEME.statusErrorBg, borderRadius: '8px', fontSize: '11px', color: THEME.error, fontWeight: 500 }}>
                        Out of stock
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        ) : tab === 'movement' ? (

          /* ── Movement History ── */
          <TableWrap>
            <THead>
              {['Date','Item','Type','Quantity','Unit','Issued To','Reference','Notes','Recorded By','Actions'].map(h => (
                <Th key={h} style={{ whiteSpace: 'nowrap' }}>{h}</Th>
              ))}
            </THead>
            <tbody>
              {supplyTxns.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No transactions yet</td></tr>
              ) : supplyTxns.map(txn => {
                const isReceive = txn.txn_type === 'receive'
                const issuedToLabel = txn.issued_to_employee?.name || txn.issued_to_text || (isReceive ? '—' : '—')
                return (
                  <TRow key={txn.id}>
                    <Td style={{ color: THEME.textMed }}>{fmtDate(txn.txn_date)}</Td>
                    <Td style={{ fontWeight: 500 }}>{txn.item?.name || '—'}</Td>
                    <Td>
                      <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                        background: isReceive ? THEME.statusSuccessBg : THEME.statusErrorBg,
                        color:      isReceive ? THEME.statusSuccessText : THEME.error }}>
                        {isReceive ? 'Receive' : 'Issue'}
                      </span>
                    </Td>
                    <Td style={{ fontWeight: 700, color: isReceive ? THEME.success : THEME.error }}>
                      {isReceive ? '+' : '−'}{parseFloat(txn.quantity).toFixed(txn.item?.unit === 'Kg' ? 1 : 0)}
                    </Td>
                    <Td style={{ color: THEME.textLow }}>{txn.item?.unit}</Td>
                    <Td style={{ color: THEME.textMed }}>{issuedToLabel}</Td>
                    <Td style={{ color: THEME.textMed }}>{txn.reference || '—'}</Td>
                    <Td style={{ color: THEME.textLow }}>{txn.notes || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>
                      {txn.recorded_by_profile?.full_name || '—'}
                      {txn.updated_at && (
                        <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '1px' }}>edited</div>
                      )}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => openEditTxn(txn)} title="Edit" disabled={!canEdit}
                          style={{ width: '28px', height: '28px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: THEME.surface, cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="edit" size={13} style={{ color: THEME.textMed }} />
                        </button>
                        <button onClick={() => setDeleteTxn(txn)} title="Delete" disabled={!canDelete}
                          style={{ width: '28px', height: '28px', border: '1px solid #f5b8b8', borderRadius: '8px', background: THEME.surface, cursor: canDelete ? 'pointer' : 'not-allowed', opacity: canDelete ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="delete" size={13} style={{ color: THEME.error }} />
                        </button>
                      </div>
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        ) : (

          /* ── Monthly Report ── */
          <div>
            <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px' }}>Month</div>
                  <select value={repMonth} onChange={e => setRepMonth(parseInt(e.target.value))}
                    style={{ padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
                    {MONTHS.map((m,i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px' }}>Year</div>
                  <input type="number" value={repYear} onChange={e => setRepYear(parseInt(e.target.value))} min="2020" max="2099"
                    style={{ width: '90px', padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
                </div>
                <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: THEME.primary, fontFamily: 'inherit' }}>
                  <Icon name="print" size={16} style={{ color: THEME.primary }} /> Print
                </button>
              </div>
            </Card>
            <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${THEME.outlineVar}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: THEME.surface }}>
                <thead>
                  <tr style={{ background: THEME.primary, color: '#fff' }}>
                    <th style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px' }}>Item</th>
                    <th style={{ padding: '11px 14px', textAlign: 'center', fontWeight: 500, fontSize: '12px' }}>Unit</th>
                    <th style={{ padding: '11px 14px', textAlign: 'center', fontWeight: 500, fontSize: '12px', background: THEME.success + 'CC' }}>Received</th>
                    <th style={{ padding: '11px 14px', textAlign: 'center', fontWeight: 500, fontSize: '12px', background: THEME.error + 'CC' }}>Issued</th>
                    <th style={{ padding: '11px 14px', textAlign: 'center', fontWeight: 500, fontSize: '12px' }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No transactions for {MONTHS[repMonth]} {repYear}</td></tr>
                  ) : monthlyData.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = THEME.surface}>
                      <td style={{ padding: '11px 14px', fontWeight: 500 }}>{item.name}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.textLow }}>{item.unit}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.success, fontWeight: 600 }}>+{item.received.toFixed(item.unit === 'Kg' ? 1 : 0)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'center', color: THEME.error,   fontWeight: 600 }}>−{item.issued.toFixed(item.unit === 'Kg' ? 1 : 0)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'center', fontWeight: 700, color: item.received - item.issued >= 0 ? THEME.success : THEME.error }}>
                        {(item.received - item.issued >= 0 ? '+' : '')}{(item.received - item.issued).toFixed(item.unit === 'Kg' ? 1 : 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Txn Modal ── */}
      <Modal dirty={true} open={txnModal} onClose={() => setTxnModal(false)}
        title={txnType === 'receive' ? 'Receive Stock' : 'Issue Stock'}
        footer={<>
          <Button onClick={() => setTxnModal(false)} variant="text">Cancel</Button>
          <Button onClick={doTxn} variant={txnType === 'receive' ? 'filled' : 'danger'} disabled={saving}>
            {saving ? 'Saving…' : txnType === 'receive' ? 'Record Receipt' : 'Record Issue'}
          </Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Item *</SectionLabel>
          <select value={txnForm.itemId} onChange={e => setTxnForm(f => ({ ...f, itemId: e.target.value }))}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="">— Select item —</option>
            {supplies.filter(s => s.is_active).map(s => (
              <option key={s.id} value={s.id}>{s.name} (Balance: {parseFloat(s.balance||0).toFixed(s.unit === 'Kg' ? 1 : 0)} {s.unit})</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Quantity *</SectionLabel>
            <input type="number" min="0.01" step="0.01" value={txnForm.quantity} onChange={e => setTxnForm(f => ({ ...f, quantity: e.target.value }))}
              placeholder="0" autoFocus
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input type="date" value={txnForm.txnDate} onChange={e => setTxnForm(f => ({ ...f, txnDate: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
          </div>
        </div>

        {/* Issued To — only relevant for an issue, since nothing is being
            handed to anyone on a receipt. Either pick a real employee or
            type a free-text recipient like "Kitchen" or "Block 3". */}
        {txnType === 'issue' && (
          <div style={{ marginBottom: '14px' }}>
            <SectionLabel>Issued To</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <select value={txnForm.issuedToEmployeeId} onChange={e => setTxnForm(f => ({ ...f, issuedToEmployeeId: e.target.value, issuedToText: e.target.value ? '' : f.issuedToText }))}
                style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
                <option value="">— Select employee (optional) —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input type="text" value={txnForm.issuedToText} onChange={e => setTxnForm(f => ({ ...f, issuedToText: e.target.value, issuedToEmployeeId: e.target.value ? '' : f.issuedToEmployeeId }))}
                placeholder="Or type e.g. Kitchen, Block 3"
                style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
              Pick one or the other — selecting an employee clears the text field, and vice versa.
            </div>
          </div>
        )}
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Reference / Delivery Note</SectionLabel>
          <textarea value={txnForm.reference} onChange={e => setTxnForm(f => ({ ...f, reference: e.target.value }))}
            placeholder="e.g. DN-001" rows={2}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={txnForm.notes} onChange={e => setTxnForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>

      {/* ── Bulk Issue Modal ── */}
      <Modal dirty={true} open={bulkModal} onClose={() => !bulkSaving && setBulkModal(false)} title="Bulk Issue Stock"
        footer={<>
          <Button onClick={() => setBulkModal(false)} variant="text" disabled={bulkSaving}>Cancel</Button>
          <Button onClick={doBulkIssue} variant="danger" disabled={bulkSaving}>
            {bulkSaving && bulkProgress ? `Saving ${bulkProgress.done}/${bulkProgress.total}…` : bulkSaving ? 'Saving…' : 'Record Issues'}
          </Button>
        </>}>
        {/* Shared header fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input type="date" value={bulkHeader.txnDate} onChange={e => setBulkHeader(h => ({ ...h, txnDate: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div>
            <SectionLabel>Reference / Delivery Note</SectionLabel>
            <input type="text" value={bulkHeader.reference} onChange={e => setBulkHeader(h => ({ ...h, reference: e.target.value }))}
              placeholder="e.g. DN-001 (optional)"
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
          </div>
        </div>

        {/* Row grid */}
        {bulkRows.map((row, idx) => {
          const item = supplies.find(s => s.id === row.itemId)
          const over = item && item.balance != null && parseFloat(row.quantity) > parseFloat(item.balance)
          return (
            <div key={idx} style={{ padding: '10px 12px', border: `1px solid ${over ? THEME.error : THEME.outlineVar}`, borderRadius: '12px', marginBottom: '10px' }}>
      <QuickNav pills={CAMPSITE_PILLS} setPage={setPage} current="camp_supplies" />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                <select value={row.itemId} onChange={e => updateBulkRow(idx, { itemId: e.target.value })}
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
                  <option value="">— Select item —</option>
                  {supplies.filter(s => s.is_active).map(s => (
                    <option key={s.id} value={s.id}>{s.name} (Balance: {parseFloat(s.balance||0).toFixed(s.unit === 'Kg' ? 1 : 0)} {s.unit})</option>
                  ))}
                </select>
                <input type="number" min="0.01" step="0.01" value={row.quantity} onChange={e => updateBulkRow(idx, { quantity: e.target.value })}
                  placeholder="Qty"
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${over ? THEME.error : THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
                <button onClick={() => setBulkRows(rows => rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx))} title="Remove row" disabled={bulkSaving}
                  style={{ width: '28px', height: '28px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: THEME.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={13} style={{ color: THEME.textMed }} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <select value={row.issuedToEmployeeId} onChange={e => updateBulkRow(idx, { issuedToEmployeeId: e.target.value, issuedToText: e.target.value ? '' : row.issuedToText })}
                  disabled={!!row.issuedToText}
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', opacity: row.issuedToText ? 0.5 : 1 }}>
                  <option value="">— Employee (optional) —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <input type="text" value={row.issuedToText} onChange={e => updateBulkRow(idx, { issuedToText: e.target.value, issuedToEmployeeId: e.target.value ? '' : row.issuedToEmployeeId })}
                  disabled={!!row.issuedToEmployeeId}
                  placeholder="Or type e.g. Kitchen"
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', opacity: row.issuedToEmployeeId ? 0.5 : 1 }} />
                <input type="text" value={row.notes} onChange={e => updateBulkRow(idx, { notes: e.target.value })}
                  placeholder="Notes (optional)"
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
              </div>
              {over && (
                <div style={{ fontSize: '11px', color: THEME.error, marginTop: '6px' }}>
                  Quantity exceeds balance of {parseFloat(item.balance)} {item.unit}
                </div>
              )}
            </div>
          )
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setBulkRows(rows => [...rows, makeBulkRow()])} disabled={bulkSaving}
              style={{ background: 'none', border: `1px dashed ${THEME.outline}`, borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.primary, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Icon name="add" size={14} style={{ color: THEME.primary }} /> Add Row
            </button>
            <button onClick={() => setBulkRows(Array.from({ length: 5 }, makeBulkRow))} disabled={bulkSaving}
              style={{ background: 'none', border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textLow, fontWeight: 500, fontFamily: 'inherit' }}>
              Reset
            </button>
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>
            Total: {bulkValidRows.length} issue{bulkValidRows.length !== 1 ? 's' : ''} to record
          </div>
        </div>
      </Modal>

      {/* ── Add Item Modal ── */}
      <Modal dirty={true} open={itemModal} onClose={() => setItemModal(false)} title="Add Supply Item"
        footer={<>
          <Button onClick={() => setItemModal(false)} variant="text">Cancel</Button>
          <Button onClick={doAddItem} variant="filled" disabled={saving}>{saving ? 'Saving…' : 'Add Item'}</Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Item Name *</SectionLabel>
          <input type="text" value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Hand Sanitiser" autoFocus
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
        </div>
        <div>
          <SectionLabel>Unit of Measure</SectionLabel>
          <input type="text" value={itemForm.unit} onChange={e => setItemForm(f => ({ ...f, unit: e.target.value }))}
            placeholder="e.g. Units, Kg, Litres, Rolls"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
        </div>
      </Modal>

      {/* ── Edit Transaction Modal ── */}
      <Modal dirty={true} open={!!editTxn} onClose={() => setEditTxn(null)}
        title={`Edit ${editTxn?.txn_type === 'receive' ? 'Receipt' : 'Issue'} — ${editTxn?.item?.name || ''}`}
        footer={<>
          <Button onClick={() => setEditTxn(null)} variant="text">Cancel</Button>
          <Button onClick={doEditTxn} variant="filled" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </>}>
        {editForm && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <SectionLabel>Quantity *</SectionLabel>
                <input type="number" min="0.01" step="0.01" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
              </div>
              <div>
                <SectionLabel>Date</SectionLabel>
                <input type="date" value={editForm.txnDate} onChange={e => setEditForm(f => ({ ...f, txnDate: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
              </div>
            </div>

            {editTxn?.txn_type === 'issue' && (
              <div style={{ marginBottom: '14px' }}>
                <SectionLabel>Issued To</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <select value={editForm.issuedToEmployeeId} onChange={e => setEditForm(f => ({ ...f, issuedToEmployeeId: e.target.value, issuedToText: e.target.value ? '' : f.issuedToText }))}
                    style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
                    <option value="">— Select employee (optional) —</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <input type="text" value={editForm.issuedToText} onChange={e => setEditForm(f => ({ ...f, issuedToText: e.target.value, issuedToEmployeeId: e.target.value ? '' : f.issuedToEmployeeId }))}
                    placeholder="Or type e.g. Kitchen, Block 3"
                    style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
                </div>
              </div>
            )}

            <div style={{ marginBottom: '14px' }}>
              <SectionLabel>Reference / Delivery Note</SectionLabel>
              <textarea value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} rows={2}
                style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
            </div>
            <div>
              <SectionLabel>Notes</SectionLabel>
              <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
            </div>
            <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textLow }}>
              Item and transaction type can't be changed here — delete and re-record if either was wrong.
            </div>
          </>
        )}
      </Modal>

      {/* ── Delete Transaction Confirm ── */}
      <ConfirmModal
        open={!!deleteTxn}
        onClose={() => setDeleteTxn(null)}
        onConfirm={doDeleteTxn}
        title="Delete this transaction?"
        message={`Permanently delete this ${deleteTxn?.txn_type === 'receive' ? 'receipt' : 'issue'} of ${deleteTxn?.quantity} ${deleteTxn?.item?.unit} for "${deleteTxn?.item?.name}"? This cannot be undone. Blocked automatically if it would push stock below zero.`}
        confirmLabel={saving ? 'Deleting…' : 'Delete'}
        danger
      />

      {/* ── Request from Central Stores ── */}
      <Modal dirty={true} open={reqModal} onClose={() => setReqModal(false)} title="Request from Central Stores" wide>
        <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '14px' }}>
          Create an inventory requisition for items the camp needs from the central warehouse.
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '180px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>Warehouse</label>
            <select value={reqForm.warehouse_id} onChange={e => setReqForm(f => ({ ...f, warehouse_id: e.target.value }))}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }}>
              <option value="">Select…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: '120px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>Priority</label>
            <select value={reqForm.priority} onChange={e => setReqForm(f => ({ ...f, priority: e.target.value }))}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }}>
              {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
        <SectionLabel>Items</SectionLabel>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '10px' }}>
          <thead>
            <tr>{['Item', 'Qty', 'Notes', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {reqLines.map((line, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <td style={{ padding: '4px 6px' }}>
                  <select value={line.item_id} onChange={e => { const l = [...reqLines]; l[i] = { ...l[i], item_id: e.target.value }; setReqLines(l) }}
                    style={{ width: '100%', padding: '6px', borderRadius: '5px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }}>
                    <option value="">Select item…</option>
                    {invItems.map(it => <option key={it.id} value={it.id}>{it.item_code} — {it.description}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 6px', width: '80px' }}>
                  <input type="number" min="1" value={line.quantity} onChange={e => { const l = [...reqLines]; l[i] = { ...l[i], quantity: e.target.value }; setReqLines(l) }}
                    placeholder="Qty" style={{ width: '100%', padding: '6px', borderRadius: '5px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input value={line.notes} onChange={e => { const l = [...reqLines]; l[i] = { ...l[i], notes: e.target.value }; setReqLines(l) }}
                    placeholder="Notes" style={{ width: '100%', padding: '6px', borderRadius: '5px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }} />
                </td>
                <td style={{ padding: '4px 6px', width: '36px' }}>
                  {reqLines.length > 1 && <Icon name="close" size={16} style={{ cursor: 'pointer', color: THEME.textLow }} onClick={() => setReqLines(reqLines.filter((_, j) => j !== i))} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button variant="text" icon="add" onClick={() => setReqLines([...reqLines, makeReqLine()])} style={{ fontSize: '12px', marginBottom: '14px' }}>Add row</Button>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <Button variant="outlined" onClick={() => setReqModal(false)}>Cancel</Button>
          <Button variant="filled" icon="send" onClick={submitRequisition} disabled={reqSaving}>{reqSaving ? 'Submitting…' : 'Submit Requisition'}</Button>
        </div>
      </Modal>
    </div>
  )
}

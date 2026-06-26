import { useState, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast, fmtDate, MONTHS } from '../../components/ui'

export default function CampSupplies() {
  const { profile } = useAuth()
  const { can } = usePermissions()
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

  const balanceColor = (balance) => parseFloat(balance) <= 0 ? THEME.error : parseFloat(balance) < 10 ? THEME.warning : THEME.success

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>Camp Supplies</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => openTxn('receive')} variant="filled"   icon="add_box">Receive Stock</Button>
          <Button onClick={() => openTxn('issue')}   variant="tonal"    icon="remove_circle">Issue Stock</Button>
          <Button onClick={() => setItemModal(true)} variant="outlined" icon="add">Add Item</Button>
        </div>
      </div>

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
                  <Card key={item.id} style={{ borderTop: `4px solid ${color}` }}>
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
                      <div style={{ marginTop: '8px', padding: '5px 10px', background: '#FDECEA', borderRadius: '8px', fontSize: '11px', color: THEME.error, fontWeight: 500 }}>
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
          <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff' }}>
              <thead>
                <tr style={{ background: THEME.primary, color: '#fff' }}>
                  {['Date','Item','Type','Quantity','Unit','Issued To','Reference','Notes','Recorded By','Actions'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supplyTxns.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No transactions yet</td></tr>
                ) : supplyTxns.map(txn => {
                  const isReceive = txn.txn_type === 'receive'
                  const issuedToLabel = txn.issued_to_employee?.name || txn.issued_to_text || (isReceive ? '—' : '—')
                  return (
                    <tr key={txn.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{fmtDate(txn.txn_date)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 500 }}>{txn.item?.name || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                          background: isReceive ? '#E8F5E9' : '#FDECEA',
                          color:      isReceive ? '#1B5E20'  : THEME.error }}>
                          {isReceive ? 'Receive' : 'Issue'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: isReceive ? THEME.success : THEME.error }}>
                        {isReceive ? '+' : '−'}{parseFloat(txn.quantity).toFixed(txn.item?.unit === 'Kg' ? 1 : 0)}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textLow }}>{txn.item?.unit}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{issuedToLabel}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{txn.reference || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textLow }}>{txn.notes || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>
                        {txn.recorded_by_profile?.full_name || '—'}
                        {txn.updated_at && (
                          <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '1px' }}>edited</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => openEditTxn(txn)} title="Edit" disabled={!canEdit}
                            style={{ width: '28px', height: '28px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: '#fff', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="edit" size={13} style={{ color: THEME.textMed }} />
                          </button>
                          <button onClick={() => setDeleteTxn(txn)} title="Delete" disabled={!canDelete}
                            style={{ width: '28px', height: '28px', border: '1px solid #f5b8b8', borderRadius: '8px', background: '#fff', cursor: canDelete ? 'pointer' : 'not-allowed', opacity: canDelete ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="delete" size={13} style={{ color: THEME.error }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
                <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`, borderRadius: '20px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: THEME.primary, fontFamily: 'inherit' }}>
                  <Icon name="print" size={16} style={{ color: THEME.primary }} /> Print
                </button>
              </div>
            </Card>
            <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff' }}>
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
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
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
      <Modal open={txnModal} onClose={() => setTxnModal(false)}
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
          <input type="text" value={txnForm.reference} onChange={e => setTxnForm(f => ({ ...f, reference: e.target.value }))}
            placeholder="e.g. DN-001"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={txnForm.notes} onChange={e => setTxnForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>

      {/* ── Add Item Modal ── */}
      <Modal open={itemModal} onClose={() => setItemModal(false)} title="Add Supply Item"
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
      <Modal open={!!editTxn} onClose={() => setEditTxn(null)}
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
              <input type="text" value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))}
                style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
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
    </div>
  )
}

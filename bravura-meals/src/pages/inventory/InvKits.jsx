import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// IN24 — kits (issue #59, I5): an item that is a list of components (first-aid kit, service kit, PPE starter pack).
// Issuing or sending a kit moves its components; a kit never holds stock itself.
export default function InvKits({ setPage }) {
  const { can } = usePermissions()
  const [items, setItems] = useState([])
  const [comps, setComps] = useState([])
  const [kitId, setKitId] = useState('')
  const [add, setAdd] = useState({ item_id: '', qty: '1' })
  const [newKit, setNewKit] = useState({ item_code: '', description: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [i, c] = await Promise.all([
      supabase.from('items').select('id, item_code, description, is_kit').eq('is_archived', false).order('description').limit(5000),
      supabase.from('item_kit_components').select('kit_item_id, component_item_id, qty').eq('is_archived', false),
    ])
    if (i.error) return showToast(friendlyError(i.error), 'red')
    setItems(i.data || []); setComps(c.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const kits = items.filter(i => i.is_kit)
  const byId = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  useEffect(() => { if (!kitId && kits[0]) setKitId(kits[0].id) }, [kits, kitId])
  const mine = comps.filter(c => c.kit_item_id === kitId)
  const edit = can('inventory.edit')

  async function createKit() {
    if (!newKit.item_code.trim() || !newKit.description.trim()) return showToast('Give the kit a code and a name', 'red')
    setBusy(true)
    const { data, error } = await supabase.from('items').insert({ item_code: newKit.item_code.trim().toUpperCase(), description: newKit.description.trim(), is_kit: true, status: 'active' }).select('id').single()
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    setNewKit({ item_code: '', description: '' }); setKitId(data.id); load()
  }

  async function addComp() {
    const qty = Number(add.qty)
    if (!add.item_id || !(qty > 0)) return showToast('Choose an item and a quantity', 'red')
    const { error } = await supabase.from('item_kit_components').upsert({ kit_item_id: kitId, component_item_id: add.item_id, qty, is_archived: false, updated_at: new Date().toISOString() },
      { onConflict: 'kit_item_id,component_item_id' })
    if (error) return showToast(friendlyError(error), 'red')
    setAdd({ item_id: '', qty: '1' }); load()
  }

  async function removeComp(c) {
    const { error } = await supabase.from('item_kit_components').update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('kit_item_id', c.kit_item_id).eq('component_item_id', c.component_item_id)
    if (error) return showToast(friendlyError(error), 'red')
    load()
  }

  if (!can('inventory.view')) return <Denied />
  const label = { fontSize: 12, color: FIN.muted }
  const link = { background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }

  return (
    <FinShell module="Inventory" homePage="inv_dashboard" setPage={setPage} title="Kits"
      subtitle="A kit is a list of items issued together. Issuing one kit issues every component.">
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        <div style={{ ...finCard, display: 'grid', gap: 10 }}>
          <strong style={{ fontFamily: FIN.serif, fontSize: 17 }}>Kits</strong>
          {kits.length === 0 ? <div style={{ color: FIN.faint, fontSize: 14 }}>No kits yet.</div> : kits.map(k => (
            <button key={k.id} onClick={() => setKitId(k.id)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', font: 'inherit',
              border: `1px solid ${k.id === kitId ? FIN.maroon : FIN.line}`, background: k.id === kitId ? FIN.maroonTint : '#fff', color: FIN.ink }}>
              {k.description}<div style={{ fontSize: 12, color: FIN.faint }}>{k.item_code} · {comps.filter(c => c.kit_item_id === k.id).length} components</div>
            </button>
          ))}
          {edit && (
            <div style={{ display: 'grid', gap: 8, borderTop: `1px solid ${FIN.lineSoft}`, paddingTop: 10 }}>
              <label style={label}>New kit code<input id="kit-code" value={newKit.item_code} onChange={e => setNewKit({ ...newKit, item_code: e.target.value })} placeholder="KIT-FIRSTAID" style={{ ...finInput, width: '100%' }} /></label>
              <label style={label}>Name<input id="kit-name" value={newKit.description} onChange={e => setNewKit({ ...newKit, description: e.target.value })} placeholder="First-aid kit (vehicle)" style={{ ...finInput, width: '100%' }} /></label>
              <button style={finBtn2} disabled={busy} onClick={createKit}>Create kit</button>
            </div>
          )}
        </div>

        <div style={{ ...finCard, display: 'grid', gap: 10 }}>
          {!kitId ? <div style={{ color: FIN.faint }}>Create a kit to add its components.</div> : <>
            <strong style={{ fontFamily: FIN.serif, fontSize: 17 }}>{byId[kitId]?.description}</strong>
            {mine.length === 0 ? <div style={{ color: FIN.faint, fontSize: 14 }}>No components yet.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
                {mine.map(c => (
                  <tr key={c.component_item_id} style={{ borderBottom: `1px solid ${FIN.lineSoft}` }}>
                    <td style={{ padding: '8px 0', fontSize: 14 }}>{byId[c.component_item_id]?.description}<div style={{ fontSize: 12, color: FIN.faint }}>{byId[c.component_item_id]?.item_code}</div></td>
                    <td style={{ textAlign: 'right', fontSize: 14 }}>× {Number(c.qty)}</td>
                    <td style={{ textAlign: 'right' }}>{edit && <button style={link} onClick={() => removeComp(c)}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            {edit && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ ...label, flex: 1, minWidth: 180 }}>Component
                  <select id="kit-comp" value={add.item_id} onChange={e => setAdd({ ...add, item_id: e.target.value })} style={{ ...finInput, width: '100%' }}>
                    <option value="">— Choose —</option>
                    {items.filter(i => !i.is_kit && i.id !== kitId).map(i => <option key={i.id} value={i.id}>{i.item_code} — {i.description}</option>)}
                  </select>
                </label>
                <label style={label}>Qty per kit<input id="kit-qty" type="number" min="0" value={add.qty} onChange={e => setAdd({ ...add, qty: e.target.value })} style={{ ...finInput, width: 90 }} /></label>
                <button style={finBtn} onClick={addComp}>Add</button>
              </div>
            )}
          </>}
        </div>
      </div>
    </FinShell>
  )
}

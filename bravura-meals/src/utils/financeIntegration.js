// ── Finance Integration Utilities ───────────────────────────────────────────
// Creates draft journal entries from Concrete module events (deliveries, production).

/**
 * Creates a draft journal entry for a material delivery (cement or aggregate).
 * Debit: Raw Materials Inventory (Current Asset)
 * Credit: Accounts Payable (Current Liability)
 */
export async function createDeliveryJournal({ supabase, siteId, userId, description, totalCost, costCentreId }) {
  if (!totalCost || totalCost <= 0) return { success: false, error: 'No cost to journal' }

  try {
    // Find raw materials account (Current Asset with 'Raw Material' or 'Inventory' in name)
    const { data: assetAccounts } = await supabase
      .from('chart_of_accounts')
      .select('id, name, sub_type')
      .eq('site_id', siteId)
      .eq('sub_type', 'Current Asset')
      .eq('is_archived', false)
    const rawMaterialAcct = (assetAccounts || []).find(a =>
      /raw.?material|inventory/i.test(a.name)
    ) || (assetAccounts || [])[0]

    // Find accounts payable (Payable sub_type, or first Current Liability)
    const { data: payableAccounts } = await supabase
      .from('chart_of_accounts')
      .select('id, name, sub_type')
      .eq('site_id', siteId)
      .eq('is_archived', false)
      .in('sub_type', ['Payable', 'Current Liability'])
    const payableAcct = (payableAccounts || []).find(a => a.sub_type === 'Payable')
      || (payableAccounts || [])[0]

    if (!rawMaterialAcct || !payableAcct) {
      return { success: false, error: 'Set up Raw Materials and Accounts Payable accounts first' }
    }

    // Get next entry number
    const { data: entryNumber, error: rpcErr } = await supabase
      .rpc('finance_next_entry_number', { p_site_id: siteId })
    if (rpcErr) return { success: false, error: rpcErr.message }

    // Insert journal entry
    const { data: journal, error: journalErr } = await supabase
      .from('journal_entries')
      .insert({
        site_id: siteId,
        entry_number: entryNumber,
        entry_date: new Date().toISOString().slice(0, 10),
        description,
        status: 'draft',
        source_module: 'concrete',
        created_by: userId,
      })
      .select('id')
      .single()
    if (journalErr) return { success: false, error: journalErr.message }

    // Insert journal lines
    const lines = [
      { journal_id: journal.id, account_id: rawMaterialAcct.id, debit: totalCost, credit: 0, line_order: 1, cost_centre_id: costCentreId || null },
      { journal_id: journal.id, account_id: payableAcct.id, debit: 0, credit: totalCost, line_order: 2, cost_centre_id: costCentreId || null },
    ]
    const { error: linesErr } = await supabase.from('journal_lines').insert(lines)
    if (linesErr) return { success: false, error: linesErr.message }

    return { success: true, journalId: journal.id }
  } catch (err) {
    return { success: false, error: err.message || 'Journal creation failed' }
  }
}

/**
 * Creates a draft journal entry for concrete production (material consumption).
 * Debit: Cost of Production / Cost of Sales
 * Credit: Raw Materials Inventory (Current Asset)
 */
export async function createProductionJournal({ supabase, siteId, userId, description, materialCost, costCentreId }) {
  if (!materialCost || materialCost <= 0) return { success: false, error: 'No cost to journal' }

  try {
    // Find cost of sales account
    const { data: cosAccounts } = await supabase
      .from('chart_of_accounts')
      .select('id, name, sub_type')
      .eq('site_id', siteId)
      .eq('sub_type', 'Cost of Sales')
      .eq('is_archived', false)
    const cosAcct = (cosAccounts || [])[0]

    // Find raw materials account (Current Asset)
    const { data: assetAccounts } = await supabase
      .from('chart_of_accounts')
      .select('id, name, sub_type')
      .eq('site_id', siteId)
      .eq('sub_type', 'Current Asset')
      .eq('is_archived', false)
    const rawMaterialAcct = (assetAccounts || []).find(a =>
      /raw.?material|inventory/i.test(a.name)
    ) || (assetAccounts || [])[0]

    if (!cosAcct || !rawMaterialAcct) {
      return { success: false, error: 'Set up Cost of Sales and Raw Materials accounts first' }
    }

    const { data: entryNumber, error: rpcErr } = await supabase
      .rpc('finance_next_entry_number', { p_site_id: siteId })
    if (rpcErr) return { success: false, error: rpcErr.message }

    const { data: journal, error: journalErr } = await supabase
      .from('journal_entries')
      .insert({
        site_id: siteId,
        entry_number: entryNumber,
        entry_date: new Date().toISOString().slice(0, 10),
        description,
        status: 'draft',
        source_module: 'concrete',
        created_by: userId,
      })
      .select('id')
      .single()
    if (journalErr) return { success: false, error: journalErr.message }

    const lines = [
      { journal_id: journal.id, account_id: cosAcct.id, debit: materialCost, credit: 0, line_order: 1, cost_centre_id: costCentreId || null },
      { journal_id: journal.id, account_id: rawMaterialAcct.id, debit: 0, credit: materialCost, line_order: 2, cost_centre_id: costCentreId || null },
    ]
    const { error: linesErr } = await supabase.from('journal_lines').insert(lines)
    if (linesErr) return { success: false, error: linesErr.message }

    return { success: true, journalId: journal.id }
  } catch (err) {
    return { success: false, error: err.message || 'Journal creation failed' }
  }
}

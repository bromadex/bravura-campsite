import { supabase } from '../supabaseClient'

// B5 (issue #58): put a file into DocShare and link it to any record in one step.
// Stored in the private docshare-files bucket under the site's folder; the ds_attach_file RPC creates the
// ds_documents row and the ds_document_links row as the person (RLS: ds.create at that site).
export const MAX_DOC_MB = 15
export async function attachFileToRecord(file, { siteId, table, recordId, title, category = 'General' }) {
  if (!file || !siteId || !table || !recordId) throw new Error('Missing file or record')
  if (file.size > MAX_DOC_MB * 1024 * 1024) throw new Error(`${file.name} is over ${MAX_DOC_MB} MB`)
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${siteId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage.from('docshare-files').upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw new Error('Upload failed: ' + upErr.message)
  const { data, error } = await supabase.rpc('ds_attach_file', { p_site: siteId, p_table: table, p_record: recordId, p_title: title || file.name,
    p_path: path, p_file_name: file.name, p_file_size: file.size, p_file_type: file.type || null, p_category: category })
  if (error) throw new Error(error.message)
  return data
}

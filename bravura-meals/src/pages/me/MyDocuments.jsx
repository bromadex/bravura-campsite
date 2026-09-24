import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, ExpiryPill, Section, bigBtn, field } from './shared'

export default function MyDocuments() {
  const { me, loading } = useMe()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [rejectText, setRejectText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('ess_my_documents')
    if (error) showToast(error.message, 'red')
    setData(d || { documents: [], policies: [] })
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  async function respond(id, accept) {
    setBusy(true)
    const { error } = await supabase.rpc('ess_acknowledge_policy', { p_document_id: id, p_accept: accept, p_comment: accept ? null : rejectText })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(accept ? 'Acknowledged' : 'Your concern was sent', 'green')
    setOpen(null); setRejectText(''); load()
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!data) return <Loading />

  const pending = data.policies.filter(p => !p.response)
  const done = data.policies.filter(p => p.response)

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="Documents & Policies" />

      <Section title={`Policies to read${pending.length ? ` (${pending.length})` : ''}`}>
        {pending.length === 0 ? (
          <Card style={{ padding: '14px', fontSize: '13px', color: THEME.textLow }}>You're up to date.</Card>
        ) : pending.map(p => (
          <Card key={p.id} style={{ padding: '12px 14px', marginBottom: '8px' }}>
            <button onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}
              style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Icon name="policy" size={20} style={{ color: ME_COLOR }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 600, color: THEME.text }}>{p.title}{p.version ? ` · v${p.version}` : ''}</span>
                <span style={{ fontSize: '12px', color: p.acknowledge_by && p.acknowledge_by < new Date().toISOString().slice(0, 10) ? THEME.error : THEME.textLow }}>
                  {p.mandatory ? 'Must acknowledge' : 'Please read'}{p.acknowledge_by ? ` by ${fmtDate(p.acknowledge_by)}` : ''}
                </span>
              </span>
              <Icon name={open === p.id ? 'expand_less' : 'expand_more'} size={20} style={{ color: THEME.textLow }} />
            </button>
            {open === p.id && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '14px', color: THEME.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '320px', overflowY: 'auto', padding: '10px', background: THEME.surfaceVar, borderRadius: '8px' }}>
                  {p.body || 'Open the policy in Governance to read the full document.'}
                </div>
                <input aria-label="Concern (only if you don't accept)" id={`pol-rej-${p.id}`} style={{ ...field, marginTop: '10px' }} value={rejectText}
                  placeholder="Only if you don't accept: what is the concern?" onChange={e => setRejectText(e.target.value)} />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button style={{ ...bigBtn(THEME.surfaceVar, THEME.error), flex: 1 }} disabled={busy} onClick={() => respond(p.id, false)}>Raise a concern</button>
                  <button style={{ ...bigBtn(ME_COLOR), flex: 2 }} disabled={busy} onClick={() => respond(p.id, true)}>I have read and accept</button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </Section>

      <Section title="My documents on file">
        {data.documents.length === 0 ? (
          <Card style={{ padding: '14px', fontSize: '13px', color: THEME.textLow }}>HR hasn't uploaded any documents for you yet.</Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.documents.map((d, i) => (
              <div key={i} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Icon name="description" size={18} style={{ color: ME_COLOR }} />
                <div style={{ flex: 1, fontSize: '14px', color: THEME.text }}>{d.type || d.file_name}
                  <div style={{ fontSize: '12px', color: THEME.textLow }}>{d.issued ? `Issued ${fmtDate(d.issued)} · ` : ''}{d.verified ? 'Verified by HR' : 'Not yet verified'}</div>
                </div>
                <ExpiryPill date={d.expires} />
              </div>
            ))}
          </Card>
        )}
      </Section>

      {done.length > 0 && (
        <Section title="Policies I've responded to">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {done.map((p, i) => (
              <div key={p.id} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', fontSize: '13px', color: THEME.textMed, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: THEME.text }}>{p.title}</span>
                <span style={{ color: p.response === 'accepted' ? THEME.statusSuccessText : THEME.statusWarningText }}>{p.response === 'accepted' ? 'Accepted' : 'Concern raised'} · {fmtDate(String(p.responded_at).slice(0, 10))}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </div>
  )
}

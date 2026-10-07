import { useState } from 'react'
import FinShell from '../../components/FinShell'
import PJDocuments from './PJDocuments'
import PJTransmittals from './PJTransmittals'

// PJ07 Documents (#76): drawing/document register and transmittals in one place (were two menu pages).
// Each task's own files live in its DocShare folder (task drawer → Files).
export default function PJDocsHub({ setPage, initialTab = 'register' }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <FinShell module="Projects" homePage="pj_dashboard" setPage={setPage} title="Documents"
      subtitle={tab === 'register' ? 'Drawings and documents by revision, per project.' : 'What was sent to whom, and whether they acknowledged it.'}
      tabs={[{ key: 'register', label: 'Register' }, { key: 'transmittals', label: 'Transmittals' }]} tab={tab} onTab={setTab}>
      {tab === 'register' ? <PJDocuments setPage={setPage} /> : <PJTransmittals setPage={setPage} />}
    </FinShell>
  )
}

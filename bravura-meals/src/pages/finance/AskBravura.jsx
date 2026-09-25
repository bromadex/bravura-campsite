import { usePermissions } from '../../contexts/PermissionsContext'
import Denied from '../../components/Denied'
import FinShell from '../../components/FinShell'
import { AskChat } from '../../components/AskBravura'

// FI29 — Ask Bravura full page (issues #49, #58). The same chat as the floating button (bottom centre,
// on every screen) without screen reading, for longer conversations.
export default function AskBravura({ setPage }) {
  const { can } = usePermissions()
  if (!can('finance.view') && !can('procurement.view')) return <Denied />
  return (
    <FinShell title="Ask Bravura" subtitle="Ask in plain words — answers come only from your own records" setPage={setPage}>
      <div style={{ maxWidth: 820, height: 'calc(100dvh - 260px)', minHeight: 420 }}>
        <AskChat />
      </div>
    </FinShell>
  )
}

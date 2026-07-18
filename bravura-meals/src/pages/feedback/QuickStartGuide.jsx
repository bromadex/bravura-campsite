import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { TXN_CODES, ALIASES } from '../../utils/txnCodes'
import { Icon, PageHeader } from '../../components/ui'

// ── Quick Start Guide ─────────────────────────────────────────────────────────
// Role-aware onboarding for every new user. Sections only render when the
// signed-in person actually holds the relevant permission, so a kitchen
// supervisor and a fuel attendant each see their own workflow, not everyone
// else's. Standing rule: every new module workflow gets a section here.

function Section({ icon, color, title, children }) {
  return (
    <div style={{
      background: THEME.surface, borderRadius: '14px', padding: '20px 22px',
      border: `1px solid ${THEME.outlineVar}`, borderLeft: `4px solid ${color}`,
      marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <Icon name={icon} size={20} style={{ color }} />
        <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>{title}</div>
      </div>
      <div style={{ fontSize: '13px', color: THEME.textMed, lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}

function Steps({ items }) {
  return (
    <ol style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
      {items.map((s, i) => <li key={i} style={{ marginBottom: '4px' }}>{s}</li>)}
    </ol>
  )
}

function Code({ children }) {
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: '12px', fontWeight: 700,
      background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '5px', padding: '1px 7px', color: THEME.text, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export default function QuickStartGuide() {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { currentSite, accessibleSites } = useSite()

  // T-codes for modules this user can actually reach, for the cheat table.
  const myCodes = useMemo(() => {
    const moduleAllowed = {
      meals:      can('meals.view')   || can('meals.create'),
      fuel:       can('fuel.view')    || can('fuel.create'),
      fleet:      can('fleet.view')   || can('fleet.create') || can('fleet.edit'),
      campsite:   can('campsite.view') || can('campsite.edit'),
      workforce:  can('hr.view')      || can('hr.edit'),
      admin:      can('admin.manage_users'),
      procurement: can('procurement.view'),
      feedback:   true,
    }
    return TXN_CODES.filter(t => moduleAllowed[t.module])
  }, [can])

  const aliasFor = code => Object.keys(ALIASES).find(a => ALIASES[a] === code)
  const firstName = profile?.full_name?.split(' ')[0] || profile?.username || 'there'

  return (
    <div style={{ maxWidth: '860px' }}>
      <PageHeader title="Quick Start Guide" site={currentSite} />

      {/* Welcome */}
      <div style={{
        background: `linear-gradient(120deg, ${THEME.primary}12, ${THEME.primary}04)`,
        borderRadius: '14px', padding: '22px 24px', marginBottom: '20px',
        border: `1px solid ${THEME.primary}22`,
      }}>
        <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
          Welcome to Bravura ERP, {firstName} 👋
        </div>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '6px', lineHeight: 1.7 }}>
          This guide shows the parts of the system that matter for <b>your</b> role.
          It's always here — Feedback module → Quick Start Guide, or just type{' '}
          <Code>HELP</Code> into the command bar.
        </div>
      </div>

      {/* Getting around */}
      <Section icon="bolt" color={THEME.primary} title="Getting around fast — the command bar">
        Press <Code>Ctrl + K</Code> anywhere (or click the search bar on the home screen).
        Type a transaction code and press Enter to jump straight to any screen — no menus.
        <div style={{ marginTop: '8px' }}>
          Shortcuts worth memorising:{' '}
          {['ISS', 'DIP', 'ENTRY', 'BILL', 'KIT', 'DISP', 'EMP', 'HELP'].map(a => (
            <span key={a} style={{ marginRight: '6px' }}><Code>{a}</Code></span>
          ))}
        </div>
      </Section>

      {/* Sites */}
      {accessibleSites.length > 1 && (
        <Section icon="location_on" color="#00838F" title="Switching sites">
          You have access to {accessibleSites.length} sites. Every screen shows data for
          the <b>currently selected site only</b> — use the site picker at the top right
          to switch. You always land on Kamativi after signing in.
        </Section>
      )}

      {/* Meals officer */}
      {can('meals.create') && (
        <Section icon="restaurant" color={MODULE_COLORS.meals} title="Your daily work — recording meals">
          <Steps items={[
            <>Open <Code>ENTRY</Code> (Daily Meal Entry) each day.</>,
            <>Tick breakfast / lunch / supper per employee — or use the "All Breakfast/Lunch/Supper" buttons and untick the exceptions. On Saturdays, supper shows as <b>Special Meal</b>.</>,
            <>Click <b>Save entries</b>, then <b>Submit for approval</b> when the day is complete.</>,
            <>If the kitchen raises a flag, the day unlocks with an amber banner — fix the entries, save, and resubmit.</>,
          ]} />
        </Section>
      )}

      {/* Approver */}
      {can('meals.approve') && (
        <Section icon="task_alt" color={MODULE_COLORS.meals} title="Approving meal submissions">
          <Steps items={[
            <>Open Meal Approvals (<Code>ME03</Code>) — pending days are listed with count diffs against any previous submission.</>,
            <>Approve, or <b>Return for corrections</b> with a note. The full history of every return and resubmission is kept in the audit trail.</>,
            <>Monthly totals live in Billing (<Code>BILL</Code>) — Saturday special suppers are priced separately and shown in their own column.</>,
          ]} />
        </Section>
      )}

      {/* Kitchen */}
      {can('meals.edit') && (
        <Section icon="skillet" color={MODULE_COLORS.meals} title="Kitchen verification">
          <Steps items={[
            <>Open Kitchen Verify (<Code>KIT</Code>) after each service.</>,
            <>Enter what the kitchen actually served and any waste.</>,
            <>If the counts don't match the system, <b>raise a flag</b> — the meals officer is notified and the day reopens for correction.</>,
          ]} />
        </Section>
      )}

      {/* Fuel */}
      {can('fuel.create') && (
        <Section icon="local_gas_station" color={MODULE_COLORS.fuel} title="Your daily work — fuel">
          <Steps items={[
            <>Issue fuel with <Code>ISS</Code>. Select the tank, vehicle and operator.</>,
            <><b>Always enter the vehicle's odometer reading</b> — the form shows the last recorded km and blocks obvious typos. This feeds consumption monitoring.</>,
            <>Record daily tank dips in <Code>DIP</Code> — tank levels come from dips, not arithmetic.</>,
            <>Manual issuances without an approved request need the authoriser's name and a reason.</>,
          ]} />
        </Section>
      )}

      {/* Fleet */}
      {(can('fleet.view') || can('fleet.edit')) && (
        <Section icon="directions_car" color={MODULE_COLORS.fleet} title="Fleet">
          <Steps items={[
            <>The Dispatch Board (<Code>DISP</Code>) is the live view — who's on a trip, what's grounded, what needs attention.</>,
            <>Log trips, inspections and meter readings from the Operations pages (<Code>FL07</Code>–<Code>FL11</Code>).</>,
            <>Watch the dashboard's red card: vehicles consuming above their expected L/100km appear there automatically.</>,
          ]} />
        </Section>
      )}

      {/* HR */}
      {(can('hr.view') || can('hr.create')) && (
        <Section icon="badge" color={MODULE_COLORS.workforce} title="HR — managing people">
          <Steps items={[
            <>The HR Dashboard (<Code>HR05</Code>) shows headcount, new starters and recent status changes.</>,
            <>Add an employee with <Code>HR08</Code> — the employee number auto-generates, and at least one emergency contact is required.</>,
            <>Change someone's status (leave, transfer, termination) from their detail page — every change needs a reason and is kept permanently in the status history.</>,
            <>Departments (<Code>HR06</Code>) and Designations (<Code>HR07</Code>) are archive-only — nothing is ever deleted.</>,
            <>Leave: allocate days per employee per year (<Code>HR12</Code>), then log requests in <Code>HR10</Code> — approving deducts the balance automatically. The calendar (<Code>HR11</Code>) shows who's away.</>,
            <>Documents (IDs, contracts, licences) upload on the employee's Documents tab — expiring documents show amber within 30 days, red once expired.</>,
            <>Moving someone between sites goes through Site Reassignment (<Code>HR15</Code>) — the receiving site's HR approves before the record moves.</>,
            <>Define shift patterns in Shift Management (<Code>HR17</Code>), then mark daily attendance against them in the Attendance Log (<Code>HR18</Code>).</>,
            <>Training Programs (<Code>HR19</Code>) track courses and who attended; the Skills Matrix (<Code>HR20</Code>) shows each employee's competencies and gaps at a glance.</>,
            <>Payroll: set up Salary Grades (<Code>HR25</Code>) and Components (<Code>HR26</Code>) once, run the monthly Payroll Run (<Code>HR27</Code>), then issue Salary Slips (<Code>HR28</Code>).</>,
            <>Appraisals (<Code>HR29</Code>) record performance reviews; Disciplinary Cases (<Code>HR30</Code>) keep a permanent hearing-and-outcome trail; leavers go through Exit Management (<Code>HR31</Code>).</>,
            <>Compliance: Medical Surveillance (<Code>HR32</Code>) tracks fitness-for-work exams due and overdue, and the Document Expiry register (<Code>HR33</Code>) lists every expiring ID, licence and contract in one place.</>,
          ]} />
        </Section>
      )}

      {/* Contractors */}
      {(can('contractors.view') || can('contractors.edit')) && (
        <Section icon="engineering" color={MODULE_COLORS.contractors} title="Contractors — companies, casuals & hired assets">
          <Steps items={[
            <>The Dashboard (<Code>CL01</Code>) shows active contractors, contracts, casuals working today and labour cost.</>,
            <>Register contractor companies in <Code>CL02</Code> — banking, compliance and insurance-expiry details live there.</>,
            <>Set up each contract in <Code>CL03</Code> — payment method, agreed rate, contract value and spend-to-date.</>,
            <>Casual workers (<Code>CL04</Code>) and contractor-employed staff (<Code>CL05</Code>) are separate registries — casuals are paid per shift/day/hour by us, contractor employees are paid by their company.</>,
            <>Capture daily timesheets in <Code>CL06</Code> — hours and overtime cost calculate automatically and need approval before they count.</>,
            <>Hired vehicles (<Code>CL07</Code>) and hired equipment (<Code>CL08</Code>) track rate, and whether driver/fuel/operator is included.</>,
          ]} />
        </Section>
      )}

      {/* Inventory */}
      {can('inventory.view') && (
        <Section icon="inventory_2" color={MODULE_COLORS.inventory} title="Inventory — items, stock & warehouses">
          <Steps items={[
            <>The Dashboard (<Code>IN01</Code>) shows total inventory value, SKU count, low-stock alerts and stock by category.</>,
            <>Items (<Code>IN02</Code>) is your central catalogue — every material, spare, consumable and supply gets one item code (auto-generated ITM-####).</>,
            <>Categories & UoM (<Code>IN03</Code>) organise items into a hierarchy (Electrical, Mechanical, Safety, etc.) and define measurement units.</>,
            <>Warehouses (<Code>IN04</Code>) are site-scoped storage locations — each site gets at least a Main store; add Workshop, Kitchen, etc. as needed.</>,
            <>Stock Balances (<Code>IN05</Code>) shows on-hand quantities per warehouse. HQ users see a cross-site matrix. Use the opening stock capture to set starting balances.</>,
            <>Goods Received (<Code>IN06</Code>) records stock arriving at a warehouse — voucher number, supplier, multi-line items with quantities and costs.</>,
            <>Issues & Returns (<Code>IN07</Code>) issues stock to employees/departments and records returns back to the warehouse.</>,
            <>Site Reassignment (<Code>IN08</Code>) transfers stock between warehouses or sites, creating paired transfer-out and transfer-in movements.</>,
            <>Adjustments (<Code>IN09</Code>) allows authorised users to add or subtract stock with a mandatory reason — requires the Approve permission.</>,
            <>Stock Take (<Code>IN13</Code>) runs a physical count against system balances — auto-populates a count sheet, calculates variances, and posts adjustments on approval.</>,
            <>Requisitions (<Code>IN14</Code>) let site staff request materials. Draft, submit for approval, then convert approved requisitions into Purchase Orders.</>,
            <>Purchase Orders (<Code>IN15</Code>) track procurement end-to-end — create from scratch or from an approved requisition, send to supplier, then receive goods against the PO.</>,
          ]} />
        </Section>
      )}

      {/* Admin */}
      {can('users.view') && (
        <Section icon="admin_panel_settings" color={MODULE_COLORS.admin} title="Administration">
          <Steps items={[
            <>The Admin Dashboard (<Code>AD01</Code>) gives a system overview and the most recent activity.</>,
            <>Users &amp; Roles (<Code>AD02</Code>) — assign each user their roles, per site.</>,
            <>Role Management (<Code>AD03</Code>) — create roles and pick exactly which permissions they carry.</>,
            <>Site Management (<Code>AD04</Code>) — add sites and set which one is head office.</>,
            <>Pending Invitations (<Code>AD05</Code>) — pre-authorise a role so it applies the moment the person signs up.</>,
            <>System Settings (<Code>AD06</Code>) — per-site module configuration.</>,
            <>Permissions Catalogue (<Code>AD07</Code>) — reference of every permission code in the system.</>,
            <>Audit Log (<Code>AD08</Code>) — who changed what, with before/after values.</>,
          ]} />
        </Section>
      )}

      {/* T-code cheat table */}
      <Section icon="menu_book" color="#455A64" title="Your transaction codes">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                {['Code', 'Screen', 'Module', 'Alias'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {myCodes.map(t => (
                <tr key={t.code} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontWeight: 700, color: MODULE_COLORS[t.module] || THEME.text }}>{t.code}</td>
                  <td style={{ padding: '5px 10px', color: THEME.text }}>{t.label}</td>
                  <td style={{ padding: '5px 10px', color: THEME.textLow, textTransform: 'capitalize' }}>{t.module}</td>
                  <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: THEME.textLow }}>{aliasFor(t.code) || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: '10px', fontSize: '12px', color: THEME.textLow }}>
          Tip: print this page (Ctrl+P) for a desk cheat sheet.
        </div>
      </Section>

      {/* Help */}
      <Section icon="forum" color={MODULE_COLORS.feedback} title="Stuck, or spotted something wrong?">
        Post it on the <b>Feedback Board</b> (<Code>FB01</Code>) — bugs, questions and
        ideas all land with the team that builds this system. Screenshots help.
      </Section>
    </div>
  )
}

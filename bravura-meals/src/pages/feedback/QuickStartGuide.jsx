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
      sheq:       can('sheq.view')  || can('sheq.create'),
      notifications: can('notifications.view'),
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
            <>PAYE (with the 3% AIDS levy) and NSSA are calculated automatically on every payroll run — don't add them as components. After approval, use <b>Mark as Paid</b> once net pay has been transferred.</>,
            <>Statutory Returns (<Code>HR36</Code>) gives the monthly PAYE schedule for ZIMRA and the NSSA P4 schedule, with CSV export. Record each employee's NSSA number and ZIMRA TIN on their employee record. When ZIMRA or NSSA change rates, HR settings holders enter the new bands on the Tax tables tab with the date they take effect.</>,
            <>Appraisals (<Code>HR29</Code>) record performance reviews; Disciplinary Cases (<Code>HR30</Code>) keep a permanent hearing-and-outcome trail; leavers go through Exit Management (<Code>HR31</Code>).</>,
            <>Compliance: Medical Surveillance (<Code>HR32</Code>) tracks fitness-for-work exams due and overdue, and the Document Expiry register (<Code>HR33</Code>) lists every expiring ID, licence and contract in one place.</>,
            <>PPE Tracking (<Code>HR34</Code>) records protective equipment issued to each employee — replacement dates flag automatically when kit is due or overdue.</>,
            <>HR Analytics (<Code>HR35</Code>) provides cross-module workforce analytics: headcount trends, department breakdowns, tenure distribution, meal costs, accommodation, fleet usage, leave days, and skills gap analysis per employee. Uses server-side RPCs for efficient aggregation.</>,
          ]} />
        </Section>
      )}

      {/* SHEQ */}
      {(can('sheq.view') || can('sheq.create')) && (
        <Section icon="health_and_safety" color={MODULE_COLORS.sheq} title="SHEQ — Safety, Health, Environment & Quality">
          <Steps items={[
            <><b>Phase 1 — Core Safety:</b> The Dashboard (<Code>SQ01</Code>) shows incident trends, open CAPAs and observation counts. Log incidents in <Code>SQ02</Code>, hazards/near-misses in <Code>SQ03</Code>, and safety observations in <Code>SQ04</Code>. Every incident gets a CAPA item (<Code>SQ05</Code>) to track corrective actions to closure.</>,
            <><b>Phase 2 — Risk &amp; Permits:</b> The Risk Register (<Code>SQ08</Code>) catalogues site risks with likelihood/severity scores. Run formal Risk Assessments (<Code>SQ09</Code>) and configure the matrix in <Code>SQ13</Code>. Issue Permits to Work (<Code>SQ10</Code>) for high-risk tasks — the PTW Board (<Code>SQ11</Code>) shows all active permits. LOTO isolations live in <Code>SQ12</Code>.</>,
            <><b>Phase 3 — Inspections &amp; Audits:</b> Build reusable checklists in Inspection Templates (<Code>SQ21</Code>), then run Inspections (<Code>SQ20</Code>) against them. Plan the Audit Programme (<Code>SQ22</Code>), record findings in <Code>SQ23</Code>, and view everything on the SHEQ Calendar (<Code>SQ24</Code>).</>,
            <><b>Phase 4 — Training &amp; Medical:</b> The Training Matrix (<Code>SQ25</Code>) tracks competencies and gaps. Medical Fitness (<Code>SQ26</Code>) records fitness-for-work exams. Log Toolbox Talks (<Code>SQ27</Code>) with attendees. Each employee's SHEQ Profile (<Code>SQ28</Code>) consolidates their safety record, and the Induction Register (<Code>SQ29</Code>) tracks site inductions.</>,
            <><b>Phase 5 — Environment &amp; PPE:</b> The Environmental Register (<Code>SQ14</Code>) lists environmental aspects and impacts. Waste Management (<Code>SQ15</Code>), Spill Management (<Code>SQ16</Code>) and Environmental Monitoring (<Code>SQ17</Code>) handle day-to-day tracking. PPE Register (<Code>SQ18</Code>) records issuance per employee. Resource Consumption (<Code>SQ19</Code>) monitors water, electricity and other utilities.</>,
            <><b>Phase 6 — Compliance &amp; Documents:</b> The Legal Register (<Code>SQ30</Code>) tracks applicable legislation and compliance status. Document Control (<Code>SQ31</Code>) manages SHEQ policies and procedures with version control. Contractor Compliance (<Code>SQ32</Code>) scores contractor safety performance. Emergency Plans (<Code>SQ33</Code>) and Drills (<Code>SQ34</Code>) ensure preparedness. Management Review (<Code>SQ35</Code>) records periodic SHEQ reviews.</>,
            <><b>Phase 7 — Analytics:</b> SHEQ Analytics (<Code>SQ36</Code>) aggregates data across modules — incident rates, CAPA closure trends, audit scores, training coverage and environmental KPIs in one view.</>,
            <>SHEQ Reports (<Code>SQ06</Code>) exports filtered data for regulatory submissions. Module settings live in <Code>SQ07</Code>.</>,
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
            <>Equipment Usage (<Code>CL13</Code>) logs daily hours per equipment item — calculates cost from hourly rate, tracks downtime and fuel, with approval workflow.</>,
            <>Casual Payroll (<Code>CL12</Code>) aggregates approved timesheets by worker for any period — cost breakdown with CSV export for Finance.</>,
          ]} />
        </Section>
      )}

      {/* Projects */}
      {can('projects.view') && (
        <Section icon="engineering" color={MODULE_COLORS.projects} title="Projects — plan, track & collaborate">
          <Steps items={[
            <>The Dashboard (<Code>PJ01</Code>) shows KPIs — active projects, overdue count, total budget — plus status breakdown and top projects by budget.</>,
            <>Create and manage projects in the Project List (<Code>PJ02</Code>) — card or table view, with status/type filters and search.</>,
            <>Click into any project for its workspace (<Code>PJ03</Code>) — phases, team members, labels and progress tracking all in one place.</>,
            <>Phases break each project into sequenced milestones with budget allocation, dates and weighted progress.</>,
            <>Team members are assigned with roles (manager, contributor, viewer) and granular permissions for tasks, docs and comments.</>,
            <>The Board tab inside each project is a Trello-style kanban — drag cards between columns (Backlog → To Do → In Progress → Review → Done).</>,
            <>My Tasks (<Code>PJ04</Code>) shows all your tasks across every project in one place, with priority and due-date filters.</>,
            <>Timeline (<Code>PJ05</Code>) gives a Gantt-style view of phases and tasks across projects.</>,
            <>Area Codes (<Code>PJ06</Code>) organise work by location or discipline — each project can reference one or more area codes.</>,
            <>Documents (<Code>PJ07</Code>) is the document register — upload, version-control, and run formal review cycles with multi-reviewer approval workflows.</>,
            <>Transmittals (<Code>PJ08</Code>) package documents for formal distribution — auto-numbered TX-NNNN, with status tracking (Draft → Sent → Received → Acknowledged).</>,
            <>The Schedule tab inside each project workspace runs Critical Path Method (CPM) analysis, manages baselines, and auto-generates WBS codes.</>,
            <>Costs &amp; EVM tracks cost breakdown (CBS items by category), Earned Value Management (SPI, CPI, SV, CV, EAC, ETC, VAC, TCPI), and S-curve charts.</>,
            <>Change Orders log scope/cost/schedule changes with a full status workflow (Draft → Submitted → Under Review → Approved → Rejected → Implemented).</>,
          ]} />
        </Section>
      )}

      {/* DocVault */}
      {can('ds.view') && (
        <Section icon="folder_shared" color={MODULE_COLORS.docshare} title="DocVault — document management & compliance">
          <Steps items={[
            <><b>Document Library</b> (<Code>DS01</Code>) is the central repository — upload, organise into folders, search by title/tags, and switch between list and grid views. Drag-and-drop upload supported.</>,
            <>Every document is either <b>General</b> (simple upload and share) or <b>Controlled</b> (versioned with approval workflow and acknowledgement tracking).</>,
            <><b>Document Viewer</b> (<Code>DS02</Code>) opens files inline — PDF, DOCX, Excel and images all render in the browser without downloading. The viewer is shared across the entire ERP.</>,
            <><b>Document Detail</b> (<Code>DS04</Code>) shows the full lifecycle of controlled documents — version history, review status, approve/reject panel, and upload new versions with change summaries.</>,
            <><b>My Acknowledgements</b> (<Code>DS05</Code>) lists documents you need to formally acknowledge — pending items with deadlines, and a completed history.</>,
            <><b>Compliance Dashboard</b> (<Code>DS06</Code>) tracks KPIs — total documents, expiring soon, overdue acknowledgements, pending reviews — with status breakdowns by category.</>,
            <><b>Document Reports</b> (<Code>DS07</Code>) exports the document register, acknowledgement compliance, version audit trail and storage usage as CSV.</>,
            <>Settings (<Code>DS03</Code>) manages categories, default folder structures and file type allowlists.</>,
          ]} />
        </Section>
      )}

      {/* Cross-Module Integration */}
      <Section icon="hub" color="#455A64" title="Cross-Module Integration">
        <Steps items={[
          <><b>Project tagging</b> — Fuel issues, fleet maintenance, contractor contracts, and purchase orders can be tagged to a project via an optional Project dropdown on their forms. Costs roll up to the project's Costs & EVM view.</>,
          <><b>Linked documents</b> — Detail pages across Fleet, SHEQ, HR, Contractors, and Procurement show linked DocVault documents. Use the "Attach Document" button to link existing documents to any record.</>,
          <><b>Discuss button</b> — Key detail pages have a "Discuss" button that creates (or opens) a Connect chat thread linked to that record, so conversations stay attached to the asset, incident, or order they're about.</>,
          <><b>Notifications</b> — The notification engine fires across modules: fleet maintenance schedules notify fleet managers, SHEQ incidents notify safety officers, contractor document expiry alerts procurement, and inventory low-stock alerts storekeepers.</>,
          <><b>Project Dashboard</b> aggregates cross-module data — safety incidents, fuel costs, and linked documents per project — alongside the existing budget and task KPIs.</>,
          <><b>Realtime guards</b> — Approval pages (fuel requests, leave requests, purchase orders) subscribe to realtime changes so stale data doesn't cause conflicting approvals.</>,
        ]} />
      </Section>

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

      {/* Procurement */}
      {can('procurement.view') && (
        <Section icon="storefront" color={MODULE_COLORS.procurement} title="Procurement">
          <Steps items={[
            <>The Procurement Dashboard (<Code>PR01</Code>) shows active POs, in-transit orders, delayed deliveries, open RFQs, and total spend at a glance.</>,
            <>Suppliers (<Code>PR02</Code>) — register and manage your supplier directory per site.</>,
            <>RFQs (<Code>PR03</Code>) — create Requests for Quotation with line items, send to suppliers, and compare responses to award contracts.</>,
            <>Orders (<Code>PR04</Code>) — view all purchase orders with delivery status, priority, and current location filters.</>,
            <>Tracking (<Code>PR05</Code>) — track goods in transit with a timeline of events (dispatched, at customs, delivered, etc.). Adding events auto-updates the PO status and location.</>,
            <>Reports (<Code>PR06</Code>) — spend by supplier, monthly trends, average lead time, and priority breakdown.</>,
          ]} />
        </Section>
      )}

      {/* Governance */}
      {can('governance.view') && (
        <Section icon="gavel" color="#6D4C41" title="Governance — announcements & policies">
          <Steps items={[
            <><b>Announcements</b> (<Code>GV01</Code>) — publish company-wide or site-specific announcements with priority levels (normal, important, urgent). Pin important ones to the top. Read receipts track who has seen each announcement.</>,
            <><b>Policies & Compliance</b> (<Code>GV02</Code>) — create versioned policies with mandatory acknowledgement deadlines. Employees accept or reject each policy; the compliance dashboard shows KPIs and per-employee response status.</>,
            <>Draft policies and announcements are only visible to creators. Use <b>Publish</b> (requires governance.approve permission) to make them live — this fires a notification to all users with governance.view access.</>,
            <>Export compliance reports as CSV from the Policies page to track acknowledgement rates by employee and department.</>,
          ]} />
        </Section>
      )}

      {/* Approvals */}
      <Section icon="approval" color="#4527A0" title="Approvals">
        <Steps items={[
          <>Everything waiting for your decision is in the Approvals inbox (<Code>NT02</Code>) — across every site you work at. Open the document, check the history, then <b>Approve</b> or <b>Reject</b> (a reason is required).</>,
          <>Some documents need more than one approver. After you approve, the request moves to the next step automatically and the next approver is notified; the requester is notified when it is fully approved or rejected.</>,
          <>If a document is on an approval route, its own Approve button is locked — the decision has to come from the inbox. A purchase order that needs approval shows <b>Pending approval</b> until the last approver signs it off, then it becomes Sent.</>,
          <>Nobody can approve their own request.</>,
          <>My Preferences (<Code>NT03</Code>, or the sliders icon next to Sign out) sets the module you open after sign-in, which notification categories show in the bell and whether they make a sound, table density, date format, text size, high contrast, and how long before an idle session signs out. They are saved to your account, so they follow you to any device.</>,
          ...(can('approvals.edit') ? [
            <>Set up routes in Approval Routes (<Code>AD11</Code>): pick the document (requisitions, purchase orders, supplier invoices, fuel requests or leave), an optional department and value band, then add steps — anyone with a permission, a named person, or the requester's line manager.</>,
            <>Documents that match no route keep the normal single-approver flow, so you can switch routes on one document type at a time.</>,
          ] : []),
        ]} />
      </Section>

      {/* Notifications */}
      {can('notifications.view') && (
        <Section icon="notifications" color="#5C6BC0" title="Notifications">
          <Steps items={[
            <>The bell icon in every module header shows your latest unread notifications — click to preview, or click <b>View all notifications</b> to open the full Notification Center (<Code>NT01</Code>).</>,
            <>Filter by category (Approvals, Reminders, Announcements, Escalations, Chat, General) using the tabs at the top.</>,
            <>Switch between All, Unread, and Read views. Use <b>Mark all read</b> to clear the badge in one click.</>,
            <>Notifications arrive in real time — no need to refresh the page.</>,
            <>Archive old notifications with the archive button on each card to keep your list tidy.</>,
          ]} />
        </Section>
      )}

      {/* Finance */}
      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="account_balance" color={MODULE_COLORS.finance} title="Finance — automatic posting">
          <Steps items={[
            <>Set up the site's ledger accounts in the Chart of Accounts (<Code>FI01</Code>) — stock, expenses, payables and bank. A mine only records costs, so there are no sales or revenue accounts to post to.</>,
            <>In Posting Rules (<Code>FI13</Code>) pick the debit and credit account for each event: fuel delivered and issued, goods received, supplier invoices approved and paid, payroll approved and paid, and daily meals approved.</>,
            <>From then on, approving any of those on site writes a posted journal automatically. Fuel issues are valued at the latest delivery price when no cost is captured.</>,
            <>Payroll posts net pay, PAYE &amp; AIDS levy, employee NSSA and employer NSSA to separate accounts, and IMTT (2% on each bank transfer) posts when invoices or payroll are paid. Set the IMTT rate on the Posting Rules page.</>,
            <>Posted journals are locked. To correct one, edit, cancel or reopen the source record — the old journal is voided and a new one posted.</>,
            <>Items with no rule (or no price) wait in the <b>Waiting</b> list. Fix the rule, then press <b>Post waiting items</b>.</>,
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
            <>Pending Invitations (<Code>AD05</Code>) — invite a user by email with their role and site; they get a link to set up their account.</>,
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

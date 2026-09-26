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
            <>Employees can record their own meals for today/yesterday from My Camp — they show up already ticked. Your save is final, so untick anything that's wrong.</>,
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
            <>PM &amp; Downtime (<Code>FL19</Code>): set service plans per asset or asset type (every N km, engine hours or days — whichever comes first). The Due tab shows what's overdue or due soon; create work orders one by one or all at once, and completing a PM work order resets the plan. The Downtime tab shows availability, hours down (maintenance, grounded, awaiting parts), breakdowns, MTTR and MTBF per asset — status changes are recorded automatically.</>,
            <>Meters at fuel fills: enter the km or hour meter when issuing fuel — optional now, <strong>required from 1 Nov 2026</strong>. If the meter doesn't work, tick "Meter broken" and say why. Readings flow into Meter readings (backwards or big jumps are flagged, not used); the "No reading in 7 days" list there shows which machines and who fuelled them last.</>,
            <>The Fleet dashboard (<Code>FL01</Code>) opens on what needs you today (machines down, services overdue, failed pre-starts, papers and contracts expiring), then availability, fuel this month, cost per hour, book value and a board of every machine. The "Cost per machine" tab shows fuel, parts and workshop bills, cost per hour and per km, and the total cost of ownership — with a CSV.</>,
            <>Small assets (<Code>FL22</Code>): radios, tools, laptops and gas detectors. Issue one to a person — they type their name to sign — and take it back with its condition (or mark it lost). "Who has what" lists each person's items; overdue loans remind the fleet team. An employee's profile shows what they hold, and HR can't complete their exit clearance until everything is back.</>,
            <>Ask Bravura knows the fleet: "who has radio 14", "what is John holding", "cost per hour for ADT 02". It can prepare a card to issue or take back a small asset, open a workshop job or record a km / hour reading — you press Confirm.</>,
            <>Pre-start check (<Code>FL20</Code>) on a phone before the first start: pick the machine, enter km or hours, mark each item OK / Fault / N/A. A fault opens a job for the workshop; a failed "must pass" item grounds the machine. No signal? The check is saved on the phone and sends itself later. "Open faults" lists what is still waiting.</>,
            <>Closing a job (<Code>FL12</Code> work orders): parts issued from Stores to the job and workshop bills on POs linked to the job are added automatically, plus labour. The machine goes back to Operational and its faults close. Starting a job puts the machine in Maintenance (or Awaiting parts), which drives the downtime figures.</>,
            <>Contracts (<Code>FL21</Code>): insurance, leases and service contracts with cost per year; you get a reminder before each one ends. PM & Downtime (<Code>FL19</Code>) now also shows availability, MTTR and MTBF per machine type.</>,
            <>All machines are on one list — Machines (<Code>FL05</Code>; <Code>FL02</Code>–<Code>FL04</Code> open it filtered to vehicles, heavy equipment or generators). Click a machine to open it; the pencil edits it. Specifications (kVA, weights, bucket size…) depend on the machine type.</>,
            <>On a machine: "Add to fixed assets" capitalises it — pick the Procurement receipt it came on (cost and date fill in) or enter the cost. Book value and depreciation then show on the machine. "Move to another site" moves it and its book value (posted through 2500 in both sites' books).</>,
            <>Licence, insurance and roadworthy dates on a machine come from Compliance — record new papers there. Every fuel issue is now priced at the tank's last delivery price.</>,
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
        <Section icon="inventory_2" color={MODULE_COLORS.inventory} title="Stores — items, stock & containers">
          <Steps items={[
            <>The Dashboard (<Code>IN01</Code>) shows total inventory value, SKU count, low-stock alerts and stock by category.</>,
            <>Items (<Code>IN02</Code>) is your central catalogue — every material, spare, consumable and supply gets one item code (auto-generated ITM-####).</>,
            <>Categories & UoM (<Code>IN03</Code>) organise items into a hierarchy (Electrical, Mechanical, Safety, etc.) and define measurement units.</>,
            <>Warehouses (<Code>IN04</Code>) are site-scoped storage locations — each site gets at least a Main store; add Workshop, Kitchen, etc. as needed.</>,
            <>Stock Balances (<Code>IN05</Code>) shows on-hand quantities per warehouse. HQ users see a cross-site matrix. Use the opening stock capture to set starting balances.</>,
            <>Goods Received (<Code>IN06</Code>) records stock arriving at a warehouse — voucher number, supplier, multi-line items with quantities and costs.</>,
            <>Issues & Returns (<Code>IN07</Code>) issues stock to employees/departments and records returns back to the warehouse.</>,
            <>Move between stores (<Code>IN08</Code>) moves stock between two stores at the same site. To send stock to another site, raise a Transfer request (<Code>PR07</Code>) — Finance then records what each site owes the other.</>,
            <>Bins & labels (<Code>IN17</Code>) lists the shelves/bins in each store — add one or a range (A01–A20) and print labels. Store levels (<Code>IN18</Code>) sets each item's bin, min, max, reorder point and reorder qty per store; reorder suggestions and draft POs use them.</>,
            <>Import items (<Code>IN19</Code>) takes an Excel sheet (download the template): new items are added, existing codes updated, bins and levels set, and an opening quantity posts opening stock to Finance. Items bought by the box can carry a purchase unit — receiving a PO line in boxes puts the right number of units on the shelf.</>,
            <>Stock position (<Code>IN21</Code>) shows, per store: on hand, reserved, free to use, on order (open POs) and on the way. Reserve stock there for a request or a work order — nobody else can issue it, and issuing against that request / work order uses the reservation. Release it from the Reservations tab.</>,
            <>Transfers (<Code>IN20</Code>): load a truck with several items and dispatch it to any store. It is in transit until the receiving store opens Coming in → Receive and confirms what arrived; anything short is written off. Approved transfer requests (<Code>PR07</Code>) dispatch the same way. Between sites, Finance posts what each site owes the other (2500) when it leaves and when it arrives.</>,
            <>The Stores dashboard (<Code>IN01</Code>) opens with what needs you today (out of stock, below reorder, expiring batches, requests to issue, transfers arriving, open counts) — tap a chip to go there. Below: stock value, issued this month, days of cover, dead stock, count accuracy, a 6-month chart, where stock went, Reorder now (with Make draft POs), ABC and the latest moves. The menu is grouped Overview · Stock · Move · Replenish · Reports · Setup.</>,
            <>Stock health (<Code>IN23</Code>): Ageing (how long stock has sat), Dead stock (nothing out since a date), ABC (A = top 70% of value used), Shrinkage (count and adjustment losses, damaged returns, short deliveries), Usage (by department / work order) and Counts (accuracy) — each exports to CSV.</>,
            <>Batches go out first-expiry-first-out automatically: leave the batch blank and the system takes the batch that expires first, splitting across batches if needed. Returns ask for the condition — damaged or scrap items credit the department and are written off as a loss.</>,
            <>Kits (<Code>IN24</Code>): build a kit from components (e.g. a vehicle first-aid kit). Issuing or sending one kit moves every component.</>,
            <>Ask Bravura in the stores: ask "how many oil filters are free?" or say "issue 4 oil filters to the Workshop" / "send 10 boots to Selous" — it shows a card, and nothing moves until you press Confirm. Out-of-stock items, shipments on the road over 5 days, counts off by more than 5% and batches expiring in 14 days come as alerts.</>,
            <>Every stores move is priced by the system at the store's average cost and posted to Finance; nothing can take a store below zero. Camp Supplies (CA06) now uses Stores issues.</>,
            <>Adjustments (<Code>IN09</Code>) allows authorised users to add or subtract stock with a mandatory reason — requires the Approve permission.</>,
            <>Stock Take (<Code>IN13</Code>) runs a physical count against system balances — auto-populates a count sheet, calculates variances, and posts every difference in one step on approval, with the variance in dollars.</>,
            <>Requests (<Code>PR07</Code>, also under Stores) let site staff ask for goods or services. See the Procurement — requests section below.</>,
            <>Purchase Orders (<Code>IN15</Code>) track procurement end-to-end — create from scratch or from an approved requisition, send to supplier, then receive goods against the PO.</>,
            <>Reorder &amp; Expiry (<Code>IN16</Code>): give items a reorder level and quantity. When issues take a store down to that level, the item is added automatically to the store's draft requisition — review it, then submit. Record batch numbers and expiry dates on goods received; issues suggest the earliest-expiring batch, and the expiry list shows what's expired or expiring soon.</>,
            <>Stock Take (<Code>IN13</Code>): choose <b>Cycle count</b> to count just the items not counted for longest (highest value first) instead of the whole store.</>,
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

      {/* Scheduled report emails */}
      <Section icon="forward_to_inbox" color={MODULE_COLORS.notifications || '#F57C00'} title="Email reports">
        <Steps items={[
          <>My Preferences (<Code>NT03</Code>) → <b>Email reports</b>: tick a report to have it emailed to you daily, weekly or monthly at the hour you choose, for the site you're on. <b>Preview</b> shows what it will contain. Only reports you have access to are offered: the site daily summary, fleet, procurement, people and finance.</>,
        ]} />
      </Section>

      {/* Employee self-service */}
      <Section icon="person" color={MODULE_COLORS.me || '#00897B'} title="My Workspace — your own HR on your phone">
        <Steps items={[
          <>Open My Workspace (<Code>ES01</Code>) from the round maroon button just above the green chat button — on every page. Its home screen is a grid of app icons: tap one to open it, and <b>Home</b> to come back. <b>Notifications</b> and <b>Approvals</b> open right inside the panel, with red badges for anything unread or waiting. It is yours alone: every signed-in employee can open it. If it says your login isn't linked, ask HR to link it to your employee record.</>,
          <>Payslips (<Code>ES02</Code>) show every approved month with PAYE, AIDS levy and NSSA broken out. Use <b>Print or save as PDF</b> for a copy.</>,
          <>Leave (<Code>ES03</Code>) shows what you have left and lets you request leave — weekends are not counted. You can cancel while it is still pending, and you are notified when it is decided.</>,
          <>Clock in (<Code>ES04</Code>): tap <b>Clock in</b> / <b>Clock out</b> on your phone — you must be on site (location is checked). Your shift sets the hours — by default the Day Shift, 07:00–16:00; time after your shift ends counts as overtime. Your supervisor approves each day's hours, and only approved overtime is paid — 1.5× on weekdays and Saturdays, 2× on Sundays and public holidays (HR keeps the holiday list in <Code>HR39</Code>).</>,
          <>Supervisors: <b>My team</b> (<Code>ES12</Code>) appears for anyone with people reporting to them. It shows who is on site, on leave or not in today, and lets you approve timesheets (one by one or all at once) and leave requests.</>,
          <>Expenses (<Code>ES05</Code>): add each item with a photo of the receipt (required over $20), then submit. Need money before a trip? <b>Ask for an advance</b>, then claim your receipts against it afterwards — only the difference is paid out.</>,
          <>My Safety (<Code>ES06</Code>): <b>Report a hazard</b> with a photo (you can stay anonymous), and see your PPE, training, inductions and medicals with expiry dates.</>,
          <>My Details (<Code>ES07</Code>): change your phone, address, bank or next of kin. Nothing is saved until HR checks it, so they may ask for proof such as a bank letter.</>,
          <>Tax Certificate (<Code>ES08</Code>): your ITF16 figures for the year (gross, PAYE, AIDS levy, NSSA) to check against the signed copy HR issues.</>,
          <>Documents & Policies (<Code>ES09</Code>): read and accept company policies, or raise a concern. See your documents on file and when they expire.</>,
          <>My Camp (<Code>ES10</Code>): your room and roommates, report a room problem with a photo, and record meals you ate today or yesterday. Once the meals officer submits the day, ask them to add a missed meal instead.</>,
          <>Advances & Loans (<Code>ES11</Code>): a salary advance (up to half your basic pay) comes off your next payslip; a staff loan is repaid over up to 24 payslips. Both need approval.</>,
        ]} />
      </Section>

      {can('hr.view') && (
        <Section icon="manage_accounts" color={MODULE_COLORS.workforce} title="HR — self-service requests">
          <Steps items={[
            <>Detail Changes (<Code>HR37</Code>): compare each employee's current and requested details. Check the proof, then <b>Verified — apply</b>, or reject with a note telling them what's needed.</>,
            <>Advances & Loans (<Code>HR38</Code>): approve or reject requests (or use the Approvals Inbox if a route is set up), then <b>Mark paid out</b> once the money has gone — this posts to the ledger. Payroll deducts instalments automatically.</>,
          ]} />
        </Section>
      )}

      {can('accommodation.view') && (
        <Section icon="build" color={MODULE_COLORS.campsite} title="Camp — room faults">
          <Steps items={[
            <>Room Faults (<Code>CA09</Code>) lists problems residents reported. Move each one from <b>Start work</b> to <b>Mark fixed</b> — the resident is told when it's fixed.</>,
          ]} />
        </Section>
      )}

      {can('procurement.view') && (
        <Section icon="request_quote" color={MODULE_COLORS.procurement} title="Procurement — quotes, budgets and suppliers">
          <Steps items={[
            <>Quotes (<Code>PR03</Code> → <b>Quotes &amp; award</b>): record each supplier's unit prices, lead time and validity against the RFQ. The comparison highlights the cheapest price per line and in total. <b>Award</b> creates a draft purchase order; choosing a dearer quote needs a reason.</>,
            <>Budgets (<Code>PR11</Code>): set a yearly budget per cost centre or project. A purchase order tagged with it can't be sent once it would go over — someone with procurement approval can override with a reason, which is recorded on the order.</>,
            <>Supplier Performance (<Code>PR12</Code>): <b>aging</b> shows unpaid supplier invoices by days overdue; <b>scorecards</b> rate each supplier on on-time delivery and quality (rejections at GRN), with spend, lead time and quotes won.</>,
            <>Document numbers are now per site and year, e.g. KAM-PO-2026-0001, and are assigned when the document is saved.</>,
          ]} />
        </Section>
      )}

      {can('assets.view') && (
        <Section icon="inventory" color={MODULE_COLORS.finance} title="Finance — fixed assets">
          <Steps items={[
            <>Asset Register (<Code>FI16</Code>): set up <b>Categories</b> with a default method and life, then <b>Import fleet</b> to bring every vehicle and machine in as a draft (numbered like KAM-FA-2026-0001). Enter each asset's cost, acquisition date and useful life, then <b>Capitalise</b> it — cost and depreciation settings lock from then on.</>,
            <>Moving an asset, changing its custodian, category, cost centre or project is logged in its history automatically.</>,
            <>Depreciation (<Code>FI17</Code>): pick a month and <b>Run depreciation</b>. Each asset in use is charged once (straight line or reducing balance, never below salvage value) and posted to the ledger through the "Monthly depreciation" rule in Posting Rules (<Code>FI13</Code>).</>,
            <>Asset Counts (<Code>FI18</Code>): start a count, mark each asset found (with condition) or missing, then close it. Missing assets alert whoever can dispose of assets; <b>Dispose</b> or write off from the register — the ledger entries post automatically.</>,
            <>Costs by Cost Centre &amp; Project (<Code>FI19</Code>): pick a cost centre or project on purchase orders, work orders, fleet vehicles/equipment and fixed assets. Everything they post to the ledger (receipts, invoices, fuel, depreciation) carries the same tags, so this report shows spend per cost centre or project for any date range.</>,
          ]} />
        </Section>
      )}

      {(can('expenses.view') || can('expenses.approve') || can('expenses.edit') || can('pettycash.view') || can('pettycash.edit')) && (
        <Section icon="savings" color={MODULE_COLORS.finance} title="Finance — expense claims and petty cash">
          <Steps items={[
            <>Expense Claims (<Code>FI14</Code>): <b>To approve</b> lists submitted claims and advance requests; open the lines to check receipts. <b>To pay</b> lists approved ones — pay by bank (IMTT is added automatically) or in cash from a petty cash fund.</>,
            <>Claims against an advance use up the advance first; only the balance is paid. Advances not yet accounted for are listed at the top.</>,
            <>Petty Cash (<Code>FI15</Code>): create a fund per site with a custodian and a float. Record every cash spend with its receipt, top up to the float from the bank, and count the box regularly — any shortage or overage is booked automatically.</>,
            <>Entries can't be edited or deleted — void and re-enter. All of it posts to the ledger once the Expenses and Petty cash rules are set in Posting Rules (<Code>FI13</Code>). None of it is revenue.</>,
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

      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="menu_book" color={MODULE_COLORS.finance} title="Finance — what's where">
          <Steps items={[
            <>Finance is grouped by job: <b>Finance Home</b>, <b>Pay Suppliers</b>, <b>Claims &amp; Petty Cash</b>, <b>Bank &amp; Cash</b>, <b>Budgets</b>, <b>Reports &amp; Explorer</b>, <b>Month-end</b>, <b>Ledger</b> (chart of accounts, journals, posting rules, cost centres — <Code>FI26</Code>), <b>Fixed Assets</b> (register, depreciation, counts — <Code>FI28</Code>) and <b>Set Up the Books</b>. Old codes like FI01 or FI16 open the right tab.</>,
            <><b>Quick spend</b> at the top of Claims &amp; Petty Cash (<Code>FI27</Code>) works on a phone: pick the fund, type the amount and what it was for, snap the slip, press <b>Record spend</b>.</>,
            <><b>Supplier statements</b> (a tab in Pay Suppliers): choose the supplier, the statement date and the balance on their statement. Tick our bills that appear on it — the screen shows what's still unexplained. <b>Agree statement</b> when it matches, or save the differences to follow up.</>,
            <>On Finance Home press <b>Customise</b> to move widgets up or down or hide them — it's saved for you. In Reports → Explorer, <b>Add to Finance Home</b> turns the current view (e.g. costs by cost centre this month) into your own widget.</>,
          ]} />
        </Section>
      )}
      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="event_available" color={MODULE_COLORS.finance} title="Finance — reports and month-end">
          <Steps items={[
            <><b>Reports &amp; Explorer</b> (<Code>FI24</Code>): Operating costs (this period, the period before and year to date — a costs statement, since Bravura doesn't sell), Balance sheet, Trial balance and Cash flow for any period. Export to CSV or print.</>,
            <>The <b>Explorer</b> tab splits costs by heading, account, cost centre, project, month or where they came from (fuel, payroll, bills…).</>,
            <><b>Month-end</b> (<Code>FI25</Code>) lists the checks for each month: no draft journals, no postings waiting, bank reconciled, payroll approved, depreciation run, bills approved. Someone with finance approval closes the month — add a note if an optional check isn't done.</>,
            <>A closed month is locked: nothing can be posted into it. Reopen it with a reason if a correction is needed. Months close in order.</>,
          ]} />
        </Section>
      )}
      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="account_balance" color={MODULE_COLORS.finance} title="Finance — bank statements and reconciliation">
          <Steps items={[
            <>In <b>Bank &amp; Cash</b> (<Code>FI23</Code>) press <b>Import statement</b> and choose the CSV or Excel file from internet banking. Check the columns (date, description, amount or money in/out) and import — lines already imported are skipped.</>,
            <>Lines are matched automatically: to a posted payment of the same amount within 5 days, or to a <b>matching rule</b> (e.g. description contains ZESA → Electricity, Camp). Press <b>Confirm</b>, or <b>Confirm all suggestions</b>.</>,
            <>For anything else press <b>Find or post</b>: match it to a journal, or post it to an account and cost centre. Tick <b>Remember</b> to turn it into a rule for next time.</>,
            <>The top of the page shows the balance per bank against the balance per books and how much is still to explain. <b>Unmatch</b> reopens a line (a journal it created is voided).</>,
          ]} />
        </Section>
      )}
      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="savings" color={MODULE_COLORS.finance} title="Finance — Finance Home and budgets">
          <Steps items={[
            <><b>Finance Home</b> (<Code>FI12</Code>) shows the month at a glance: spend against budget, cash and bank, what is owed to suppliers, petty cash, a 12-month spend chart, where the money went, cost by site and project, bills due in the next 14 days, and a <b>Needs attention</b> list. Click anything to go to it.</>,
            <>In <b>Budgets</b> (<Code>FI22</Code>) set a yearly budget per cost centre or project. Leave it as even months, or tick <b>Plan it month by month</b>. Procurement uses the same budgets to check purchase orders.</>,
            <>Each line shows the month's plan and spend, the year budget, <b>Committed</b> (approved POs not yet billed) and what is <b>really left</b>. On track is green, 90% used is ochre, over is red.</>,
          ]} />
        </Section>
      )}
      {(can('finance.view') || can('procurement.view') || can('inventory.view')) && (
        <Section icon="auto_awesome" color={MODULE_COLORS.finance} title="Ask Bravura — the assistant">
          <Steps items={[
            <>Press the <b>✦ Ask Bravura</b> button at the bottom centre of any screen. Ask in plain words — "what needs my attention here?", "total the overdue bills on this screen", "how much did we spend on diesel this month?".</>,
            <>It reads the screen you're on (untick <b>Using this screen</b> if you don't want that), looks things up in your records — only sites and modules you have access to — and does sums exactly. Records it mentions (POs, requests, journals) appear as links you can open.</>,
            <>It never changes anything on its own. Ask it to <b>receive a delivery</b>, <b>draft a bill</b> from an invoice, <b>record a petty cash spend</b> or <b>draft a request</b> and it shows a card — nothing is saved until you press <b>Confirm</b>. Attach a photo or PDF with 📎 (or paste / drop it) and it reads it and matches it to the supplier and PO; after you confirm, the file is kept on that record.</>,
            <>Tap 🎤 to speak instead of typing ("received 20 bags of cement on PO 12, two torn") — it turns it into text for you to check. <b>Your day</b> on the home screen lists approvals waiting for you, late deliveries, low stock, things expiring, budgets at risk and alerts (unusual fuel draws, price jumps, duplicate bills).</>,
            <>If it quotes a figure it can't trace to your records it says <b>⚠ Check this figure</b>. Drag the panel's header to move it and any edge or corner to resize it; double-click the header to reset. Rate answers 👍 / 👎 so we know what to improve.</>,
          ]} />
        </Section>
      )}
      {can('users.view') && (
        <Section icon="auto_awesome" color={MODULE_COLORS.admin || MODULE_COLORS.finance} title="Ask Bravura admin">
          <Steps items={[
            <>Open <b>Admin → Ask Bravura</b> (<Code>AD12</Code>) to see who uses it and what it looks up, answers that need a look (errors, 👎, untraced figures, "couldn't answer"), and every action proposed and confirmed.</>,
            <>Under <b>Limits</b> set questions per person and per site each day, or switch it off for a site. <b>AI register</b> lists each AI feature with its risks and the human check that goes with it.</>,
          ]} />
        </Section>
      )}

      {(can('procurement.view') || can('procurement.create') || can('inventory.create')) && (
        <Section icon="assignment" color={MODULE_COLORS.procurement || MODULE_COLORS.finance} title="Procurement — requests and Procurement Home">
          <Steps items={[
            <>Anyone who needs something opens <b>Requests</b> (<Code>PR07</Code>) and presses <b>New request</b>. Choose <b>Buy it</b> or <b>Transfer from another site</b>, the site it's for, what it's for, when it's needed, and the department, cost centre, project or fleet work order.</>,
            <>Add lines: search the stock catalogue, or just type a service (e.g. "tyre fitting"). For stock items the form shows how many are <b>in stock at this site and at other sites</b> — if your stores has it, ask them to issue it; if another site has it, make it a transfer instead of buying.</>,
            <><b>Send for approval</b> — it goes to your line manager (department head) in the Approvals inbox. The tabs show <b>My requests</b>, <b>Waiting approval</b>, <b>To order</b> (approved purchases for HQ Procurement) and <b>Transfers to send</b>.</>,
            <>For an approved transfer, the sending site's stores opens it, picks the store to send from and to, and presses <b>Move stock now</b> — the stock leaves one store and arrives in the other at its current value.</>,
            <><b>Purchase Orders</b> (<Code>PR04</Code>) → <b>To order</b> lists approved request lines. Tick lines for one site, pick suppliers and press the button: <b>one supplier</b> makes a draft order (prices filled from the last price paid); <b>two or more</b> asks each for a quote.</>,
            <>In <b>Quotes</b>, open each supplier's quote and type the prices they gave you (<b>Mark quote sent</b> once you've sent it). <b>Compare quotes</b> shows every supplier's price per line with the cheapest in green; press <b>Choose this supplier</b> on the winner — the other quotes are cancelled automatically.</>,
            <>Confirming goes for approval by amount: up to $1,000 one procurement approver; up to $10,000 two; above $10,000 two plus finance. After approval the order is <b>Ordered</b> and <b>locked</b>. To change it, press <b>Amend</b> — the order is cancelled and copied to a new draft (e.g. PO-0012-1). The requests it came from show as <b>Ordered</b>.</>,
            <>The <b>Orders</b> list shows for each PO what's been received and billed, with filters for <b>late</b>, <b>waiting approval</b> and <b>received, not billed</b>. <b>Tracking</b> records delivery events.</>,
            <>On an ordered PO press <b>Create confirmation link</b> and send it by <b>Email</b> or <b>WhatsApp</b>. The supplier opens it without logging in, confirms the order and gives delivery dates — you're notified and the PO shows <b>Confirmed by …</b>. Reminders arrive automatically before deliveries are due, when they're late, and when a supplier hasn't confirmed after 2 days.</>,
            <><b>Receiving</b> (<Code>PR08</Code>) lists open orders for your site. Open one, enter what arrived (and anything rejected, with the reason) and the delivery note number, then press <b>Receive delivery</b> — stock goes on the shelf and services are marked done. Stores → Goods Received is now only for stock without a PO (opening stock, donations), with a reason.</>,
            <><b>Suppliers</b> (<Code>PR02</Code>): each supplier's profile has <b>Details</b> (bank, days to pay, reminder days), a <b>Price list</b> (agreed prices, minimum quantity, lead time, valid dates — used first when orders are priced), a <b>Scorecard</b> (on-time %, lead time, rejects, spend), their <b>Orders</b>, and <b>Hold</b> — a procurement or finance approver can stop new orders, bills or payments for a supplier.</>,
            <><b>Agreements</b> (<Code>PR13</Code>): a <b>blanket order</b> fixes prices (and optionally quantities) with one supplier for a period; a <b>purchase template</b> is a list you reorder often. A procurement approver activates it; then <b>Order from this</b> makes a draft PO at the agreed prices, and the card shows how much of the agreement has been used.</>,
            <><b>Bills</b> are now recorded and approved by Accounting in Finance → Pay Suppliers → <b>Record &amp; approve bills</b>. When head office pays a site's bill (or tops up its petty cash), the site's books show the cost and an amount owed to head office; <b>Head office &amp; sites</b> shows those balances and who pays for each site.</>,
            <><b>Reports</b> (<Code>PR06</Code>): requested-not-ordered, ordered-not-received, the full tracker (request → order → received → billed → paid), purchase history per item, spend by supplier / site / category and supplier delivery performance — each exports to CSV. In Purchase Orders → To order, <b>Draft orders for stores shortages</b> puts everything below its reorder level on draft POs by supplier. A PO for a fleet job shows on that work order, and every PO has a <b>Paper trail</b>.</>,
            <><b>Procurement Home</b> (<Code>PR01</Code>) shows what's waiting — requests to approve and order, POs to approve, late deliveries, goods received but not billed — plus this month's ordering against budget per site. HQ staff can switch between <b>this site</b> and <b>all sites</b>.</>,
          ]} />
        </Section>
      )}

      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="payments" color={MODULE_COLORS.finance} title="Finance — paying suppliers">
          <Steps items={[
            <>Bills are recorded against their PO and GRN in Procurement → Purchase Invoices (<Code>PR09</Code>) and approved there. The due date fills in from the supplier's payment terms (set on the supplier, with their bank details).</>,
            <>Every bill is checked automatically: <b>PO · GRN · bill match</b>, <b>Price differs</b> (billed more than received at the PO price), <b>Quantity differs</b> or <b>Not received yet</b>. Sort out mismatches before paying.</>,
            <>In <b>Pay Suppliers</b> (<Code>FI21</Code>) tick approved bills under <b>To pay</b> or <b>Overdue</b> and press <b>Pay</b> to prepare a payment run. The 2% IMTT is shown on top.</>,
            <>Someone with finance approval permission approves the run. Download the <b>Bank list (CSV)</b> for the bank, make the transfer, then press <b>Mark paid</b> with the bank reference — every bill in the run is marked paid and posted to the ledger with its IMTT.</>,
          ]} />
        </Section>
      )}

      {(can('procurement.edit') || can('finance.edit')) && (
        <Section icon="fact_check" color={MODULE_COLORS.finance} title="Finance — contractor bills and accrued work">
          <Steps items={[
            <>Approved casual timesheets, approved hired-equipment usage logs and closed SHEQ incidents with an actual cost are booked as cost straight away, held in <b>Other accruals</b> until the contractor's bill arrives. Stores issues, returns and stock-count differences also post to the ledger by themselves.</>,
            <>When you enter a bill in Purchase Invoices (<Code>PR09</Code>) without a GRN, answer <b>What is this bill for?</b> — choose <b>Contract labour, hired plant or incident costs</b> for work already booked, so the cost isn't counted twice.</>,
            <>Open the draft bill and, under <b>Accrued work this bill covers</b>, tick the timesheets, usage logs or incidents it pays for, then <b>Save matching</b>. The box shows how much is matched and any difference.</>,
            <>On approval exactly the matched amount leaves Other accruals. If the bill is lower than what was accrued the difference is released; if higher, the extra is added as cost. Each item can only be on one bill; cancelling a bill frees its items.</>,
          ]} />
        </Section>
      )}

      {/* Finance */}
      {(can('finance.view') || can('finance.edit')) && (
        <Section icon="account_balance" color={MODULE_COLORS.finance} title="Finance — automatic posting">
          <Steps items={[
            <>Start with <b>Set Up the Books</b> (<Code>FI20</Code>): six guided steps — financial year, the mining chart of accounts (tick what you use), posting rules filled in for you, opening balances, bank accounts, then <b>Go live</b> (needs finance approval). Nothing dated before the go-live date auto-posts; the opening balances cover it.</>,
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

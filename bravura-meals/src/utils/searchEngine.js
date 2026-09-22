import { supabase } from '../supabaseClient';

export const SEARCH_CATEGORIES = [
  { type: 'employee', label: 'Employees', icon: 'badge', color: '#1565C0' },
  { type: 'vehicle', label: 'Fleet', icon: 'directions_car', color: '#00838F' },
  { type: 'fuel', label: 'Fuel', icon: 'local_gas_station', color: '#E65100' },
  { type: 'incident', label: 'Incidents', icon: 'warning', color: '#C62828' },
  { type: 'room', label: 'Rooms', icon: 'bed', color: '#6A1B9A' },
  { type: 'supplier', label: 'Suppliers', icon: 'storefront', color: '#2E7D32' },
];

const categoryMeta = Object.fromEntries(SEARCH_CATEGORIES.map(c => [c.type, c]));

async function searchEmployees(query, siteId) {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, employee_number, department_id, departments(name)')
    .eq('site_id', siteId)
    .or(`name.ilike.${pattern},employee_number.ilike.${pattern}`)
    .limit(5);
  if (error) throw error;
  return (data || []).map(e => ({
    type: 'employee',
    label: e.name,
    sublabel: [e.employee_number, e.departments?.name].filter(Boolean).join(' · '),
    icon: categoryMeta.employee.icon,
    path: `/workforce/wf_employee_detail:${e.id}`,
    color: categoryMeta.employee.color,
  }));
}

async function searchFleetAssets(query) {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from('fleet_assets')
    .select('id, name, registration_number, asset_type, status')
    .or(`registration_number.ilike.${pattern},name.ilike.${pattern},asset_type.ilike.${pattern}`)
    .limit(5);
  if (error) throw error;
  return (data || []).map(a => ({
    type: 'vehicle',
    label: a.registration_number || a.name,
    sublabel: [a.asset_type, a.status].filter(Boolean).join(' · '),
    icon: categoryMeta.vehicle.icon,
    path: a.asset_type === 'equipment' ? '/fleet/fleet_equipment' : '/fleet/fleet_vehicles',
    color: categoryMeta.vehicle.color,
  }));
}

async function searchFuelTransactions(query, siteId) {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from('fuel_transactions')
    .select('id, transaction_date, quantity, fleet_assets(name, registration_number)')
    .eq('site_id', siteId)
    .or(`transaction_date.ilike.${pattern}`)
    .limit(5);

  // fleet_assets join filter not possible via .or on joined table with ilike,
  // so we fetch by date match and also do a second query by vehicle name
  const { data: byVehicle, error: err2 } = await supabase
    .from('fleet_assets')
    .select('id, name, registration_number')
    .or(`name.ilike.${pattern},registration_number.ilike.${pattern}`)
    .limit(5);

  let vehicleResults = [];
  if (!err2 && byVehicle?.length) {
    const vehicleIds = byVehicle.map(v => v.id);
    const { data: txns } = await supabase
      .from('fuel_transactions')
      .select('id, transaction_date, quantity, fleet_assets(name, registration_number)')
      .eq('site_id', siteId)
      .in('vehicle_id', vehicleIds)
      .limit(5);
    vehicleResults = txns || [];
  }

  const merged = new Map();
  for (const t of [...(data || []), ...vehicleResults]) {
    if (!merged.has(t.id)) merged.set(t.id, t);
  }

  return [...merged.values()].slice(0, 5).map(t => ({
    type: 'fuel',
    label: t.fleet_assets?.registration_number || t.fleet_assets?.name || `Transaction ${t.id}`,
    sublabel: [t.transaction_date, t.quantity ? `${t.quantity}L` : null].filter(Boolean).join(' · '),
    icon: categoryMeta.fuel.icon,
    path: '/fuel/fuel_transactions',
    color: categoryMeta.fuel.color,
  }));
}

async function searchIncidents(query, siteId) {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from('sheq_incidents')
    .select('id, reference_number, title, severity, status')
    .eq('site_id', siteId)
    .or(`reference_number.ilike.${pattern},title.ilike.${pattern}`)
    .limit(5);
  if (error) throw error;
  return (data || []).map(i => ({
    type: 'incident',
    label: i.reference_number || i.title,
    sublabel: [i.title, i.severity, i.status].filter(Boolean).join(' · '),
    icon: categoryMeta.incident.icon,
    path: '/sheq/sq_incidents',
    color: categoryMeta.incident.color,
  }));
}

async function searchRooms(query) {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from('rooms')
    .select('id, room_number, block_id, blocks(name)')
    .or(`room_number.ilike.${pattern}`)
    .limit(5);
  if (error) throw error;
  return (data || []).map(r => ({
    type: 'room',
    label: `Room ${r.room_number}`,
    sublabel: r.blocks?.name || '',
    icon: categoryMeta.room.icon,
    path: '/campsite/camp_rooms',
    color: categoryMeta.room.color,
  }));
}

async function searchSuppliers(query) {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, code')
    .or(`name.ilike.${pattern},code.ilike.${pattern}`)
    .limit(5);
  if (error) throw error;
  return (data || []).map(s => ({
    type: 'supplier',
    label: s.name,
    sublabel: s.code || '',
    icon: categoryMeta.supplier.icon,
    path: '/procurement/proc_suppliers',
    color: categoryMeta.supplier.color,
  }));
}

export async function searchEntities(query, siteId, options = {}) {
  if (!query || query.trim().length < 2) return [];

  const trimmed = query.trim();
  const { types } = options;

  const searches = [
    { type: 'employee', fn: () => searchEmployees(trimmed, siteId) },
    { type: 'vehicle', fn: () => searchFleetAssets(trimmed) },
    { type: 'fuel', fn: () => searchFuelTransactions(trimmed, siteId) },
    { type: 'incident', fn: () => searchIncidents(trimmed, siteId) },
    { type: 'room', fn: () => searchRooms(trimmed) },
    { type: 'supplier', fn: () => searchSuppliers(trimmed) },
  ].filter(s => !types || types.includes(s.type));

  const results = await Promise.all(
    searches.map(s =>
      s.fn().catch(err => {
        console.error(`Search failed for ${s.type}:`, err);
        return [];
      })
    )
  );

  return results.flat();
}

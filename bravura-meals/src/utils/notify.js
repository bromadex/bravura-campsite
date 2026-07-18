// ─── Notification Utility ───────────────────────────────────────────────────
import { supabase } from '../supabaseClient'

/**
 * Notification type definitions — icon (Material Symbols) + color (THEME key).
 * Used by the notification drawer in ModuleLayout and HomeLauncher.
 */
export const NOTIF_TYPES = {
  // Fuel
  fuel_alert:              { icon: 'warning',         colorKey: 'error' },
  fuel_warning:            { icon: 'info',            colorKey: 'warning' },
  // Meals
  meals_submitted:         { icon: 'upload',          colorKey: 'info' },
  meals_approved:          { icon: 'check_circle',    colorKey: 'success' },
  meals_returned:          { icon: 'undo',            colorKey: 'warning' },
  meals_confirmed:         { icon: 'restaurant',      colorKey: 'success' },
  // Inventory
  inventory_approval:      { icon: 'approval',        colorKey: 'info' },
  inventory_po_received:   { icon: 'move_to_inbox',   colorKey: 'success' },
  // Requisitions
  requisition_submitted:   { icon: 'assignment',      colorKey: 'info' },
  requisition_approved:    { icon: 'check_circle',    colorKey: 'success' },
  // Leave
  leave_submitted:         { icon: 'event_note',      colorKey: 'info' },
  leave_approved:          { icon: 'event_available',  colorKey: 'success' },
  leave_rejected:          { icon: 'event_busy',      colorKey: 'error' },
  // Fleet
  fleet_maintenance:       { icon: 'build',           colorKey: 'warning' },
  // HR
  hr_transfer:             { icon: 'swap_horiz',      colorKey: 'info' },
  // Stock take
  stock_take_completed:    { icon: 'inventory_2',     colorKey: 'success' },
  // General
  general_approval:        { icon: 'thumb_up',        colorKey: 'info' },
  general_alert:           { icon: 'notifications',   colorKey: 'warning' },
}

/**
 * Helper: resolve a notification type to { icon, color } given a THEME object.
 * Falls back to generic icon/color for unknown types.
 */
export function resolveNotifStyle(type, THEME) {
  const entry = NOTIF_TYPES[type]
  if (entry) {
    return { icon: entry.icon, color: THEME[entry.colorKey] || THEME.textMed }
  }
  return { icon: 'notifications', color: THEME.textMed }
}

/**
 * Insert a notification record for a specific user.
 */
export async function sendNotification({ recipientId, type, title, body, actionUrl }) {
  const { error } = await supabase.from('notifications').insert({
    recipient_id: recipientId,
    type,
    title,
    body,
    action_url: actionUrl || null,
    is_read: false,
  })
  if (error) console.error('sendNotification failed:', error.message)
  return { error }
}

/**
 * Find all users at a site who hold a given permission code, then notify each.
 * Uses permission code matching (never role names).
 */
export async function notifyApprovers({ siteId, permissionCode, type, title, body, actionUrl }) {
  // Find user IDs who have the given permission at the given site
  const { data: roles, error: rolesErr } = await supabase
    .from('user_roles')
    .select('user_id, role_id, role_permissions!inner(permission_id, permissions!inner(code))')
    .eq('site_id', siteId)
    .eq('role_permissions.permissions.code', permissionCode)

  if (rolesErr) {
    console.error('notifyApprovers lookup failed:', rolesErr.message)
    return { error: rolesErr }
  }

  // Deduplicate user IDs
  const userIds = [...new Set((roles || []).map(r => r.user_id))]

  // Send a notification to each
  const results = await Promise.allSettled(
    userIds.map(uid => sendNotification({ recipientId: uid, type, title, body, actionUrl }))
  )

  return { notified: userIds.length, results }
}

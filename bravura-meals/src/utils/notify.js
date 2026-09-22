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
  fuel_approved:           { icon: 'check_circle',    colorKey: 'success' },
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
  leave_request:           { icon: 'event_note',      colorKey: 'warning' },
  leave_submitted:         { icon: 'event_note',      colorKey: 'info' },
  leave_approved:          { icon: 'event_available',  colorKey: 'success' },
  leave_rejected:          { icon: 'event_busy',      colorKey: 'error' },
  leave_forwarded:         { icon: 'forward_to_inbox', colorKey: 'info' },
  // Fleet
  fleet_maintenance:       { icon: 'build',           colorKey: 'warning' },
  // HR
  hr_transfer:             { icon: 'swap_horiz',      colorKey: 'info' },
  // Stock take
  stock_take_completed:    { icon: 'inventory_2',     colorKey: 'success' },
  // SHEQ
  incident_reported:       { icon: 'report_problem',  colorKey: 'error' },
  // Governance
  policy_pending:          { icon: 'policy',          colorKey: 'warning' },
  announcement_posted:     { icon: 'campaign',        colorKey: 'info' },
  // Connect / Chat
  chat_message:            { icon: 'chat',            colorKey: 'info' },
  chat_mention:            { icon: 'alternate_email', colorKey: 'info' },
  // Procurement
  po_approval_required:    { icon: 'shopping_bag',    colorKey: 'warning' },
  // Campsite
  room_assigned:           { icon: 'hotel',           colorKey: 'success' },
  room_transferred:        { icon: 'swap_horiz',      colorKey: 'info' },
  // General
  success:                 { icon: 'check_circle',    colorKey: 'success' },
  info:                    { icon: 'info',            colorKey: 'info' },
  warning:                 { icon: 'warning',         colorKey: 'warning' },
  error:                   { icon: 'error',           colorKey: 'error' },
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
 * Accepts both old-style (recipientId/body/actionUrl) and new-style (userId/message/link) params.
 */
export async function sendNotification({ recipientId, userId, type, title, body, message, actionUrl, link, siteId, category }) {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId || recipientId,
    site_id: siteId || null,
    type,
    title,
    message: message || body || null,
    link: link || actionUrl || null,
    category: category || 'general',
    is_read: false,
    is_archived: false,
  })
  if (error) console.error('sendNotification failed:', error.message)
  return { error }
}

/**
 * Find all users at a site who hold a given permission code, then notify each.
 * Uses permission code matching (never role names).
 */
export async function notifyApprovers({ siteId, permissionCode, type, title, body, message, actionUrl, link, category }) {
  const { data: roles, error: rolesErr } = await supabase
    .from('user_roles')
    .select('user_id, role_id, role_permissions!inner(permission_id, permissions!inner(code))')
    .eq('site_id', siteId)
    .eq('role_permissions.permissions.code', permissionCode)

  if (rolesErr) {
    console.error('notifyApprovers lookup failed:', rolesErr.message)
    return { error: rolesErr }
  }

  const userIds = [...new Set((roles || []).map(r => r.user_id))]

  const results = await Promise.allSettled(
    userIds.map(uid => sendNotification({ userId: uid, siteId, type, title, message: message || body, link: link || actionUrl, category }))
  )

  return { notified: userIds.length, results }
}

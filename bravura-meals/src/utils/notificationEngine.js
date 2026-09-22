import { supabase } from '../supabaseClient'

export async function pushNotification(userId, siteId, { type, title, message, link = null, category = 'general', metadata = {} }) {
  if (!userId) return
  try {
    await supabase.from('notifications').insert([{
      id: crypto.randomUUID(),
      user_id: userId,
      site_id: siteId || null,
      type,
      title,
      message,
      link,
      metadata,
      category,
      is_read: false,
      is_archived: false,
      created_at: new Date().toISOString(),
    }])
  } catch (err) {
    console.error('[notificationEngine] push failed:', err?.message || err)
  }
}

export async function pushNotificationToGroup(userIds, siteId, notif) {
  if (!userIds?.length) return
  const unique = [...new Set(userIds.filter(Boolean))]
  await Promise.all(unique.map(uid => pushNotification(uid, siteId, notif)))
}

export async function pushNotificationToPermission(permissionCode, siteId, notif) {
  if (!permissionCode || !siteId) return
  try {
    const { data } = await supabase.rpc('get_users_with_permission', {
      p_code: permissionCode,
      p_site_id: siteId,
    })
    if (data?.length) {
      await pushNotificationToGroup(data.map(u => u.user_id), siteId, notif)
    }
  } catch (err) {
    console.error('[notificationEngine] permission push failed, falling back to direct query:', err?.message)
    try {
      const { data: permRow } = await supabase
        .from('permissions')
        .select('id')
        .eq('code', permissionCode)
        .maybeSingle()
      if (!permRow) return

      const { data: rolePerms } = await supabase
        .from('role_permissions')
        .select('role_id')
        .eq('permission_id', permRow.id)
      if (!rolePerms?.length) return

      const roleIds = rolePerms.map(rp => rp.role_id)
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role_id', roleIds)
        .or(`site_id.eq.${siteId},site_id.is.null`)
      if (!userRoles?.length) return

      await pushNotificationToGroup(userRoles.map(ur => ur.user_id), siteId, notif)
    } catch (err2) {
      console.error('[notificationEngine] fallback query failed:', err2?.message || err2)
    }
  }
}

export async function pushNotificationFromTemplate(eventType, variables = {}, recipientSpec = {}, siteId = null, fallback = null) {
  try {
    const { data: tmpl } = await supabase
      .from('notification_templates')
      .select('type, title, message, link, category, is_enabled')
      .eq('event_type', eventType)
      .maybeSingle()

    let notif
    if (!tmpl || !tmpl.is_enabled) {
      if (fallback) {
        notif = fallback
      } else {
        return
      }
    } else {
      const interpolate = (str = '') =>
        str.replace(/\{\{(\w+)\}\}/g, (_, k) => (variables[k] !== undefined ? String(variables[k]) : `{{${k}}}`))

      notif = {
        type: tmpl.type,
        title: interpolate(tmpl.title),
        message: interpolate(tmpl.message),
        link: tmpl.link || null,
        category: tmpl.category || 'general',
        metadata: variables,
      }
    }

    const { userId, userIds, permission } = recipientSpec

    if (userId) await pushNotification(userId, siteId, notif)
    if (userIds) await pushNotificationToGroup(userIds, siteId, notif)
    if (permission) await pushNotificationToPermission(permission, siteId, notif)
  } catch (err) {
    console.error('[notificationEngine] template push failed:', err?.message || err)
  }
}

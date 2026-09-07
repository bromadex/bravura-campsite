import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { useSite } from '../contexts/SiteContext'

export function useDepartment() {
  const { user } = useAuth()
  const { currentSiteId } = useSite()
  const [department, setDepartment] = useState(null)
  const [memberRole, setMemberRole] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id || !currentSiteId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('user_id', user.id)
        .eq('site_id', currentSiteId)
        .maybeSingle()

      if (cancelled || !emp) { setLoading(false); return }

      const { data: membership } = await supabase
        .from('department_members')
        .select('role, department:departments(*)')
        .eq('employee_id', emp.id)
        .limit(1)
        .maybeSingle()

      if (cancelled) return
      if (membership) {
        setDepartment(membership.department)
        setMemberRole(membership.role)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user?.id, currentSiteId])

  return { department, memberRole, loading }
}

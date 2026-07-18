import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

export function useRealtimeRefresh(table, filter) {
  const [tick, setTick] = useState(0)
  useRealtimeSubscription(table, filter, () => setTick(n => n + 1))
  return tick
}

export function useRealtimeSubscription(table, filter, onUpdate) {
  const callbackRef = useRef(onUpdate)
  callbackRef.current = onUpdate

  useEffect(() => {
    if (!table) return

    const channelName = `realtime_${table}_${filter?.column || 'all'}_${filter?.value || 'all'}_${Date.now()}`

    let channelConfig = { event: '*', schema: 'public', table }
    if (filter?.column && filter?.value) {
      channelConfig.filter = `${filter.column}=eq.${filter.value}`
    }

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', channelConfig, (payload) => {
        callbackRef.current(payload)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, filter?.column, filter?.value])
}

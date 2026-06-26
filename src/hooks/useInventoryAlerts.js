import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

/**
 * In-app inventory alert feed (powers the NotificationBell + toasts).
 *
 * Reads inventory_alerts (written nightly by generate_inventory_alerts(), or on
 * demand). Polls every 60s; fires a Sonner toast the first time a new
 * critical/warn alert appears in this browser session.
 */
async function fetchUnreadAlerts() {
  const { data, error } = await supabase
    .from('inventory_alerts')
    .select('*')
    .eq('status', 'unread')
    .order('created_date', { ascending: false })
    .limit(100);
  if (error) { console.error('[inventory_alerts]', error.message); return []; }
  return data || [];
}

export function useInventoryAlerts({ toastOnNew = false } = {}) {
  const queryClient = useQueryClient();
  const seenIds = useRef(null); // null until first load so we don't toast the backlog

  const query = useQuery({
    queryKey: ['inventory-alerts-unread'],
    queryFn: fetchUnreadAlerts,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const alerts = query.data || [];

  useEffect(() => {
    if (!toastOnNew) return;
    if (seenIds.current === null) {
      // First load — remember the backlog, don't toast it.
      seenIds.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const fresh = alerts.filter((a) => !seenIds.current.has(a.id));
    fresh.forEach((a) => {
      seenIds.current.add(a.id);
      if (a.severity === 'critical') toast.error(a.message);
      else if (a.severity === 'warn') toast.warning(a.message);
      else toast.info(a.message);
    });
  }, [alerts, toastOnNew]);

  const updateStatus = async (id, status) => {
    // optimistic
    queryClient.setQueryData(['inventory-alerts-unread'], (prev = []) => prev.filter((a) => a.id !== id));
    const { error } = await supabase.from('inventory_alerts').update({ status }).eq('id', id);
    if (error) {
      toast.error('Could not update alert');
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts-unread'] });
    }
  };

  const dismissAll = async () => {
    const ids = alerts.map((a) => a.id);
    if (ids.length === 0) return;
    queryClient.setQueryData(['inventory-alerts-unread'], []);
    const { error } = await supabase.from('inventory_alerts').update({ status: 'read' }).in('id', ids);
    if (error) queryClient.invalidateQueries({ queryKey: ['inventory-alerts-unread'] });
  };

  return {
    alerts,
    count: alerts.length,
    isLoading: query.isLoading,
    markRead: (id) => updateStatus(id, 'read'),
    dismiss: (id) => updateStatus(id, 'dismissed'),
    dismissAll,
  };
}

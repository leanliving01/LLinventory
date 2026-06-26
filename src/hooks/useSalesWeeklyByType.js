import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

/**
 * Weekly sales units bucketed by product type, for the dashboard category
 * charts. Returns raw rows: { week_start, type, units }. NULL-type rows are
 * empty-week anchors that keep the week axis continuous.
 */
async function fetchSalesWeeklyByType(weeks) {
  const { data, error } = await supabase.rpc('sales_weekly_by_type', { p_weeks: weeks });
  if (error) { console.error('[sales_weekly_by_type]', error.message); return []; }
  return data || [];
}

export function useSalesWeeklyByType(weeks = 13) {
  return useQuery({
    queryKey: ['sales-weekly-by-type', weeks],
    queryFn: () => fetchSalesWeeklyByType(weeks),
    staleTime: 120000,
  });
}

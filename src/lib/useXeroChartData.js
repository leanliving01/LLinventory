import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Fetches Xero Chart of Accounts and Tax Rates.
 * Returns { accounts, taxRates, isLoading, error }
 * Cached for 10 minutes.
 */
export default function useXeroChartData() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['xero-chart-data'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getXeroChartData', {});
      return res.data;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  return {
    accounts: data?.accounts || [],
    taxRates: data?.taxRates || [],
    isLoading,
    error,
  };
}
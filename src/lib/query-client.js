import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			networkMode: 'always',
			retry: 3,
			retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000), // 1s, 2s, 4s
			// 30-minute stale window — prevents mass simultaneous refetches
			// when Supabase free tier compute is throttled
			staleTime: 30 * 60 * 1000,
			// Keep cached data for 1 hour so navigating back shows content instantly
			gcTime: 60 * 60 * 1000,
		},
	},
});
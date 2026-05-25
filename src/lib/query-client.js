import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// 'always' prevents React Query from holding queries in 'pending' state
			// when it thinks the browser is offline — avoids the infinite loading
			// spinner caused by network detection false-positives.
			networkMode: 'always',
			// 5-minute stale window — data loaded in the last 5 minutes is
			// reused without a network trip. Prevents constant background
			// refetches that cause the proxy to time out and wipe the screen.
			staleTime: 5 * 60 * 1000,
			// Keep cached data for 15 minutes so navigating back to a page
			// shows content instantly while a background refresh runs.
			gcTime: 15 * 60 * 1000,
		},
	},
});
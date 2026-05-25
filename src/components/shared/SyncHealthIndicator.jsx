import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { differenceInMinutes } from 'date-fns';

const SOURCES = [
  { key: 'shopify_orders', label: 'Orders' },
  { key: 'shopify_products', label: 'Products' },
  { key: 'xero_invoices', label: 'Xero Bills' },
  { key: 'xero_purchase_orders', label: 'Xero POs' },
];

function statusColor(state) {
  if (!state) return 'bg-gray-300';
  if (state.sync_status === 'running') return 'bg-blue-500 animate-pulse';
  if (state.sync_status === 'error' || state.sync_status === 'stalled') return 'bg-red-500';
  if (!state.last_sync_at) return 'bg-gray-400';
  const ageMin = differenceInMinutes(new Date(), new Date(state.last_sync_at));
  if (ageMin < 10) return 'bg-green-500';
  if (ageMin < 30) return 'bg-amber-400';
  return 'bg-red-500';
}

function statusLabel(state) {
  if (!state) return 'Never synced';
  if (state.sync_status === 'running') return 'Syncing…';
  if (state.sync_status === 'error') return `Error: ${(state.error_message || '').slice(0, 40)}`;
  if (!state.last_sync_at) return 'Never synced';
  const ageMin = differenceInMinutes(new Date(), new Date(state.last_sync_at));
  if (ageMin < 1) return 'Just now';
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageH = Math.floor(ageMin / 60);
  return `${ageH}h ${ageMin % 60}m ago`;
}

export default function SyncHealthIndicator({ compact = false }) {
  const { data: syncStates = [] } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.list('source_key', 20),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const stateByKey = Object.fromEntries(syncStates.map(s => [s.source_key, s]));

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title="Sync health">
        {SOURCES.map(src => (
          <span
            key={src.key}
            className={`w-2 h-2 rounded-full ${statusColor(stateByKey[src.key])}`}
            title={`${src.label}: ${statusLabel(stateByKey[src.key])}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {SOURCES.map(src => {
        const state = stateByKey[src.key];
        return (
          <div key={src.key} className="flex items-center gap-1.5 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor(state)}`} />
            <span className="font-medium">{src.label}</span>
            <span className="text-muted-foreground">{statusLabel(state)}</span>
          </div>
        );
      })}
    </div>
  );
}

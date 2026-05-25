import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Sb = ReturnType<typeof createClient>;

export type SyncTriggerType = 'scheduled' | 'manual' | 'webhook' | 'reconciliation';
export type SyncStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface SyncCounts {
  records_fetched?: number;
  records_created?: number;
  records_updated?: number;
  errors_count?: number;
  error_detail?: string;
}

/**
 * Inserts a sync_logs row and returns its id.
 */
export async function startSyncLog(
  sb: Sb,
  source: string,
  triggerType: SyncTriggerType,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sb.from('sync_logs').insert({
    id,
    source,
    trigger_type: triggerType,
    started_at: now,
    status: 'running',
    records_fetched: 0,
    records_created: 0,
    records_updated: 0,
    errors_count: 0,
    created_date: now,
  });
  return id;
}

/**
 * Marks a sync_logs row as finished with final counts.
 */
export async function finishSyncLog(
  sb: Sb,
  logId: string,
  status: SyncStatus,
  counts: SyncCounts = {},
): Promise<void> {
  await sb.from('sync_logs').update({
    finished_at: new Date().toISOString(),
    status,
    records_fetched: counts.records_fetched ?? 0,
    records_created: counts.records_created ?? 0,
    records_updated: counts.records_updated ?? 0,
    errors_count: counts.errors_count ?? 0,
    error_detail: counts.error_detail ?? null,
  }).eq('id', logId);
}

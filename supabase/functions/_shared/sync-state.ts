import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Sb = ReturnType<typeof createClient>;

export interface SyncStateRow {
  id: string;
  source_key: string;
  last_cursor: string | null;
  last_sync_at: string | null;
  sync_status: 'idle' | 'running' | 'cancelling' | 'error' | 'stalled';
  records_synced: number;
  records_failed: number;
  error_message: string | null;
  updated_date: string | null;
}

export async function getSyncState(sb: Sb, sourceKey: string): Promise<SyncStateRow | null> {
  const { data } = await sb.from('sync_states').select('*').eq('source_key', sourceKey).maybeSingle();
  return (data as SyncStateRow) || null;
}

async function upsert(sb: Sb, sourceKey: string, patch: Partial<SyncStateRow>) {
  const now = new Date().toISOString();
  const existing = await getSyncState(sb, sourceKey);
  if (existing) {
    await sb.from('sync_states').update({ ...patch, updated_date: now }).eq('source_key', sourceKey);
  } else {
    await sb.from('sync_states').insert({
      id: crypto.randomUUID(),
      source_key: sourceKey,
      sync_status: 'idle',
      records_synced: 0,
      records_failed: 0,
      created_date: now,
      updated_date: now,
      ...patch,
    });
  }
}

export async function markRunning(sb: Sb, sourceKey: string, cursor: string, processedDelta = 0) {
  const existing = await getSyncState(sb, sourceKey);
  const running = existing?.sync_status === 'running';
  await upsert(sb, sourceKey, {
    last_cursor: cursor,
    sync_status: 'running',
    records_synced: running ? (existing?.records_synced || 0) + processedDelta : processedDelta,
    error_message: null,
  });
}

export async function markComplete(sb: Sb, sourceKey: string, processedDelta = 0) {
  const existing = await getSyncState(sb, sourceKey);
  await upsert(sb, sourceKey, {
    last_cursor: null,
    last_sync_at: new Date().toISOString(),
    sync_status: 'idle',
    records_synced: (existing?.records_synced || 0) + processedDelta,
    error_message: null,
  });
}

export async function markError(sb: Sb, sourceKey: string, message: string) {
  await upsert(sb, sourceKey, { sync_status: 'error', error_message: message.slice(0, 500) });
}

export async function markCancelling(sb: Sb, sourceKey: string) {
  await upsert(sb, sourceKey, { sync_status: 'cancelling' });
}

export async function markCancelled(sb: Sb, sourceKey: string) {
  await upsert(sb, sourceKey, { sync_status: 'idle', last_cursor: null });
}

export async function shouldCancel(sb: Sb, sourceKey: string): Promise<boolean> {
  const state = await getSyncState(sb, sourceKey);
  return state?.sync_status === 'cancelling';
}

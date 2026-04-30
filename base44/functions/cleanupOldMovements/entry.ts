import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Trims StockMovement records to keep a rolling 3-month window.
 * Deletes only the oldest records beyond the cutoff — one batch at a time
 * so it never does a massive bulk delete. Runs weekly.
 * Only StockMovement data is trimmed — all other data is kept forever.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString();

  console.log(`[CleanupMovements] Trimming StockMovement records older than ${cutoff}`);

  // Fetch the oldest 50 records — if they're past the cutoff, delete them
  const oldestBatch = await base44.asServiceRole.entities.StockMovement.list('created_date', 50);

  const toDelete = oldestBatch.filter(m => m.created_date < cutoff);

  if (toDelete.length === 0) {
    console.log('[CleanupMovements] Nothing to trim — all records within 3-month window');
    return Response.json({ ok: true, deleted: 0, message: 'Nothing to trim' });
  }

  for (const m of toDelete) {
    await base44.asServiceRole.entities.StockMovement.delete(m.id);
  }

  console.log(`[CleanupMovements] Trimmed ${toDelete.length} records older than 3 months`);

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'delete',
    entity_type: 'StockMovement',
    description: `Weekly trim: removed ${toDelete.length} movement records older than 3 months`,
  }).catch(() => {});

  return Response.json({ ok: true, deleted: toDelete.length, cutoff });
});
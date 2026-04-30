import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deletes StockMovement records older than 3 months.
 * Only StockMovement data is purged — all other data is kept forever.
 * Designed to run on a weekly schedule.
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

  console.log(`[CleanupMovements] Deleting StockMovement records older than ${cutoff}`);

  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch old movements in batches
    const oldMovements = await base44.asServiceRole.entities.StockMovement.filter(
      {},
      'created_date',
      50
    );

    // Filter to only records older than cutoff
    const toDelete = oldMovements.filter(m => m.created_date < cutoff);

    if (toDelete.length === 0) {
      hasMore = false;
      break;
    }

    for (const m of toDelete) {
      await base44.asServiceRole.entities.StockMovement.delete(m.id);
      totalDeleted++;
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));

    // Safety: if we fetched fewer than batch size and none were old, stop
    if (oldMovements.length < 50) hasMore = false;
  }

  console.log(`[CleanupMovements] Deleted ${totalDeleted} records older than 3 months`);

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'delete',
    entity_type: 'StockMovement',
    description: `Cleanup: deleted ${totalDeleted} movement records older than 3 months`,
  }).catch(() => {});

  return Response.json({ ok: true, deleted: totalDeleted, cutoff });
});
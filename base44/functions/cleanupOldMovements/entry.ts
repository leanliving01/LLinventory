import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deletes StockMovement records older than 3 months.
 * Only affects StockMovement — all other data is retained forever.
 * Runs as a scheduled automation.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoffISO = threeMonthsAgo.toISOString();

  console.log(`[CleanupMovements] Deleting StockMovement records older than ${cutoffISO}`);

  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch a batch of old movements
    const oldMovements = await base44.asServiceRole.entities.StockMovement.filter(
      { created_date: { $lt: cutoffISO } },
      'created_date',
      100
    );

    if (oldMovements.length === 0) {
      hasMore = false;
      break;
    }

    for (const movement of oldMovements) {
      await base44.asServiceRole.entities.StockMovement.delete(movement.id);
      totalDeleted++;
    }

    // Safety: stop after 5000 deletions per run to avoid timeouts
    if (totalDeleted >= 5000) {
      console.log(`[CleanupMovements] Reached 5000 limit, will continue next run`);
      break;
    }
  }

  console.log(`[CleanupMovements] Deleted ${totalDeleted} old StockMovement records`);

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'cleanup',
    entity_type: 'StockMovement',
    description: `Cleaned up ${totalDeleted} StockMovement records older than 3 months`,
  }).catch(() => {});

  return Response.json({ ok: true, deleted: totalDeleted, cutoff: cutoffISO });
});
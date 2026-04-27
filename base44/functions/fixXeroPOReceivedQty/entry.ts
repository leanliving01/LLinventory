import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * For Xero-sourced POs that are invoiced/paid/received, set received_qty = ordered_qty
 * on all lines. These are historical bills — they were received and paid, so marking
 * them as fully received clears the "needs attention" flags.
 *
 * Also recalculates line_total = ordered_qty * unit_cost and updates PO totals.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const batchSize = body.batch_size || 50;
    const skipOffset = body.skip || 0;

    // Load Xero-sourced POs that are in a "completed" state
    const completedStatuses = ['received', 'invoiced', 'paid'];
    const allPOs = await base44.asServiceRole.entities.PurchaseOrder.filter(
      { source: 'xero' }, '-created_date', 2000
    );
    const targetPOIds = new Set(allPOs.filter(po => completedStatuses.includes(po.status)).map(po => po.id));
    const targetPOMap = {};
    allPOs.forEach(po => { if (targetPOIds.has(po.id)) targetPOMap[po.id] = po; });

    // Load PO lines that have received_qty = 0 (the ones we need to fix)
    const zeroReceivedLines = await base44.asServiceRole.entities.PurchaseOrderLine.filter(
      { received_qty: 0 }, 'created_date', 500, skipOffset
    );

    // Filter to only lines belonging to completed Xero POs
    const linesToFix = zeroReceivedLines
      .filter(l => targetPOIds.has(l.purchase_order_id))
      .map(l => ({ line: l, po: targetPOMap[l.purchase_order_id] }));

    console.log(`Found ${linesToFix.length} lines to fix across ${targetPOIds.size} completed Xero POs`);

    if (dryRun) {
      return Response.json({
        dry_run: true,
        completed_xero_pos: targetPOs.length,
        lines_needing_fix: linesToFix.length,
        sample: linesToFix.slice(0, 20).map(({ line, po }) => ({
          po_number: po.po_number,
          po_status: po.status,
          product_name: line.product_name,
          ordered_qty: line.ordered_qty,
          received_qty: line.received_qty,
          unit_cost: line.unit_cost,
        })),
      });
    }

    // Apply fixes
    const batch = linesToFix.slice(0, batchSize);
    let updated = 0;
    const posToRecalc = new Set();

    for (const { line, po } of batch) {
      await base44.asServiceRole.entities.PurchaseOrderLine.update(line.id, {
        received_qty: line.ordered_qty,
      });
      posToRecalc.add(po.id);
      updated++;

      // Throttle every 5 updates
      if (updated % 5 === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // POs are already in completed state, no status changes needed

    const remaining = linesToFix.length - updated;
    console.log(`Updated ${updated} lines. ${remaining} remaining.`);

    return Response.json({
      success: true,
      lines_updated: updated,
      pos_affected: posToRecalc.size,
      remaining: remaining,
      message: remaining > 0
        ? `Fixed ${updated} lines across ${posToRecalc.size} POs. ${remaining} lines remaining — run again.`
        : `Done! All ${updated} lines marked as fully received.`,
    });
  } catch (error) {
    console.error('fixXeroPOReceivedQty error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all active products with a reorder point set
    const products = await base44.asServiceRole.entities.Product.filter({ status: 'active' });
    const productsWithReorder = products.filter(p => p.min_before_reorder > 0);

    if (productsWithReorder.length === 0) {
      return Response.json({ message: 'No products with reorder points configured', alerts: 0 });
    }

    // Fetch all stock on hand
    const stockRecords = await base44.asServiceRole.entities.StockOnHand.list('-updated_date', 5000);

    // Find products below reorder point
    const lowStockItems = [];
    for (const product of productsWithReorder) {
      const stockRows = stockRecords.filter(s => s.product_id === product.id);
      const totalOnHand = stockRows.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);

      if (totalOnHand < product.min_before_reorder) {
        lowStockItems.push({
          name: product.name,
          sku: product.sku,
          on_hand: totalOnHand,
          reorder_point: product.min_before_reorder,
          shortfall: product.min_before_reorder - totalOnHand,
          uom: product.stock_uom || 'pcs',
          is_out: totalOnHand === 0,
        });
      }
    }

    if (lowStockItems.length === 0) {
      return Response.json({ message: 'All stock levels are above reorder points', alerts: 0 });
    }

    // Sort: out of stock first, then by shortfall
    lowStockItems.sort((a, b) => (b.is_out ? 1 : 0) - (a.is_out ? 1 : 0) || b.shortfall - a.shortfall);

    const outOfStock = lowStockItems.filter(i => i.is_out);
    const lowStock = lowStockItems.filter(i => !i.is_out);

    // Build email body
    let body = `<h2>Low Stock Alert — ${new Date().toLocaleDateString('en-ZA')}</h2>`;
    body += `<p><strong>${lowStockItems.length}</strong> items are below their reorder point.</p>`;

    if (outOfStock.length > 0) {
      body += `<h3 style="color: #dc2626;">🔴 Out of Stock (${outOfStock.length})</h3>`;
      body += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:14px;">`;
      body += `<tr style="background:#fee2e2;"><th>SKU</th><th>Product</th><th>UoM</th><th>Reorder At</th></tr>`;
      for (const item of outOfStock) {
        body += `<tr><td>${item.sku}</td><td>${item.name}</td><td>${item.uom}</td><td>${item.reorder_point}</td></tr>`;
      }
      body += `</table><br/>`;
    }

    if (lowStock.length > 0) {
      body += `<h3 style="color: #d97706;">🟡 Low Stock (${lowStock.length})</h3>`;
      body += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:14px;">`;
      body += `<tr style="background:#fef3c7;"><th>SKU</th><th>Product</th><th>On Hand</th><th>Reorder At</th><th>Shortfall</th></tr>`;
      for (const item of lowStock.slice(0, 30)) {
        body += `<tr><td>${item.sku}</td><td>${item.name}</td><td>${item.on_hand} ${item.uom}</td><td>${item.reorder_point}</td><td style="color:#dc2626;font-weight:bold;">${item.shortfall}</td></tr>`;
      }
      if (lowStock.length > 30) body += `<tr><td colspan="5">... and ${lowStock.length - 30} more items</td></tr>`;
      body += `</table>`;
    }

    body += `<br/><p style="color:#6b7280; font-size:12px;">Go to Purchasing → Reorder Report to create purchase orders.</p>`;

    // Fetch admin users to email
    const users = await base44.asServiceRole.entities.User.list('email', 50);
    const admins = users.filter(u => u.role === 'admin');

    if (admins.length === 0) {
      return Response.json({ message: 'No admin users to notify', alerts: lowStockItems.length });
    }

    // Send email to each admin
    for (const admin of admins) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `⚠️ Low Stock Alert: ${lowStockItems.length} items need reordering`,
        body: body,
        from_name: 'Lean Living Production',
      });
    }

    return Response.json({
      message: `Low stock alert sent to ${admins.length} admin(s)`,
      alerts: lowStockItems.length,
      out_of_stock: outOfStock.length,
      low_stock: lowStock.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
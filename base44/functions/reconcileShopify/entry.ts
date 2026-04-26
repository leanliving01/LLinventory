import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reconciliation: compares Shopify source-of-truth with Base44 data.
 * Checks orders (lifecycle_state, line counts) and products (price, status).
 * Logs mismatches to ReconciliationMismatch entity.
 * Optionally auto-corrects if auto_correct=true.
 */

const PAGE_SIZE = 50;

/** Paginated fetch for Base44 entities — avoids rate limits by loading in pages */
async function paginatedFetch(entityRef, filter = {}, pageSize = 100) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await entityRef.filter(filter, '-created_date', pageSize, offset);
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

async function fetchShopifyPage(url, accessToken, dataKey) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify API ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return { items: data[dataKey] || [], nextUrl: nextMatch ? nextMatch[1] : '' };
  }
  throw new Error('Shopify rate limit exceeded');
}

function deriveLifecycle(order) {
  if (order.cancelled_at) return 'cancelled';
  const fin = (order.financial_status || '').toLowerCase();
  if (fin === 'refunded') return 'refunded';
  const ful = (order.fulfillment_status || '');
  if (ful === 'fulfilled') return 'fulfilled';
  if (['paid', 'partially_refunded'].includes(fin)) return 'paid_unfulfilled';
  return 'pending_payment';
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const autoCorrect = body.auto_correct === true;
  const scope = body.scope || 'orders'; // 'orders' | 'products' | 'all'

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not set' }, { status: 500 });
  }

  const mismatches = [];
  const corrections = [];

  // ─── ORDER RECONCILIATION ───
  if (scope === 'orders' || scope === 'all') {
    console.log('[Recon] Starting order reconciliation...');

    // Pre-load all Base44 sales orders + lines in bulk (avoids per-order API calls)
    const b44Orders = await paginatedFetch(base44.asServiceRole.entities.SalesOrder);
    const b44Map = {};
    for (const o of b44Orders) {
      if (o.external_id) b44Map[o.external_id] = o;
    }

    const allSalesOrderLines = await paginatedFetch(base44.asServiceRole.entities.SalesOrderLine);
    const allLinesByOrderId = {};
    for (const l of allSalesOrderLines) {
      if (!allLinesByOrderId[l.sales_order_id]) allLinesByOrderId[l.sales_order_id] = [];
      allLinesByOrderId[l.sales_order_id].push(l);
    }
    console.log(`[Recon] Pre-loaded ${b44Orders.length} orders, ${allSalesOrderLines.length} lines`);

    // Walk Shopify paid+unfulfilled orders
    let url = `https://${storeDomain}/admin/api/2024-01/orders.json?status=any&financial_status=paid&fulfillment_status=unfulfilled&limit=${PAGE_SIZE}`;
    let shopifyCount = 0;
    const shopifySeen = new Set();

    while (url) {
      const { items: orders, nextUrl } = await fetchShopifyPage(url, accessToken, 'orders');
      for (const order of orders) {
        const eid = String(order.id);
        shopifySeen.add(eid);
        shopifyCount++;
        const b44 = b44Map[eid];

        if (!b44) {
          mismatches.push({
            entity_type: 'SalesOrder', external_id: eid,
            field: 'existence', shopify_value: 'exists', base44_value: 'missing',
            detected_at: new Date().toISOString(),
          });
          continue;
        }

        // Check lifecycle
        const expectedLifecycle = deriveLifecycle(order);
        if (b44.lifecycle_state !== expectedLifecycle) {
          mismatches.push({
            entity_type: 'SalesOrder', external_id: eid,
            field: 'lifecycle_state',
            shopify_value: expectedLifecycle, base44_value: b44.lifecycle_state,
            detected_at: new Date().toISOString(),
            auto_corrected: autoCorrect,
          });
          if (autoCorrect) {
            await base44.asServiceRole.entities.SalesOrder.update(b44.id, { lifecycle_state: expectedLifecycle });
            corrections.push({ entity: 'SalesOrder', id: eid, field: 'lifecycle_state', from: b44.lifecycle_state, to: expectedLifecycle });
          }
        }

        // Check total amount
        const shopifyTotal = parseFloat(order.total_price || 0);
        if (Math.abs((b44.total_amount || 0) - shopifyTotal) > 0.01) {
          mismatches.push({
            entity_type: 'SalesOrder', external_id: eid,
            field: 'total_amount',
            shopify_value: String(shopifyTotal), base44_value: String(b44.total_amount || 0),
            detected_at: new Date().toISOString(),
            auto_corrected: autoCorrect,
          });
          if (autoCorrect) {
            await base44.asServiceRole.entities.SalesOrder.update(b44.id, { total_amount: shopifyTotal });
            corrections.push({ entity: 'SalesOrder', id: eid, field: 'total_amount' });
          }
        }

        // Check line item count (using pre-loaded lines)
        const shopifyLineCount = (order.line_items || []).length;
        const b44LinesForOrder = allLinesByOrderId[b44.id] || [];
        const b44ParentLines = b44LinesForOrder.filter(l => !l.is_package_component).length;
        if (Math.abs(b44ParentLines - shopifyLineCount) > 2) {
          mismatches.push({
            entity_type: 'SalesOrder', external_id: eid,
            field: 'line_count',
            shopify_value: String(shopifyLineCount), base44_value: String(b44ParentLines),
            detected_at: new Date().toISOString(),
          });
        }
      }
      url = nextUrl || '';
      if (url) await new Promise(r => setTimeout(r, 300));
    }

    // Check for Base44 orders that are paid_unfulfilled but NOT in Shopify
    for (const [eid, b44] of Object.entries(b44Map)) {
      if (b44.lifecycle_state === 'paid_unfulfilled' && !shopifySeen.has(eid)) {
        mismatches.push({
          entity_type: 'SalesOrder', external_id: eid,
          field: 'existence',
          shopify_value: 'not in paid+unfulfilled', base44_value: 'paid_unfulfilled in Base44',
          detected_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[Recon] Orders: checked ${shopifyCount} Shopify orders, found ${mismatches.length} mismatches`);
  }

  // ─── PRODUCT RECONCILIATION ───
  if (scope === 'products' || scope === 'all') {
    console.log('[Recon] Starting product reconciliation...');
    const startMismatchCount = mismatches.length;

    // Pre-load ALL Base44 products in bulk
    const allB44Products = await paginatedFetch(base44.asServiceRole.entities.Product);
    const b44ProductByExtId = {};
    const b44ProductBySku = {};
    for (const p of allB44Products) {
      if (p.external_id) b44ProductByExtId[p.external_id] = p;
      if (p.sku) b44ProductBySku[p.sku] = p;
    }
    console.log(`[Recon] Pre-loaded ${allB44Products.length} products`);

    let url = `https://${storeDomain}/admin/api/2024-01/products.json?limit=${PAGE_SIZE}&status=active`;
    let productCount = 0;

    while (url) {
      const { items: products, nextUrl } = await fetchShopifyPage(url, accessToken, 'products');
      for (const product of products) {
        for (const variant of (product.variants || [])) {
          if (!variant.sku) continue;
          productCount++;
          const variantId = String(variant.id);

          const b44 = b44ProductByExtId[variantId] || b44ProductBySku[variant.sku];

          if (!b44) {
            mismatches.push({
              entity_type: 'Product', external_id: variantId,
              field: 'existence', shopify_value: `${variant.sku} exists`, base44_value: 'missing',
              detected_at: new Date().toISOString(),
            });
            continue;
          }

          const shopifyPrice = parseFloat(variant.price || 0);
          if (Math.abs((b44.price || 0) - shopifyPrice) > 0.01) {
            mismatches.push({
              entity_type: 'Product', external_id: variantId,
              field: 'price',
              shopify_value: String(shopifyPrice), base44_value: String(b44.price || 0),
              detected_at: new Date().toISOString(),
              auto_corrected: autoCorrect,
            });
            if (autoCorrect) {
              await base44.asServiceRole.entities.Product.update(b44.id, { price: shopifyPrice });
              corrections.push({ entity: 'Product', id: variantId, field: 'price' });
              await new Promise(r => setTimeout(r, 200));
            }
          }
        }
      }
      url = nextUrl || '';
      if (url) await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[Recon] Products: checked ${productCount} variants, found ${mismatches.length - startMismatchCount} mismatches`);
  }

  // ─── Save mismatches to entity (batched) ───
  for (let i = 0; i < mismatches.length; i += 5) {
    const batch = mismatches.slice(i, i + 5);
    await Promise.all(batch.map(m =>
      base44.asServiceRole.entities.ReconciliationMismatch.create(m).catch(err => {
        console.error(`[Recon] Failed to save mismatch: ${err.message}`);
      })
    ));
    if (i + 5 < mismatches.length) await new Promise(r => setTimeout(r, 500));
  }

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync', entity_type: 'ReconciliationMismatch',
    description: `Reconciliation (${scope}): ${mismatches.length} mismatches found, ${corrections.length} auto-corrected`,
  }).catch(() => {});

  console.log(`[Recon] Done: ${mismatches.length} mismatches, ${corrections.length} corrections`);

  // ─── EMAIL SUMMARY ───
  try {
    const alertSettings = await base44.asServiceRole.entities.Setting.filter({ key: 'alert_emails' });
    const emailStr = (alertSettings.length > 0 ? alertSettings[0].value : '') || '';
    const recipients = emailStr.split(',').map(e => e.trim()).filter(e => e.includes('@'));

    if (recipients.length === 0) {
      // Fallback: send to all admin users
      const users = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      for (const u of users) {
        if (u.email) recipients.push(u.email);
      }
    }

    if (recipients.length > 0) {
      const subject = mismatches.length === 0
        ? `✅ Shopify Reconciliation — All Clear (${scope})`
        : `⚠️ Shopify Reconciliation — ${mismatches.length} Mismatch${mismatches.length > 1 ? 'es' : ''} Found`;

      const mismatchSummary = mismatches.slice(0, 20).map(m =>
        `• ${m.entity_type} ${m.external_id}: ${m.field} — Shopify: ${m.shopify_value}, Base44: ${m.base44_value}${m.auto_corrected ? ' (auto-corrected)' : ''}`
      ).join('\n');

      const body = [
        `<h2>Shopify Reconciliation Report</h2>`,
        `<p><strong>Scope:</strong> ${scope}</p>`,
        `<p><strong>Mismatches found:</strong> ${mismatches.length}</p>`,
        `<p><strong>Auto-corrected:</strong> ${corrections.length}</p>`,
        `<p><strong>Unresolved:</strong> ${mismatches.length - corrections.length}</p>`,
        mismatches.length > 0 ? `<h3>Details (first 20):</h3><pre>${mismatchSummary}</pre>` : '<p>No issues detected. Shopify and Base44 data are in sync.</p>',
        `<hr/><p style="color:#888;font-size:12px;">Lean Living — Automated Reconciliation · ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</p>`,
      ].join('\n');

      for (const email of recipients) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject,
          body,
          from_name: 'Lean Living Sync',
        });
      }
      console.log(`[Recon] Email sent to ${recipients.length} recipient(s)`);
    }
  } catch (emailErr) {
    console.error(`[Recon] Email failed: ${emailErr.message}`);
  }

  return Response.json({
    ok: true,
    scope,
    mismatches_found: mismatches.length,
    auto_corrected: corrections.length,
    auto_correct_enabled: autoCorrect,
  });
});
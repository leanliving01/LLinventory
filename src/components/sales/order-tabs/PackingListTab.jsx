import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Printer, ExternalLink, Package, Pill, Box } from 'lucide-react';
import { orderRef } from '@/lib/salesOrderStatus';
import { bySku } from '@/lib/naturalSort';

/**
 * Packing list for an order: what to physically pick & pack (package contents +
 * standalone items) plus the packaging materials the rules call for. Printable,
 * and deep-links to an external packing app when configured in Settings.
 */
export default function PackingListTab({ order, lines = [] }) {
  // Active packing-material rules → flat list of material names for the checklist.
  const { data: rules = [] } = useQuery({
    queryKey: ['packing-material-rules'],
    queryFn: () => base44.entities.PackingMaterialRule.list('name', 50),
    staleTime: 5 * 60 * 1000,
  });

  // External packing-app URL template (e.g. https://app/pack?order={order_number}).
  const { data: appUrlSetting } = useQuery({
    queryKey: ['setting', 'packing_app_url_template'],
    queryFn: async () => {
      const rows = await base44.entities.Setting.filter({ key: 'packing_app_url_template' });
      return rows?.[0] || null;
    },
  });

  const { packages, standalone, totalMeals } = useMemo(() => {
    const parents = lines.filter((l) => l.is_package_parent).sort(bySku);
    const componentsByParent = {};
    lines
      .filter((l) => l.is_package_component && l.status === 'active')
      .forEach((l) => {
        (componentsByParent[l.parent_line_id] ||= []).push(l);
      });
    Object.keys(componentsByParent).forEach((k) => componentsByParent[k].sort(bySku));
    const pkgs = parents.map((p) => ({
      parent: p,
      components: componentsByParent[p.id] || [],
    }));
    const standaloneLines = lines
      .filter((l) => !l.is_package_parent && !l.is_package_component && l.status === 'active')
      .sort(bySku);
    const meals =
      Object.values(componentsByParent).flat().reduce((s, c) => s + (Number(c.qty) || 0), 0) +
      standaloneLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    return { packages: pkgs, standalone: standaloneLines, totalMeals: meals };
  }, [lines]);

  const materials = useMemo(() => {
    const out = [];
    for (const r of rules) {
      if (!r.is_active) continue;
      let mats = [];
      try { mats = r.materials ? JSON.parse(r.materials) : []; } catch { mats = []; }
      if (!mats.length && r.material_name) mats = [{ name: r.material_name }];
      for (const m of mats) if (m.name) out.push({ name: m.name, trigger: r.trigger });
    }
    return out;
  }, [rules]);

  const appUrl = useMemo(() => {
    const tpl = appUrlSetting?.value;
    if (!tpl) return null;
    return tpl
      .replace(/\{order_number\}/g, encodeURIComponent(order.order_number || ''))
      .replace(/\{order_id\}/g, encodeURIComponent(order.id || ''))
      .replace(/\{shopify_order_id\}/g, encodeURIComponent(order.shopify_order_id || ''));
  }, [appUrlSetting, order]);

  const handlePrint = () => {
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = [];
    packages.forEach(({ parent, components }) => {
      rows.push(`<tr class="pkg"><td colspan="2"><strong>${esc(parent.name)} × ${esc(parent.qty)}</strong> <span class="sku">${esc(parent.sku)}</span></td></tr>`);
      components.forEach((c) => rows.push(`<tr><td class="ind">${esc(c.name)}</td><td class="q">×${esc(c.qty)}</td></tr>`));
    });
    standalone.forEach((l) => rows.push(`<tr><td>${esc(l.name)} <span class="sku">${esc(l.sku)}</span></td><td class="q">×${esc(l.qty)}</td></tr>`));
    const matRows = materials.map((m) => `<li>${esc(m.name)}</li>`).join('');
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Packing List ${esc(orderRef(order))}</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#0f172a}
        h1{font-size:18px;margin:0 0 2px} .sub{color:#64748b;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:13px} td{padding:4px 6px;border-bottom:1px solid #e2e8f0}
        .pkg td{background:#f8fafc;border-top:1px solid #cbd5e1} .ind{padding-left:22px;color:#334155}
        .q{text-align:right;white-space:nowrap;width:60px} .sku{color:#94a3b8;font-family:monospace;font-size:11px}
        h2{font-size:13px;margin:18px 0 6px} ul{margin:0;padding-left:18px;font-size:13px;color:#334155}
        .meta{margin-top:4px;font-size:12px;color:#475569}
      </style></head><body>
      <h1>Packing List — ${esc(orderRef(order))}</h1>
      <div class="sub">${esc(order.customer_name || '')} · ${esc(order.shipping_city || '')} · ${esc(totalMeals)} item(s)</div>
      <table><tbody>${rows.join('') || '<tr><td>No items</td></tr>'}</tbody></table>
      ${matRows ? `<h2>Packaging materials</h2><ul>${matRows}</ul>` : ''}
      <div class="meta">Courier: ${esc(order.courier || '—')} · Tracking: ${esc(order.tracking_number || '—')}</div>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Package className="w-4 h-4" /> Packing List
          <Badge variant="outline" className="text-[10px]">{totalMeals} item(s)</Badge>
        </p>
        <div className="flex items-center gap-2">
          {appUrl && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={appUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" /> Open in Packing App
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
            <Printer className="w-3.5 h-3.5" /> Print
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Items to pack</p>
        {packages.length === 0 && standalone.length === 0 ? (
          <p className="text-sm text-muted-foreground">No product lines on this order.</p>
        ) : (
          <div className="space-y-3 text-sm">
            {packages.map(({ parent, components }) => (
              <div key={parent.id}>
                <div className="flex items-center justify-between font-medium">
                  <span className="flex items-center gap-2">
                    <Box className="w-3.5 h-3.5 text-slate-400" /> {parent.name}
                    <span className="font-mono text-[11px] text-muted-foreground">{parent.sku}</span>
                  </span>
                  <span className="tabular-nums">×{parent.qty}</span>
                </div>
                {components.length > 0 && (
                  <div className="mt-1 ml-5 border-l pl-3 space-y-0.5">
                    {components.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-[13px] text-slate-600">
                        <span>{c.name}</span>
                        <span className="tabular-nums">×{c.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {standalone.map((l) => (
              <div key={l.id} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {l.name}
                  <span className="font-mono text-[11px] text-muted-foreground">{l.sku}</span>
                </span>
                <span className="tabular-nums">×{l.qty}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <Pill className="w-3.5 h-3.5" /> Packaging materials
        </p>
        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No packing-material rules configured.</p>
        ) : (
          <ul className="text-sm text-slate-700 list-disc pl-5 space-y-0.5">
            {materials.map((m, i) => (
              <li key={i}>
                {m.name}
                <span className="text-[11px] text-muted-foreground ml-1">
                  ({m.trigger === 'has_meals' ? 'meals' : m.trigger === 'has_supplements' ? 'supplements' : 'every order'})
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Exact quantities &amp; cost are locked in on fulfilment (see Additional Costs / Profitability).
        </p>
      </Card>
    </div>
  );
}

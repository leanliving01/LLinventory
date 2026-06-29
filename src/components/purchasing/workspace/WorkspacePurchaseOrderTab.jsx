import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { formatPaymentTerms, formatLocationAddress } from '@/lib/utils';
import { DocSheet, DocTitle, Party, MetaField, MetaGrid, DocTable, Th, Td, TotalsBox, fmtMoney, fmtQty } from './documentUi';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  awaiting_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function WorkspacePurchaseOrderTab({ po, poLines = [] }) {
  // Supplier — for the vendor block (VAT / address / terms)
  const { data: supplier = null } = useQuery({
    queryKey: ['supplier-single', po?.supplier_id],
    queryFn: async () => {
      const list = await base44.entities.Supplier.filter({ id: po.supplier_id });
      return list[0] || null;
    },
    enabled: !!po?.supplier_id,
  });

  // Delivery location — for the ship-to address
  const { data: location = null } = useQuery({
    queryKey: ['location-single', po?.location_id],
    queryFn: async () => {
      const list = await base44.entities.Location.filter({ id: po.location_id });
      return list[0] || null;
    },
    enabled: !!po?.location_id,
  });

  // Org name for the document letterhead
  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => base44.entities.Setting.list('-created_date', 100),
    staleTime: 300000,
  });
  const orgName = useMemo(() => {
    const byKey = {};
    settings.forEach(s => { byKey[s.key] = s.value; });
    return byKey.trading_name || byKey.company_name || 'Lean Living';
  }, [settings]);

  // Live received quantities from confirmed GRNs (fallback for legacy lines)
  const { data: confirmedGrnLines = [] } = useQuery({
    queryKey: ['po-doc-grn-lines', po?.id],
    queryFn: async () => {
      const grns = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: po.id, status: 'confirmed' }, '-received_date', 50);
      if (!grns.length) return [];
      const chunks = await Promise.all(grns.map(g => base44.entities.GRNLine.filter({ grn_id: g.id }, 'product_name', 200)));
      return chunks.flat();
    },
    enabled: !!po?.id,
  });
  const receivedByLine = useMemo(() => {
    const byPoLine = {};
    const byProduct = {};
    confirmedGrnLines.forEach(l => {
      const q = parseFloat(l.received_qty) || 0;
      if (l.po_line_id) byPoLine[l.po_line_id] = (byPoLine[l.po_line_id] || 0) + q;
      if (l.product_id) byProduct[l.product_id] = (byProduct[l.product_id] || 0) + q;
    });
    return { byPoLine, byProduct };
  }, [confirmedGrnLines]);
  const receivedFor = (l) => {
    if (receivedByLine.byPoLine[l.id] != null) return receivedByLine.byPoLine[l.id];
    if (receivedByLine.byProduct[l.product_id] != null) return receivedByLine.byProduct[l.product_id];
    return parseFloat(l.received_qty) || 0;
  };

  if (!po) return null;

  const supplierAddress = supplier?.physical_address || supplier?.billing_address || '';
  const supplierVat = supplier?.vat_number || '';
  const deliveryAddress = formatLocationAddress(location);
  const terms = supplier?.payment_term_type
    ? formatPaymentTerms(supplier.payment_term_type, supplier.payment_term_value)
    : (po.payment_terms || null);

  const subtotal = po.subtotal || 0;
  const tax = po.tax_amount ?? po.tax ?? 0;
  const total = po.total || 0;
  const isBlind = po.type === 'blind_receipt';

  return (
    <DocSheet>
      <DocTitle
        kicker={isBlind ? 'BLIND RECEIPT' : 'PURCHASE ORDER'}
        number={po.po_number}
        right={
          <div className="flex flex-col items-end gap-2">
            <Badge className={`text-xs ${STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-600'}`}>
              {(po.status || '').replace(/_/g, ' ')}
            </Badge>
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{fmtMoney(total)}</span>
            </div>
          </div>
        }
      />

      {/* Parties */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 py-8">
        <Party label="From" name={orgName} />
        <Party
          label="Supplier"
          name={po.supplier_name}
          lines={[supplierAddress, supplierVat ? `VAT: ${supplierVat}` : '', supplier?.email]}
        />
        <Party
          label="Deliver To"
          name={location?.name || po.location_name}
          lines={[deliveryAddress]}
        />
      </div>

      {/* Meta strip */}
      <div className="py-6 border-y border-border">
        <MetaGrid>
          <MetaField label="Order Date" value={po.order_date} />
          <MetaField label="Expected Delivery" value={po.expected_date || po.expected_delivery_date} />
          <MetaField label="Payment Terms" value={terms} />
          <MetaField label="Currency" value={po.currency || 'ZAR'} />
        </MetaGrid>
      </div>

      {/* Line items */}
      <div className="py-8">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">Order Lines</p>
        <DocTable
          head={
            <>
              <Th>Description</Th>
              <Th align="center">UOM</Th>
              <Th align="right">Ordered</Th>
              <Th align="right">Received</Th>
              <Th align="right">Unit Cost</Th>
              <Th align="right">Line Total</Th>
            </>
          }
        >
          {poLines.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No line items on this purchase order.</td></tr>
          ) : (
            poLines.map(l => {
              const ordered = parseFloat(l.ordered_qty) || 0;
              const received = receivedFor(l);
              return (
                <tr key={l.id}>
                  <Td>
                    <p className="font-medium text-foreground">{l.product_name || l.description}</p>
                    {l.product_sku && <p className="text-xs font-mono text-muted-foreground mt-0.5">{l.product_sku}</p>}
                    {l.supplier_product_url && (
                      <a href={l.supplier_product_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 mt-0.5">
                        Supplier link <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </Td>
                  <Td align="center"><span className="text-sm text-muted-foreground">{l.uom || l.purchase_uom || '—'}</span></Td>
                  <Td align="right"><span className="text-sm">{fmtQty(ordered)}</span></Td>
                  <Td align="right">
                    {received > 0
                      ? <span className={`text-sm font-medium ${received < ordered ? 'text-amber-600' : 'text-green-700'}`}>{fmtQty(received)}</span>
                      : <span className="text-sm text-muted-foreground">—</span>}
                  </Td>
                  <Td align="right"><span className="text-sm">{fmtMoney(l.unit_cost)}</span></Td>
                  <Td align="right"><span className="text-sm font-medium">{fmtMoney(l.line_total)}</span></Td>
                </tr>
              );
            })
          )}
        </DocTable>
      </div>

      {/* Totals */}
      <div className="pb-2">
        <TotalsBox
          rows={[
            { label: 'Subtotal (excl. VAT)', value: fmtMoney(subtotal) },
            { label: 'VAT', value: fmtMoney(tax) },
          ]}
          grand={{ label: 'Total (incl. VAT)', value: fmtMoney(total) }}
        />
      </div>

      {/* Notes */}
      {po.notes && (
        <div className="pt-6 mt-6 border-t border-border">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Notes</p>
          <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{po.notes}</p>
        </div>
      )}
    </DocSheet>
  );
}

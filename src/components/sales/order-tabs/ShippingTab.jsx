import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, Truck, Loader2 } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { fulfilmentColors, fulfilmentLabels } from '@/lib/salesOrderStatus';
import InfoGrid from '../order-shared/InfoGrid';
import { money } from '../order-shared/money';

export default function ShippingTab({ order }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ courier: '', tracking_number: '', tracking_url: '' });

  const isManual = order.order_source && order.order_source !== 'shopify';
  const isUnfulfilled = order.lifecycle_state !== 'fulfilled' && order.lifecycle_state !== 'cancelled';
  const canFulfil = isManual && isUnfulfilled;

  const shippingAddress = [
    order.customer_address,
    [order.shipping_city, order.shipping_province].filter(Boolean).join(', '),
    [order.shipping_zip, order.shipping_country].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join('\n');

  const handleFulfil = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('fulfill_manual_order', {
        p_order_id: order.id,
        p_user: 'manual',
        p_courier: form.courier || null,
        p_tracking_number: form.tracking_number || null,
        p_tracking_url: form.tracking_url || null,
      });
      if (error) throw new Error(error.message);
      toast.success('Order marked fulfilled — stock deducted');
      queryClient.invalidateQueries({ queryKey: ['salesOrder', order.id] });
      queryClient.invalidateQueries({ queryKey: ['salesOrderEvents', order.id] });
    } catch (err) {
      toast.error(err.message || 'Could not fulfil order');
    } finally {
      setSaving(false);
    }
  };

  const items = [
    { label: 'Courier', value: order.courier },
    { label: 'Tracking Number', value: order.tracking_number },
    {
      label: 'Tracking',
      value: order.tracking_url ? (
        <a
          href={order.tracking_url}
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex items-center gap-1 hover:underline"
        >
          Track shipment <ExternalLink className="w-3 h-3" />
        </a>
      ) : (
        '—'
      ),
    },
    { label: 'Shipped At', value: order.shipped_at ? formatDateTimeSAST(order.shipped_at) : '—' },
    { label: 'Shipping Cost', value: money(order.shipping_cost) },
    { label: 'Shipping Address', value: shippingAddress },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Fulfilment Status</p>
          {order.fulfillment_status && (
            <Badge
              variant="outline"
              className={`text-xs border ${fulfilmentColors[order.fulfillment_status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
            >
              {fulfilmentLabels[order.fulfillment_status] || order.fulfillment_status}
            </Badge>
          )}
        </div>
        <InfoGrid items={items} />
      </Card>

      {canFulfil && (
        <Card className="p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Truck className="w-4 h-4" /> Mark Fulfilled
          </p>
          <p className="text-xs text-muted-foreground">
            Records fulfilment metadata and deducts stock for this manual order.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Courier (optional)"
              value={form.courier}
              onChange={(e) => setForm((f) => ({ ...f, courier: e.target.value }))}
            />
            <Input
              placeholder="Tracking number (optional)"
              value={form.tracking_number}
              onChange={(e) => setForm((f) => ({ ...f, tracking_number: e.target.value }))}
            />
            <Input
              placeholder="Tracking URL (optional)"
              value={form.tracking_url}
              onChange={(e) => setForm((f) => ({ ...f, tracking_url: e.target.value }))}
            />
          </div>
          <Button onClick={handleFulfil} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Mark Fulfilled
          </Button>
        </Card>
      )}
    </div>
  );
}

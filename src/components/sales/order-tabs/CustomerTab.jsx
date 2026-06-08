import React from 'react';
import { Card } from '@/components/ui/card';
import InfoGrid from '../order-shared/InfoGrid';

export default function CustomerTab({ order }) {
  const shippingAddress = [
    order.customer_address,
    [order.shipping_city, order.shipping_province].filter(Boolean).join(', '),
    [order.shipping_zip, order.shipping_country].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join('\n');

  const contact = [
    { label: 'Customer Name', value: order.customer_name },
    { label: 'Email', value: order.customer_email },
    { label: 'Phone', value: order.customer_phone },
  ];

  const addresses = [
    { label: 'Shipping Address', value: shippingAddress },
    { label: 'Billing Address', value: order.billing_address },
    { label: 'City', value: order.shipping_city },
    { label: 'Province', value: order.shipping_province },
    { label: 'Postal Code', value: order.shipping_zip },
    { label: 'Country', value: order.shipping_country },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Customer</p>
        <InfoGrid items={contact} />
      </Card>
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Addresses</p>
        <InfoGrid items={addresses} />
      </Card>
      {order.notes && (
        <Card className="p-4">
          <p className="text-sm font-semibold mb-2">Delivery / Customer Notes</p>
          <p className="text-sm text-slate-700 whitespace-pre-line">{order.notes}</p>
        </Card>
      )}
    </div>
  );
}

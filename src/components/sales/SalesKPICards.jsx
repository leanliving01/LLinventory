import React from 'react';
import { Package, Clock, CheckCircle2, XCircle, DollarSign } from 'lucide-react';

function KPICard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="bg-card rounded-xl border p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function SalesKPICards({ orders }) {
  const paid = orders.filter(o => o.lifecycle_state === 'paid_unfulfilled');
  const fulfilled = orders.filter(o => o.lifecycle_state === 'fulfilled');
  const cancelled = orders.filter(o => ['cancelled', 'refunded'].includes(o.lifecycle_state));
  const pending = orders.filter(o => o.lifecycle_state === 'pending_payment');

  const totalRevenue = paid.reduce((s, o) => s + (o.total_amount || 0), 0)
    + fulfilled.reduce((s, o) => s + (o.total_amount || 0), 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KPICard label="Total Orders" value={orders.length} icon={Package} color="bg-blue-500" />
      <KPICard label="Awaiting Fulfilment" value={paid.length} icon={Clock} color="bg-orange-500" />
      <KPICard label="Fulfilled" value={fulfilled.length} icon={CheckCircle2} color="bg-green-500" />
      <KPICard label="Cancelled / Refunded" value={cancelled.length} icon={XCircle} color="bg-red-500" />
      <KPICard
        label="Revenue"
        value={`R${totalRevenue.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`}
        sub="Paid + Fulfilled"
        icon={DollarSign}
        color="bg-purple-500"
      />
    </div>
  );
}
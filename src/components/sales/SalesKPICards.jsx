import React from 'react';
import { Package, Clock, CheckCircle2 } from 'lucide-react';

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
  const notPacked = paid.filter(o => o.status === 'pending');
  const picking = paid.filter(o => o.status === 'picking');
  const packed = paid.filter(o => o.status === 'packed');

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KPICard label="Awaiting Fulfilment" value={paid.length} icon={Package} color="bg-orange-500" />
      <KPICard label="Not Packed" value={notPacked.length} icon={Clock} color="bg-slate-500" />
      <KPICard label="Picking" value={picking.length} icon={Package} color="bg-blue-500" />
      <KPICard label="Packed" value={packed.length} icon={CheckCircle2} color="bg-green-500" />
    </div>
  );
}
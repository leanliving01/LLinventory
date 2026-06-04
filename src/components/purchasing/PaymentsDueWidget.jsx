import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { calculateDueDate, formatZAR } from '@/lib/utils';
import { AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { differenceInCalendarDays } from 'date-fns';

function dueDateFor(invoice, suppliers) {
  // Prefer the due date already stored on the invoice; otherwise derive it from
  // the supplier's payment terms and the invoice date.
  if (invoice.due_date || invoice.due_date_calculated) {
    return new Date(invoice.due_date || invoice.due_date_calculated);
  }
  const supplier = suppliers.find(s => s.id === invoice.supplier_id);
  if (!supplier?.payment_term_type) return null;
  return calculateDueDate(invoice.invoice_date, supplier.payment_term_type, supplier.payment_term_value);
}

export default function PaymentsDueWidget({ suppliers = [] }) {
  const { data: invoices = [] } = useQuery({
    queryKey: ['payments-due'],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ payment_status: 'unpaid' }, 'invoice_date', 200),
    staleTime: 60000,
  });

  const rows = useMemo(() => {
    const today = new Date();
    return invoices
      .map(inv => {
        const due = dueDateFor(inv, suppliers);
        const daysUntil = due ? differenceInCalendarDays(due, today) : null;
        return { ...inv, dueDate: due, daysUntil };
      })
      .filter(r => r.dueDate)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [invoices, suppliers]);

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" /> Payments Due
        </h3>
        <p className="text-xs text-muted-foreground">No unpaid invoices with known due dates.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Payments Due
        </h3>
        <span className="text-xs text-muted-foreground">{rows.length} invoice{rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-border max-h-72 overflow-y-auto">
        {rows.map(row => {
          const overdue = row.daysUntil < 0;
          const soonDue = !overdue && row.daysUntil <= 7;
          return (
            <div key={row.id} className={`px-4 py-2.5 flex items-center justify-between gap-3 ${overdue ? 'bg-red-50/60 dark:bg-red-950/20' : soonDue ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
              <div className="flex items-center gap-2 min-w-0">
                {overdue
                  ? <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  : soonDue
                  ? <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  : <div className="w-3.5 h-3.5 shrink-0" />
                }
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{row.supplier_name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{row.invoice_number}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold">{formatZAR(row.total)}</p>
                <p className={`text-[10px] font-medium ${overdue ? 'text-red-600' : soonDue ? 'text-amber-600' : 'text-muted-foreground'}`}>
                  {overdue
                    ? `${Math.abs(row.daysUntil)}d overdue`
                    : row.daysUntil === 0
                    ? 'Due today'
                    : `${row.daysUntil}d`
                  }
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

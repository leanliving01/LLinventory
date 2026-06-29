import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

function deriveSteps(po, invoice, grns) {
  const isBlind = po?.type === 'blind_receipt';
  const hasConfirmedGRN = grns.some(g => g.status === 'confirmed');
  const isPaid = invoice?.payment_status === 'paid';
  const isInvoiceApproved = invoice?.status === 'approved';

  if (isBlind) {
    return [
      { label: 'Invoice Captured', done: !!po },
      { label: 'Authorised',       done: isInvoiceApproved },
      { label: 'Stock Received',   done: hasConfirmedGRN },
      { label: 'Done',             done: isPaid },
    ];
  }

  const isApproved = ['approved', 'confirmed'].includes(po?.status);
  const hasInvoice = !!invoice;

  return [
    { label: 'PO Created',     done: !!po },
    { label: 'Approved',       done: isApproved },
    { label: 'Receive Goods',  done: hasConfirmedGRN },
    { label: 'Match Invoice',  done: isInvoiceApproved },
    { label: 'Done',           done: isPaid },
  ];
}

function activeIndex(steps) {
  const lastDone = steps.reduce((last, s, i) => s.done ? i : last, -1);
  return Math.min(lastDone + 1, steps.length - 1);
}

export default function StepIndicator({ po, invoice, grns = [] }) {
  const steps = deriveSteps(po, invoice, grns);
  const current = activeIndex(steps);

  return (
    <div className="flex items-center gap-0 bg-muted/40 rounded-xl px-5 py-4 overflow-x-auto">
      {steps.map((step, i) => (
        <React.Fragment key={step.label}>
          <div className={cn(
            'flex items-center gap-2 shrink-0 text-sm font-medium',
            step.done ? 'text-green-700' : i === current ? 'text-primary' : 'text-muted-foreground'
          )}>
            {step.done
              ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              : <Circle className={cn('w-4 h-4 shrink-0', i === current ? 'text-primary' : 'text-muted-foreground/40')} />
            }
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <div className={cn(
              'h-px flex-1 mx-2 min-w-[24px]',
              step.done ? 'bg-green-300' : 'bg-border'
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

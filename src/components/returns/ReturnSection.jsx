import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// A collapsible, visually-separated step block for the step-based return /
// refund / re-send detail pages (Phase 2). Title row stays visible; body
// collapses. `status` renders a small chip on the right; `highlight` draws
// attention (e.g. the current next-action step).
export default function ReturnSection({
  title, icon: Icon, status, statusClass = '', defaultOpen = true,
  highlight = false, muted = false, children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border ${highlight ? 'border-primary/50 ring-1 ring-primary/30' : ''} ${muted ? 'opacity-60' : ''} bg-card overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="font-semibold text-sm flex-1">{title}</span>
        {status != null && status !== '' && (
          <Badge className={`text-[10px] ${statusClass}`}>{status}</Badge>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t">{children}</div>}
    </div>
  );
}

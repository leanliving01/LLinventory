import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HelpCircle, X, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Inline collapsible help banner for a page.
 * Usage: <PageHelp items={[{title: '...', text: '...'}, ...]} />
 */
export default function PageHelp({ items = [] }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/10 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          <HelpCircle className="w-4 h-4" />
          What can I do on this page?
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-primary" /> : <ChevronDown className="w-4 h-4 text-primary" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {idx + 1}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
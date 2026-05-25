import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { HelpCircle, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function HelpDrawer({ pageKey }) {
  const [open, setOpen] = React.useState(false);

  const { data: guides = [] } = useQuery({
    queryKey: ['help-guide', pageKey],
    queryFn: () => base44.entities.HelpGuide.filter({ page_key: pageKey }, 'sort_order', 10),
    enabled: open,
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="w-4 h-4" />
        How it works
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-card border-l border-border shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">Help & Training</h2>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {guides.length === 0 ? (
                <p className="text-sm text-muted-foreground">No guide available for this page yet. Ask your admin to add one.</p>
              ) : (
                guides.map(guide => (
                  <div key={guide.id}>
                    <h3 className="text-base font-semibold mb-3">{guide.title}</h3>
                    <div className="prose prose-sm prose-slate max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-sm leading-relaxed">
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>,
                          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
                          ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
                          li: ({ children }) => <li className="text-sm">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-3 border-primary/30 pl-3 my-3 text-muted-foreground italic">{children}</blockquote>
                          ),
                        }}
                      >
                        {guide.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
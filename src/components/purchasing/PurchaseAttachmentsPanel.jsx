import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Paperclip, Plus, FileText } from 'lucide-react';
import { toast } from 'sonner';

const SOURCE_LABEL = { xero: 'From Xero', native: 'Scanned', manual: 'Link' };
const SOURCE_CLASS = {
  xero: 'bg-blue-100 text-blue-700',
  native: 'bg-green-100 text-green-700',
  manual: 'bg-muted text-muted-foreground',
};

/**
 * Lists source documents (supplier invoice PDFs) for a PO and/or its invoices —
 * Xero-fetched, natively-scanned, or manually-linked — and lets the user add a
 * link. Works for PO-linked invoices and standalone (no-PO) invoices alike.
 */
export default function PurchaseAttachmentsPanel({ purchaseOrderId = null, invoiceIds = [], legacyUrls = [] }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const ids = useMemo(() => Array.from(new Set((invoiceIds || []).filter(Boolean))), [invoiceIds]);
  const queryKey = ['purchase-attachments', purchaseOrderId, ids.join(',')];

  const { data: rows = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const filters = [];
      if (purchaseOrderId) filters.push(`purchase_order_id.eq.${purchaseOrderId}`);
      if (ids.length) filters.push(`invoice_id.in.(${ids.join(',')})`);
      if (!filters.length) return [];
      const { data, error } = await supabase
        .from('purchase_attachments')
        .select('*')
        .or(filters.join(','))
        .order('created_date', { ascending: false });
      if (error) { console.error('[attachments]', error.message); return []; }
      return data || [];
    },
    enabled: !!(purchaseOrderId || ids.length),
  });

  const handleAdd = async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await base44.entities.PurchaseAttachment.create({
        purchase_order_id: purchaseOrderId,
        invoice_id: ids[0] || null,
        source: 'manual',
        file_name: name.trim() || url.trim(),
        file_url: url.trim(),
      });
      setUrl(''); setName(''); setShowAdd(false);
      qc.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const legacy = (legacyUrls || []).filter(Boolean);
  const isEmpty = rows.length === 0 && legacy.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Attachments</p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-3.5 h-3.5" /> Add link
        </Button>
      </div>

      {showAdd && (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Label (optional)" className="sm:w-40" />
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <Button size="sm" onClick={handleAdd} disabled={saving}>Save</Button>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
        </div>
      )}

      {isEmpty ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          <Paperclip className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No documents yet. Xero bill PDFs and native scans appear here automatically.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 p-3 border border-border rounded-lg bg-muted/30">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <a
                href={a.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline truncate flex-1"
              >
                {a.file_name || a.file_url || 'Document'}
              </a>
              <Badge className={`text-[10px] ${SOURCE_CLASS[a.source] || SOURCE_CLASS.manual}`}>
                {SOURCE_LABEL[a.source] || a.source}
              </Badge>
              {a.file_url && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </li>
          ))}
          {legacy.map((att, i) => (
            <li key={`legacy-${i}`} className="flex items-center gap-2 p-3 border border-border rounded-lg bg-muted/30">
              <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
              <a href={att} target="_blank" rel="noopener noreferrer"
                className="text-sm text-primary hover:underline truncate flex-1">
                {att}
              </a>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

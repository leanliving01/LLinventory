import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function WorkspaceAttachmentsTab({ po, onUpdated }) {
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const attachments = po?.attachment_urls
    ? (typeof po.attachment_urls === 'string'
        ? po.attachment_urls.split('\n').map(u => u.trim()).filter(Boolean)
        : po.attachment_urls)
    : [];

  const handleAdd = async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      const newList = [...attachments, url.trim()];
      await base44.entities.PurchaseOrder.update(po.id, { attachment_urls: newList.join('\n') });
      setUrl('');
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['po', po.id] });
      onUpdated && onUpdated();
    } catch (err) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Attachments</p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-3.5 h-3.5" /> Add URL
        </Button>
      </div>

      {showAdd && (
        <div className="flex gap-2">
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

      {attachments.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          <Paperclip className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No attachments yet. Add a file URL or invoice scan link.
        </div>
      ) : (
        <ul className="space-y-2">
          {attachments.map((att, i) => (
            <li key={i} className="flex items-center gap-2 p-3 border border-border rounded-lg bg-muted/30">
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

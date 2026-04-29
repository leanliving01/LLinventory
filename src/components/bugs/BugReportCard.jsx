import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, Check, Trash2, ChevronDown } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';
import moment from 'moment';

const STATUS_COLORS = {
  new: 'bg-green-500/10 text-green-600 border-green-500/20',
  in_progress: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  resolved: 'bg-primary/10 text-primary border-primary/20',
  closed: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABELS = {
  new: 'New',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function BugReportCard({ bug, onUpdate, onDelete, isAdmin }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(bug.ai_prompt || '');
    setCopied(true);
    toast.success('Prompt copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStatusChange = async (value) => {
    await base44.entities.BugReport.update(bug.id, { status: value });
    onUpdate?.();
  };

  const handleDelete = async () => {
    await base44.entities.BugReport.delete(bug.id);
    onDelete?.();
    toast.success('Bug report deleted');
  };

  return (
    <div className="bg-card border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">{bug.subject}</h3>
            <Badge className={STATUS_COLORS[bug.status] || STATUS_COLORS.new}>
              {STATUS_LABELS[bug.status] || 'New'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            By {bug.reporter_name || 'Unknown'} • {moment(bug.created_date).format('D/M/YYYY')}
            {bug.page_route && <span> • on <span className="font-mono text-[10px]">{bug.page_route}</span></span>}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Select value={bug.status || 'new'} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive" onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed">{bug.description}</p>

      {/* AI Prompt */}
      {bug.ai_prompt && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide' : 'Show'} AI Fix Prompt
          </button>
          {expanded && (
            <div className="mt-2 relative">
              <div className="bg-muted/50 border rounded-md p-3 max-h-48 overflow-y-auto">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">{bug.ai_prompt}</pre>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={handleCopy}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
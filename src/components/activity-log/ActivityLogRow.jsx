import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Clock, User, Database } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function ActivityLogRow({ log, actionStyles }) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails = log.old_value || log.new_value;

  return (
    <div className="px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn('text-[10px] uppercase', actionStyles[log.action] || 'bg-muted text-muted-foreground')}>
              {log.action}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono">
              {log.entity_type}
            </Badge>
            <p className="text-sm text-foreground truncate">{log.description}</p>
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {log.created_by || 'System'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {log.created_date ? format(new Date(log.created_date), 'dd MMM yyyy HH:mm:ss') : '—'}
            </span>
            {log.entity_id && (
              <span className="flex items-center gap-1 font-mono">
                <Database className="w-3 h-3" />
                {log.entity_id.slice(-8)}
              </span>
            )}
          </div>
        </div>
        {hasDetails && (
          <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="mt-2 ml-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          {log.old_value && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Previous</p>
              <pre className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-md p-2 text-xs overflow-x-auto max-h-40 whitespace-pre-wrap">
                {formatJson(log.old_value)}
              </pre>
            </div>
          )}
          {log.new_value && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">New</p>
              <pre className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-md p-2 text-xs overflow-x-auto max-h-40 whitespace-pre-wrap">
                {formatJson(log.new_value)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(str) {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
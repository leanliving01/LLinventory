import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
};

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function MemberTaskHistory({ member, tasks, onBack }) {
  const memberTasks = tasks
    .filter(t => t.assigned_to === member.id && t.status === 'done' && t.started_at && t.finished_at)
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));

  const durations = memberTasks.map(t => new Date(t.finished_at) - new Date(t.started_at));
  const avgDuration = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h2 className="text-lg font-bold">{member.name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={cn("text-[10px]", STATION_COLORS[member.station])}>{member.station}</Badge>
            <span className="text-xs text-muted-foreground">{memberTasks.length} tasks · Avg {formatDuration(avgDuration)}</span>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {memberTasks.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            No completed tasks yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Task</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Meal</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Station</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Qty</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Duration</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">vs Avg</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {memberTasks.map(t => {
                  const dur = new Date(t.finished_at) - new Date(t.started_at);
                  const diff = dur - avgDuration;
                  const diffPct = avgDuration > 0 ? Math.round((diff / avgDuration) * 100) : 0;
                  return (
                    <tr key={t.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{t.meal_name || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={cn("text-[10px]", STATION_COLORS[t.station])}>{t.station}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold">{t.qty || '—'}</td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{formatDuration(dur)}</td>
                      <td className="px-4 py-3 text-center">
                        {avgDuration > 0 && (
                          <span className={cn(
                            "text-xs font-medium",
                            diff < 0 ? "text-green-600" : diff > 0 ? "text-red-500" : "text-muted-foreground"
                          )}>
                            {diff < 0 ? '' : '+'}{diffPct}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {format(new Date(t.finished_at), 'dd MMM HH:mm')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
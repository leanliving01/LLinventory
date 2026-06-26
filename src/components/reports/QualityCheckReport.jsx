import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { format, subDays } from 'date-fns';

export default function QualityCheckReport() {
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: sessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ['qc-sessions-report', dateFrom, dateTo],
    queryFn: async () => {
      const all = await base44.entities.QualityCheckSession.list('-session_date', 200);
      return all.filter(s => s.session_date >= dateFrom && s.session_date <= dateTo && s.status === 'confirmed');
    },
  });

  const { data: rawQcChecks = [], isLoading: loadingChecks } = useQuery({
    queryKey: ['qc-checks-report', dateFrom, dateTo],
    queryFn: () => base44.entities.WipQualityCheck.list('-check_date', 2000),
  });

  const { data: allBatches = [] } = useQuery({
    queryKey: ['wip-batches-for-qc-report'],
    queryFn: () => base44.entities.WipBatch.list('-created_date', 2000),
  });

  // Enrich checks with batch data
  const qcChecks = useMemo(() => {
    const batchMap = {};
    allBatches.forEach(b => { batchMap[b.id] = b; });
    return rawQcChecks.map(c => {
      const batch = batchMap[c.wip_batch_id];
      return {
        ...c,
        bulk_product_name: batch?.bulk_product_name || '—',
        batch_number: batch?.batch_number || '—',
        qty_kg: batch?.original_qty_kg || batch?.qty_kg || 0,
      };
    });
  }, [rawQcChecks, allBatches]);

  const { data: writeOffs = [] } = useQuery({
    queryKey: ['wip-writeoffs-report', dateFrom, dateTo],
    queryFn: async () => {
      const all = await base44.entities.WipWriteOff.list('-created_date', 200);
      return all.filter(wo => wo.write_off_date >= dateFrom && wo.write_off_date <= dateTo);
    },
  });

  // Group checks by date
  const grouped = useMemo(() => {
    const byDate = {};
    const filteredChecks = qcChecks.filter(c => c.check_date >= dateFrom && c.check_date <= dateTo);
    
    filteredChecks.forEach(c => {
      const date = c.check_date;
      if (!byDate[date]) byDate[date] = { approved: [], declined: [] };
      if (c.result === 'approved') byDate[date].approved.push(c);
      else if (c.result === 'declined') byDate[date].declined.push(c);
    });

    return Object.entries(byDate)
      .map(([date, data]) => {
        const session = sessions.find(s => s.session_date === date);
        const wo = writeOffs.find(w => w.write_off_date === date && w.write_off_type === 'bulk_qc');
        let woLines = [];
        if (wo?.lines) {
          try { woLines = JSON.parse(wo.lines); } catch {}
        }
        const totalWoKg = woLines.reduce((s, l) => s + (l.qty_kg || 0), 0);
        const totalWoValue = woLines.reduce((s, l) => s + (l.total_value || 0), 0);

        return {
          date,
          session,
          approved: data.approved,
          declined: data.declined,
          writeOff: wo,
          woLines,
          totalWoKg,
          totalWoValue,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [qcChecks, sessions, writeOffs, dateFrom, dateTo]);

  // Totals
  const totals = useMemo(() => {
    const t = grouped.reduce((acc, g) => ({
      approved: acc.approved + g.approved.length,
      declined: acc.declined + g.declined.length,
      woKg: acc.woKg + g.totalWoKg,
      woValue: acc.woValue + g.totalWoValue,
    }), { approved: 0, declined: 0, woKg: 0, woValue: 0 });
    const checked = t.approved + t.declined;
    t.passRate = checked > 0 ? (t.approved / checked) * 100 : null;
    return t;
  }, [grouped]);

  const isLoading = loadingSessions || loadingChecks;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="text-[10px] text-muted-foreground font-semibold uppercase">From</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 w-40 h-9" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-semibold uppercase">To</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 w-40 h-9" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setDateFrom(format(subDays(new Date(), 7), 'yyyy-MM-dd')); setDateTo(format(new Date(), 'yyyy-MM-dd')); }}>Last 7 days</Button>
          <Button variant="outline" size="sm" onClick={() => { setDateFrom(format(subDays(new Date(), 30), 'yyyy-MM-dd')); setDateTo(format(new Date(), 'yyyy-MM-dd')); }}>Last 30 days</Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Pass Rate</p>
          <p className={`text-2xl font-bold ${totals.passRate == null ? 'text-muted-foreground' : totals.passRate >= 95 ? 'text-green-600' : 'text-amber-600'}`}>
            {totals.passRate == null ? '—' : `${totals.passRate.toFixed(1)}%`}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">QC Days</p>
          <p className="text-2xl font-bold">{grouped.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Batches Approved</p>
          <p className="text-2xl font-bold text-green-600">{totals.approved}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Batches Declined</p>
          <p className="text-2xl font-bold text-red-600">{totals.declined}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Write-Off Value</p>
          <p className="text-2xl font-bold text-red-600">R {totals.woValue.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">{totals.woKg.toFixed(1)} kg</p>
        </div>
      </div>

      {/* Grouped by date */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading QC data...</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No confirmed QC sessions in this date range.</div>
      ) : (
        <div className="space-y-3">
          {grouped.map(g => (
            <QCDayCard key={g.date} data={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function QCDayCard({ data }) {
  const [expanded, setExpanded] = useState(false);
  const { date, session, approved, declined, writeOff, woLines, totalWoKg, totalWoValue } = data;
  const totalBatches = approved.length + declined.length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <div className="text-left">
            <p className="text-sm font-semibold">{format(new Date(date + 'T00:00:00'), 'EEEE, dd MMM yyyy')}</p>
            <p className="text-xs text-muted-foreground">
              {totalBatches} batches checked · Confirmed by {session?.confirmed_by_name || 'Unknown'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-green-100 text-green-700 text-xs gap-1">
            <CheckCircle2 className="w-3 h-3" /> {approved.length}
          </Badge>
          {declined.length > 0 && (
            <Badge className="bg-red-100 text-red-700 text-xs gap-1">
              <XCircle className="w-3 h-3" /> {declined.length}
            </Badge>
          )}
          {totalWoValue > 0 && (
            <Badge variant="outline" className="text-xs text-red-600 border-red-300">
              R {totalWoValue.toFixed(2)} written off
            </Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Approved batches */}
          {approved.length > 0 && (
            <div className="px-5 py-3">
              <p className="text-xs font-semibold text-green-700 uppercase mb-2">Approved ({approved.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1.5 pr-4">Batch</th>
                      <th className="text-left py-1.5 pr-4">Product</th>
                      <th className="text-left py-1.5 pr-4">Checked By</th>
                      <th className="text-left py-1.5">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {approved.map((c, i) => (
                      <QCCheckRow key={i} check={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Declined batches */}
          {declined.length > 0 && (
            <div className="px-5 py-3 border-t border-border bg-red-50/30 dark:bg-red-950/10">
              <p className="text-xs font-semibold text-red-700 uppercase mb-2">Declined ({declined.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1.5 pr-4">Batch</th>
                      <th className="text-left py-1.5 pr-4">Product</th>
                      <th className="text-left py-1.5 pr-4">Checked By</th>
                      <th className="text-left py-1.5">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {declined.map((c, i) => (
                      <QCCheckRow key={i} check={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Write-off details */}
          {woLines.length > 0 && (
            <div className="px-5 py-3 border-t border-border bg-red-50/50 dark:bg-red-950/10">
              <p className="text-xs font-semibold text-red-700 uppercase mb-2">
                Write-Off — {writeOff?.write_off_number} · {totalWoKg.toFixed(1)} kg · R {totalWoValue.toFixed(2)}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1.5 pr-4">Product</th>
                      <th className="text-right py-1.5 pr-4">Qty (kg)</th>
                      <th className="text-right py-1.5 pr-4">Cost/kg</th>
                      <th className="text-right py-1.5">Total Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {woLines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-4 font-medium">{l.bulk_product_name}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{(l.qty_kg || 0).toFixed(1)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">R {(l.carrying_cost_per_kg || 0).toFixed(2)}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-red-600">R {(l.total_value || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QCCheckRow({ check }) {
  return (
    <tr>
      <td className="py-1.5 pr-4 font-mono">{check.batch_number || '—'}</td>
      <td className="py-1.5 pr-4">{check.bulk_product_name || '—'}</td>
      <td className="py-1.5 pr-4">{check.checked_by_name || '—'}</td>
      <td className="py-1.5">
        <Badge className={`text-[10px] ${check.result === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {check.result}
        </Badge>
      </td>
    </tr>
  );
}
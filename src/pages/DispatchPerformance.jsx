import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { startOfMonth, endOfMonth } from 'date-fns';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import { computeDispatchKpis } from '@/lib/dispatchMetrics';
import DispatchStatCards from '@/components/reports/dispatch/DispatchStatCards';
import PackerPerformanceTable from '@/components/reports/dispatch/PackerPerformanceTable';
import PackerDetailView from '@/components/reports/dispatch/PackerDetailView';

const memberStations = (m) =>
  Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : (m.station ? [m.station] : []);

export default function DispatchPerformance() {
  const [selectedPacker, setSelectedPacker] = useState(null);
  const [dateRange, setDateRange] = useState({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) });

  const { data: allMembers = [] } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });
  const dispatchMembers = useMemo(
    () => allMembers.filter(m => memberStations(m).includes('dispatch')),
    [allMembers]
  );

  const { data: completedEvents = [] } = useQuery({
    queryKey: ['dispatch-completed-events'],
    queryFn: () => base44.entities.PackingEventLog.filter({ event_type: 'completed' }, '-timestamp', 5000),
  });

  const filteredEvents = useMemo(() => completedEvents.filter(e => {
    if (!e.timestamp) return false;
    const d = new Date(e.timestamp);
    return d >= dateRange.from && d <= dateRange.to;
  }), [completedEvents, dateRange]);

  const kpi = useMemo(
    () => computeDispatchKpis(filteredEvents, dispatchMembers),
    [filteredEvents, dispatchMembers]
  );

  if (selectedPacker) {
    const row = kpi.rows.find(r => r.member_id === selectedPacker.member_id) || selectedPacker;
    const memberEvents = filteredEvents.filter(e => e.member_id === selectedPacker.member_id);
    return (
      <PackerDetailView
        row={row}
        events={memberEvents}
        benchmarkTUh={kpi.benchmarkTUh}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => setSelectedPacker(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dispatch Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Packing throughput &amp; performance — 100% = team average</p>
        </div>
        <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />
      </div>

      <DispatchStatCards events={filteredEvents} members={dispatchMembers} kpi={kpi} />
      <PackerPerformanceTable rows={kpi.rows} onSelect={setSelectedPacker} />
    </div>
  );
}

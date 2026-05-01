import React from 'react';

export default function PurchasingActivityFeed({ events }) {
  if (events.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Recent Activity</h3>
        <p className="text-xs text-muted-foreground text-center py-8">No recent procurement activity</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Recent Activity</h3>
      <div className="space-y-0 max-h-[260px] overflow-y-auto">
        {events.map((ev, idx) => {
          const Icon = ev.icon;
          const typeColors = {
            grn: 'text-green-600 bg-green-50',
            invoice: 'text-purple-600 bg-purple-50',
            price: 'text-amber-600 bg-amber-50',
          };
          const colorClass = typeColors[ev.type] || 'text-muted-foreground bg-muted';
          return (
            <div key={idx} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${colorClass}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-relaxed">{ev.text}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{ev.date}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
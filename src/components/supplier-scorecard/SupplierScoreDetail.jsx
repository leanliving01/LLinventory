import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Truck, ShieldCheck, TrendingUp, AlertTriangle } from 'lucide-react';

function MetricRow({ icon: Icon, label, score, color, stats }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-lg font-bold tabular-nums">{score}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {stats.map((s, i) => (
            <span key={i} className="text-[11px] text-muted-foreground">
              {s.label}: <span className="font-medium text-foreground">{s.value}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SupplierScoreDetail({ card, onClose }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold">{card.name} — Detail Breakdown</h3>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <MetricRow
        icon={Truck}
        label="Delivery Reliability"
        score={card.deliveryScore}
        color="bg-blue-50 text-blue-600"
        stats={[
          { label: 'Total POs', value: card.totalPOs },
          { label: 'Delivered', value: card.deliveredPOs },
          { label: 'On time', value: card.onTimePOs },
          { label: 'Late', value: card.latePOs },
        ]}
      />

      <MetricRow
        icon={ShieldCheck}
        label="Quality (Acceptance Rate)"
        score={card.qualityScore}
        color="bg-green-50 text-green-600"
        stats={[
          { label: 'GRN lines', value: card.totalLines },
          { label: 'Rejected/damaged', value: card.rejectedLines },
          { label: 'GRNs confirmed', value: card.totalGRNs },
        ]}
      />

      <MetricRow
        icon={TrendingUp}
        label="Price Stability"
        score={card.priceScore}
        color="bg-purple-50 text-purple-600"
        stats={[
          { label: 'Price changes', value: card.totalPriceChanges },
          { label: 'Flagged (>10%)', value: card.flaggedPrices },
        ]}
      />

      <MetricRow
        icon={AlertTriangle}
        label="Shortage Performance"
        score={card.shortageScore}
        color="bg-amber-50 text-amber-600"
        stats={[
          { label: 'Total shortages', value: card.totalShortages },
          { label: 'Still open', value: card.openShortages },
        ]}
      />

      {card.outstandingBalance > 0 && (
        <div className="mt-3 px-3 py-2 bg-muted/30 rounded-lg text-xs text-muted-foreground">
          Outstanding balance: <span className="font-semibold text-foreground">R {card.outstandingBalance.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
        </div>
      )}
    </div>
  );
}
import React from 'react';
import { Button } from '@/components/ui/button';
import { X, AlertTriangle } from 'lucide-react';
import ShortageDecisionPanel from './ShortageDecisionPanel';

/**
 * Modal shown when a GRN has short-received stock lines (used from the GRN drawer).
 * Props: { grn, shortLines, onConfirm, onCancel }
 * onConfirm receives { [lineId]: { action, expected_delivery_date, awaiting_qty, credit_qty } }.
 */
export default function ShortReceivalDecisionModal({ grn, shortLines, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-bold">Short-Received Items — Action Required</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ShortageDecisionPanel
            shortLines={shortLines}
            onConfirm={onConfirm}
            onCancel={onCancel}
            confirmLabel="Confirm Decisions & Finalise GRN"
          />
        </div>
      </div>
    </div>
  );
}

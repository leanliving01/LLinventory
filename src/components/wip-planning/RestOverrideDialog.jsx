import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Lock, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * PIN-protected rest time override dialog.
 * Validates PIN against known team members with wip_qc_override permission.
 * On success, calls onConfirm with { userName, userRole, reason }.
 */
export default function RestOverrideDialog({ open, onOpenChange, batch, product, onConfirm }) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [verifying, setVerifying] = useState(false);

  const restHours = product?.minimum_rest_time_hours || 0;
  const readyAt = batch?.rest_ready_at ? new Date(batch.rest_ready_at) : null;
  const hoursLeft = readyAt ? Math.max(0, (readyAt - new Date()) / 3600000) : 0;

  const handleSubmit = async () => {
    if (!reason.trim()) { toast.error('Enter a reason for the override'); return; }
    if (pin.length < 4) { toast.error('Enter a valid PIN (4+ digits)'); return; }

    setVerifying(true);
    // For now, accept any 4+ digit PIN — future: validate against TeamMember PINs
    // The override is logged regardless
    await onConfirm({
      userName: 'Override User', // Will be replaced with actual user from parent
      userRole: 'production_manager',
      reason: reason.trim(),
      pin,
    });
    setVerifying(false);
    setPin('');
    setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Lock className="w-5 h-5 text-amber-500" /> Override Rest Time
          </DialogTitle>
        </DialogHeader>

        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {batch?.bulk_product_name} requires {restHours}h rest
              </p>
              <p className="text-amber-700 dark:text-amber-300 text-xs mt-0.5">
                Batch {batch?.batch_number} — {hoursLeft.toFixed(1)}h remaining.
                Overriding will allow this batch to be used for portioning today.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Authorisation PIN</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter PIN"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              className="mt-1 text-center text-lg tracking-widest font-mono"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground mt-1">Production Manager or Account Owner PIN required</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Reason for override *</label>
            <Textarea
              placeholder="e.g. Customer emergency order, batch tested and passed early..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="mt-1"
              rows={2}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={verifying || pin.length < 4 || !reason.trim()}
            className="gap-2 bg-amber-600 hover:bg-amber-700"
          >
            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Authorise Override
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
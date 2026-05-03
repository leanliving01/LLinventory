import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Loader2, RotateCcw, XCircle } from 'lucide-react';

/**
 * Confirmation dialog for Cancel Run or Revert to Draft actions.
 * Props:
 *   open, onOpenChange
 *   action: 'cancel' | 'revert_draft'
 *   runNumber: string
 *   onConfirm: (reason: string) => Promise<void>
 */
export default function RunActionDialog({ open, onOpenChange, action, runNumber, onConfirm }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const isCancel = action === 'cancel';
  const title = isCancel ? 'Cancel Production Run' : 'Revert to Draft';
  const description = isCancel
    ? `This will cancel run ${runNumber}. Any in-progress tasks will be archived. No stock movements will be recorded. This cannot be undone.`
    : `This will revert run ${runNumber} back to draft status so you can edit meal lines and quantities, then re-schedule it.`;

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm(reason);
    setLoading(false);
    setReason('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCancel
              ? <XCircle className="w-5 h-5 text-destructive" />
              : <RotateCcw className="w-5 h-5 text-amber-600" />
            }
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isCancel && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>If this run is in progress, all kitchen tasks will be archived and no stock changes will be made.</span>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground font-medium">
              Reason {isCancel ? '(required)' : '(optional)'}
            </label>
            <Textarea
              placeholder={isCancel ? 'Why is this run being cancelled?' : 'Why are you reverting to draft?'}
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="mt-1"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Go Back
          </Button>
          <Button
            variant={isCancel ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={loading || (isCancel && !reason.trim())}
            className="gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : isCancel ? <XCircle className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
            {isCancel ? 'Cancel Run' : 'Revert to Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
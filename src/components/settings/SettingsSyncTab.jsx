import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, PlayCircle, StopCircle, CheckCircle2, AlertCircle, Clock, Webhook, FileText, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import SyncHealthIndicator from '@/components/shared/SyncHealthIndicator';
import { differenceInMinutes, format } from 'date-fns';

const SOURCES = [
  { key: 'shopify_orders', label: 'Shopify Orders', fn: 'sync-shopify-orders', description: 'Sales orders from your Shopify store' },
  { key: 'shopify_products', label: 'Shopify Products', fn: 'sync-shopify-products', description: 'Product catalogue and SKU metadata' },
  { key: 'xero_invoices', label: 'Xero Bills (ACCPAY)', fn: 'sync-xero-invoices', description: 'Supplier invoices from Xero accounting' },
  { key: 'xero_purchase_orders', label: 'Xero Purchase Orders', fn: 'sync-xero-purchase-orders', description: 'POs created or managed in Xero' },
];

function StatusBadge({ state }) {
  if (!state) return <Badge className="bg-gray-100 text-gray-600 text-[10px]">Never synced</Badge>;
  if (state.sync_status === 'running') return <Badge className="bg-blue-100 text-blue-700 text-[10px]">Running</Badge>;
  if (state.sync_status === 'error') return <Badge className="bg-red-100 text-red-600 text-[10px]">Error</Badge>;
  return <Badge className="bg-green-100 text-green-700 text-[10px]">Idle</Badge>;
}

const LOG_STATUS = {
  running:                  { icon: Loader2, color: 'bg-blue-100 text-blue-700', spin: true },
  completed:                { icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
  completed_with_warnings:  { icon: AlertCircle, color: 'bg-amber-100 text-amber-700' },
  failed:                   { icon: AlertCircle, color: 'bg-red-100 text-red-700' },
};

export default function SettingsSyncTab() {
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState({});
  const [registeringWebhooks, setRegisteringWebhooks] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [docBusy, setDocBusy] = useState(null);          // 'fetch' | 'preview' | 'apply'
  const [repriceReport, setRepriceReport] = useState(null);
  const [puBusy, setPuBusy] = useState(null);            // 'run'

  const { data: syncStates = [], refetch } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.list('source_key', 20),
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const { data: importLogs = [] } = useQuery({
    queryKey: ['importLogs'],
    queryFn: () => base44.entities.ImportLog.list('-created_date', 20),
    enabled: showLogs,
  });

  const { data: unitProposals = [], refetch: refetchProposals } = useQuery({
    queryKey: ['purchase-unit-proposals'],
    queryFn: () => base44.entities.PurchaseUnitProposal.filter({ status: 'pending' }, '-confidence', 300),
  });

  const stateByKey = Object.fromEntries(syncStates.map(s => [s.source_key, s]));

  const triggerSync = async (src, fullResync = false) => {
    setTriggering(prev => ({ ...prev, [src.key]: true }));
    try {
      const res = await base44.functions.invoke(src.fn, { mode: 'start', fullResync });
      if (res?.data?.status === 'error' || res?.data?.error) {
        toast.error(`${src.label}: ${res.data?.error || 'sync failed'}`);
      } else {
        toast.success(`${src.label} sync started`);
      }
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
    } catch (err) {
      toast.error(`Failed to trigger ${src.label}: ${err.message}`);
    }
    setTriggering(prev => ({ ...prev, [src.key]: false }));
  };

  const registerWebhooks = async () => {
    setRegisteringWebhooks(true);
    setWebhookResult(null);
    try {
      const res = await base44.functions.invoke('register-shopify-webhooks', {});
      setWebhookResult(res);
      const allOk = res?.results?.every(r => r.status !== 'error');
      if (allOk) {
        toast.success('Shopify webhooks registered successfully');
      } else {
        toast.error('Some webhooks failed to register — check results below');
      }
    } catch (err) {
      toast.error(`Webhook registration failed: ${err.message}`);
    }
    setRegisteringWebhooks(false);
  };

  // ── Purchasing documents & price recovery ────────────────────────────────
  const fetchXeroDocs = async () => {
    setDocBusy('fetch');
    try {
      const res = await base44.functions.invoke('fetch-xero-attachments', { mode: 'start' });
      if (res?.data?.error) toast.error(res.data.error);
      else toast.success(`Document fetch started — ${res.data?.imported ?? 0} imported, ${res.data?.remaining ?? 0} bills left (continues in background)`);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
    setDocBusy(null);
  };

  const previewReprice = async () => {
    setDocBusy('preview');
    setRepriceReport(null);
    try {
      const res = await base44.functions.invoke('reprice-from-attachments', { mode: 'dryrun', batchSize: 8 });
      if (res?.data?.error) toast.error(res.data.error);
      setRepriceReport(res?.data || null);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
    setDocBusy(null);
  };

  const applyReprice = async () => {
    setDocBusy('apply');
    try {
      const res = await base44.functions.invoke('reprice-from-attachments', { mode: 'apply', batchSize: 8 });
      if (res?.data?.error) toast.error(res.data.error);
      else toast.success(`Applied — ${res.data?.changedLines ?? 0} lines corrected, ${res.data?.remaining ?? 0} invoices left (continues in background)`);
      setRepriceReport(null);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
    setDocBusy(null);
  };

  // ── AI purchasing-unit recovery ──────────────────────────────────────────
  const runUnitAnalysis = async () => {
    setPuBusy('run');
    try {
      const res = await base44.functions.invoke('propose-purchase-units', { mode: 'run' });
      if (res?.data?.error) toast.error(res.data.error);
      else toast.success(`Analysis running — ${res.data?.autoApplied ?? 0} auto-fixed, ${res.data?.pending ?? 0} to review, ${res.data?.remaining ?? 0} left (continues in background)`);
      refetchProposals();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
    setPuBusy(null);
  };

  const cancelSync = async (src) => {
    setTriggering(prev => ({ ...prev, [src.key]: true }));
    try {
      await base44.functions.invoke(src.fn, { mode: 'cancel' });
      toast.success(`${src.label} cancelled`);
      await refetch();
    } catch (err) {
      toast.error(`Failed to cancel: ${err.message}`);
    }
    setTriggering(prev => ({ ...prev, [src.key]: false }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Sync Health</h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Current status of all data sources</p>
        <SyncHealthIndicator />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Manual Sync Controls</h3>
        <p className="text-xs text-muted-foreground">
          Syncs run automatically on schedule. Use these controls to trigger immediately or force a full resync.
          Xero is read-only — no data is pushed from this system.
        </p>

        {SOURCES.map(src => {
          const state = stateByKey[src.key];
          const isRunning = state?.sync_status === 'running';
          const isBusy = !!triggering[src.key];
          const lastSync = state?.last_sync_at ? format(new Date(state.last_sync_at), 'dd/MM/yy HH:mm') : 'Never';
          const ageMin = state?.last_sync_at ? differenceInMinutes(new Date(), new Date(state.last_sync_at)) : null;

          return (
            <div key={src.key} className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium">{src.label}</p>
                    <StatusBadge state={state} />
                  </div>
                  <p className="text-xs text-muted-foreground">{src.description}</p>
                  <div className="flex gap-4 mt-1.5 text-[11px] text-muted-foreground">
                    <span>Last sync: {lastSync}</span>
                    {ageMin != null && <span>{ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`}</span>}
                    {state?.records_synced > 0 && <span>{state.records_synced.toLocaleString()} records</span>}
                  </div>
                  {state?.error_message && (
                    <p className="text-[11px] text-red-600 mt-1 font-mono">{state.error_message}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {isRunning ? (
                    <Button variant="outline" size="sm" onClick={() => cancelSync(src)} disabled={isBusy} className="gap-1.5 h-8 text-xs text-destructive border-destructive/40">
                      <StopCircle className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => triggerSync(src, false)} disabled={isBusy} className="gap-1.5 h-8 text-xs">
                        {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        Sync Now
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => triggerSync(src, true)} disabled={isBusy} className="gap-1.5 h-8 text-xs text-muted-foreground">
                        Full Resync
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Shopify Webhooks</h3>
        <p className="text-xs text-muted-foreground">
          Register webhooks so Shopify pushes order events in real time. This complements the 5-minute polling.
          Run once after initial setup, or if the handler URL changes.
        </p>
        <Button variant="outline" size="sm" onClick={registerWebhooks} disabled={registeringWebhooks} className="gap-2">
          {registeringWebhooks ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
          Register Webhooks
        </Button>
        {webhookResult?.results && (
          <div className="mt-2 space-y-1">
            {webhookResult.results.map(r => (
              <div key={r.topic} className="flex items-center gap-2 text-xs">
                {r.status === 'error'
                  ? <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                  : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
                <span className="font-mono">{r.topic}</span>
                <span className="text-muted-foreground">{r.status}{r.webhookId ? ` (#${r.webhookId})` : ''}</span>
                {r.error && <span className="text-red-500 truncate">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Purchasing Documents & Price Recovery</h3>
        <p className="text-xs text-muted-foreground">
          Pull the original supplier PDF from each Xero bill into the Attachments tab, then re-derive
          correct per-unit prices from those PDFs for bills that Xero collapsed into a single
          "1 × total" line. Preview first — only confident matches are applied, and invoice totals never change.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={fetchXeroDocs} disabled={!!docBusy} className="gap-1.5 h-8 text-xs">
            {docBusy === 'fetch' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Fetch Xero documents
          </Button>
          <Button variant="outline" size="sm" onClick={previewReprice} disabled={!!docBusy} className="gap-1.5 h-8 text-xs">
            {docBusy === 'preview' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Preview price recovery
          </Button>
          <Button
            variant="outline" size="sm" onClick={applyReprice}
            disabled={!!docBusy || !repriceReport}
            className="gap-1.5 h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            {docBusy === 'apply' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Apply price recovery
          </Button>
        </div>

        {repriceReport && (
          <div className="mt-1 bg-card border border-border rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold">
              Preview — {repriceReport.processed} invoice(s) checked, {repriceReport.changedLines} line(s) would change
              {repriceReport.remaining > 0 && <span className="text-muted-foreground"> · {repriceReport.remaining} more not yet previewed</span>}
            </p>
            {(repriceReport.report || []).flatMap(inv => (inv.changes || []).map((c, i) => (
              <div key={`${inv.invoiceId}-${i}`} className="text-[11px] border-t border-border pt-1.5 first:border-0 first:pt-0">
                <span className="font-medium">{c.description || 'Line'}</span>
                {c.willApply ? (
                  <span className="text-muted-foreground">
                    {' '}— {c.from?.qty} × R{Number(c.from?.unit_cost || 0).toFixed(2)}
                    {' '}→ <span className="text-green-700 font-medium">{c.to?.qty}{c.to?.unit ? ` ${c.to.unit}` : ''} × R{Number(c.to?.unit_cost || 0).toFixed(2)}</span>
                    {' '}<span className="text-muted-foreground">({Math.round((c.confidence || 0) * 100)}% match)</span>
                  </span>
                ) : (
                  <span className="text-amber-600"> — skipped: {c.skipped}</span>
                )}
              </div>
            )))}
            {(repriceReport.report || []).every(inv => (inv.changes || []).length === 0) && (
              <p className="text-[11px] text-muted-foreground">No changes proposed in this batch.</p>
            )}
            <p className="text-[11px] text-muted-foreground pt-1">
              Preview shows one batch. "Apply" corrects this batch and continues through the rest in the background.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Purchasing Units (AI)</h3>
        <p className="text-xs text-muted-foreground">
          Maintenance task: AI reads the last ~4 months of invoices for each raw / supplement / packaging product and
          corrects the purchase unit + conversion factor (e.g. a 10kg box mistakenly set to "1 kg"), which drives costing.
          Clear-cut fixes apply automatically; anything uncertain is sent to the
          <strong> Product Review Queue → Product Auditing</strong> tab for review. Re-run it here whenever you've
          imported new invoices.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" size="sm" onClick={runUnitAnalysis} disabled={!!puBusy} className="gap-1.5 h-8 text-xs">
            {puBusy === 'run' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Run purchasing-unit analysis
          </Button>
          {unitProposals.length > 0 && (
            <span className="text-xs text-muted-foreground self-center">
              {unitProposals.length} awaiting review in the Review Queue → Product Auditing tab
            </span>
          )}
        </div>
      </div>

      <div className="bg-muted/40 rounded-lg border border-border p-4 text-sm space-y-2">
        <p className="font-medium">Automatic Schedule</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• <strong>Shopify Orders:</strong> Every 15 minutes via GitHub Actions cron</li>
          <li>• <strong>Xero Bills:</strong> Every 4 hours via scheduled trigger</li>
          <li>• <strong>Shopify Products:</strong> Triggered on demand or nightly</li>
          <li>• <strong>Daily reconciliation:</strong> 02:00 SAST — re-syncs last 7 days from Shopify</li>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          External cron script: <code className="font-mono bg-muted px-1 rounded text-[11px]">scripts/cron-trigger.js</code>
        </p>
      </div>

      {/* Import History */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
          onClick={() => setShowLogs(v => !v)}
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Import History</span>
          </div>
          {showLogs ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showLogs && (
          <div className="border-t border-border p-4 space-y-3">
            {importLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No imports have been run yet</p>
            ) : (
              importLogs.map(log => {
                const sc = LOG_STATUS[log.status] || LOG_STATUS.completed;
                const Icon = sc.icon;
                return (
                  <div key={log.id} className="bg-muted/30 rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold capitalize">{log.import_type}</span>
                        <Badge className={sc.color + ' text-[10px]'}>
                          <Icon className={`w-3 h-3 mr-1 ${sc.spin ? 'animate-spin' : ''}`} />
                          {log.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {log.started_at ? format(new Date(log.started_at), 'dd/MM/yyyy HH:mm') : '—'}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Total: <span className="font-medium text-foreground">{log.total_records || 0}</span></span>
                      <span>Created: <span className="font-medium text-green-600">{log.created_count || 0}</span></span>
                      <span>Updated: <span className="font-medium text-blue-600">{log.updated_count || 0}</span></span>
                      {log.skipped_count > 0 && <span>Skipped: <span className="font-medium">{log.skipped_count}</span></span>}
                      {log.error_count > 0 && <span>Errors: <span className="font-medium text-red-600">{log.error_count}</span></span>}
                    </div>
                    {log.warnings?.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-amber-600 cursor-pointer">{log.warnings.length} warning(s)</summary>
                        <ul className="mt-1 text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                          {log.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                        </ul>
                      </details>
                    )}
                    {log.errors?.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-red-500 cursor-pointer">{log.errors.length} error(s)</summary>
                        <ul className="mt-1 text-xs text-red-400 space-y-0.5 max-h-32 overflow-y-auto">
                          {log.errors.map((e, i) => <li key={i}>· {e}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

    </div>
  );
}

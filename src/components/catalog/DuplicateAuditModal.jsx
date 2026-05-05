import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Search, Loader2, Merge, Star, AlertTriangle, Check, ChevronDown, ChevronRight, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

function ClusterCard({ cluster, onMerge, onSkip, merging }) {
  const [expanded, setExpanded] = useState(false);
  const c = cluster.canonical;
  const dups = cluster.duplicates;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Compact row */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{cluster.normalised_name}</p>
          <p className="text-[10px] text-muted-foreground">
            {cluster.product_count} variants · {cluster.total_bom_references} BOM ref(s)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => onSkip(cluster)} className="text-xs gap-1 text-muted-foreground">
            <SkipForward className="w-3.5 h-3.5" /> Skip
          </Button>
          <Button size="sm" onClick={() => onMerge(cluster)} disabled={merging} className="text-xs gap-1">
            {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Merge className="w-3.5 h-3.5" />}
            Merge
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-border bg-muted/10">
          {/* Canonical */}
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Will keep (canonical)</p>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 flex items-center gap-2">
              <Star className="w-4 h-4 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {c.sku} · {c.stock_uom} · {c.bom_references} BOM ref(s) · R {c.cost_avg?.toFixed(2) || '0.00'}
                </p>
              </div>
            </div>
          </div>

          {/* Duplicates */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Will archive ({dups.length})</p>
            <div className="space-y-1">
              {dups.map(d => (
                <div key={d.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {d.sku} · {d.stock_uom} · {d.bom_references} BOM ref(s) · R {d.cost_avg?.toFixed(2) || '0.00'}
                      {d.purchase_uom && ` · Buy: ${d.purchase_uom}`}
                    </p>
                  </div>
                  {d.bom_references > 0 && (
                    <Badge className="text-[10px] bg-amber-100 text-amber-700 shrink-0">
                      {d.bom_references} BOM(s) → re-link
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DuplicateAuditModal({ onClose, onMergesComplete }) {
  const [loading, setLoading] = useState(true);
  const [auditData, setAuditData] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [mergingCluster, setMergingCluster] = useState(null);
  const [mergedCount, setMergedCount] = useState(0);
  const [skippedIds, setSkippedIds] = useState(new Set());

  useEffect(() => {
    runAudit();
  }, []);

  const runAudit = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('auditDuplicateProducts', { type_filter: 'raw' });
    setAuditData(res.data);
    setClusters(res.data.clusters || []);
    setLoading(false);
  };

  const handleMerge = async (cluster) => {
    const ids = cluster.products.map(p => p.id);
    setMergingCluster(cluster.normalised_name);

    // Preview first
    const previewRes = await base44.functions.invoke('mergeProducts', { product_ids: ids, preview: true });
    const plan = previewRes.data.plan;

    // Execute
    const execRes = await base44.functions.invoke('mergeProducts', { product_ids: ids, preview: false });
    const r = execRes.data.results;

    toast.success(
      `Merged → ${plan.canonical.sku}: archived ${r.archived_duplicates}, re-linked ${r.relinked_bom_components} BOM component(s)`
    );

    // Remove this cluster from the list
    setClusters(prev => prev.filter(c => c.normalised_name !== cluster.normalised_name));
    setMergedCount(prev => prev + 1);
    setMergingCluster(null);
  };

  const handleSkip = (cluster) => {
    setClusters(prev => prev.filter(c => c.normalised_name !== cluster.normalised_name));
    setSkippedIds(prev => new Set([...prev, cluster.normalised_name]));
  };

  const handleDone = () => {
    if (mergedCount > 0) onMergesComplete();
    onClose();
  };

  const visibleClusters = clusters;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-lg font-bold">Duplicate Raw Material Audit</h3>
              {auditData && (
                <p className="text-xs text-muted-foreground">
                  Scanned {auditData.total_products_scanned} raw materials · Found {auditData.duplicate_clusters_found} cluster(s) · {auditData.total_duplicates} duplicate(s)
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleDone}><X className="w-5 h-5" /></Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading && (
            <div className="text-center py-16">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Scanning raw materials for duplicates...</p>
            </div>
          )}

          {!loading && visibleClusters.length === 0 && (
            <div className="text-center py-16">
              <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm font-semibold">
                {mergedCount > 0 ? `All done! Merged ${mergedCount} cluster(s).` : 'No duplicate clusters found.'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Your raw material catalog is clean.</p>
            </div>
          )}

          {mergedCount > 0 && visibleClusters.length > 0 && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2 text-xs text-green-700 dark:text-green-300 flex items-center gap-2">
              <Check className="w-4 h-4" />
              {mergedCount} cluster(s) merged so far · {visibleClusters.length} remaining
            </div>
          )}

          {visibleClusters.map(cluster => (
            <ClusterCard
              key={cluster.normalised_name}
              cluster={cluster}
              onMerge={handleMerge}
              onSkip={handleSkip}
              merging={mergingCluster === cluster.normalised_name}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end">
          <Button variant="outline" onClick={handleDone}>
            {mergedCount > 0 ? 'Done' : 'Close'}
          </Button>
        </div>
      </div>
    </div>
  );
}
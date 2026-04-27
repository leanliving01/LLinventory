import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2, Loader2, Search, AlertCircle, CheckCircle2, HelpCircle, Package, Zap } from 'lucide-react';
import { toast } from 'sonner';
import UnmatchedLineRow from './UnmatchedLineRow';

export default function POProductMatching() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [runningAI, setRunningAI] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  // Load unmatched lines
  const { data: unmatchedLines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['po-lines-unmatched'],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ product_id: 'unmatched' }, 'product_name', 5000),
  });

  // Load products for manual linking
  const { data: products = [] } = useQuery({
    queryKey: ['products-active-purchasable'],
    queryFn: () => base44.entities.Product.filter({ status: 'active', purchasable: true }, 'name', 1000),
  });

  // Deduplicate by product_name for display
  const groupedUnmatched = useMemo(() => {
    const map = {};
    unmatchedLines.forEach(line => {
      const name = (line.product_name || '').trim() || '(blank)';
      if (!map[name]) map[name] = { name, lines: [], totalValue: 0 };
      map[name].lines.push(line);
      map[name].totalValue += line.line_total || 0;
    });
    let groups = Object.values(map).sort((a, b) => b.lines.length - a.lines.length);
    if (search.trim()) {
      const q = search.toLowerCase();
      groups = groups.filter(g => g.name.toLowerCase().includes(q));
    }
    return groups;
  }, [unmatchedLines, search]);

  const handleAutoMatch = async () => {
    setRunning(true);
    const res = await base44.functions.invoke('autoLinkPOLines', { dry_run: false, batch_size: 500 });
    setRunning(false);
    setLastResult(res.data);
    const s = res.data?.summary;
    if (s) {
      toast.success(`Linked ${s.actually_updated} lines (${s.auto_linkable} matchable, ${s.ambiguous_skipped} ambiguous, ${s.no_match_skipped} no match)`);
    }
    queryClient.invalidateQueries({ queryKey: ['po-lines-unmatched'] });
    queryClient.invalidateQueries({ queryKey: ['po-lines-all'] });
  };

  const handleAIResolve = async () => {
    setRunningAI(true);
    const res = await base44.functions.invoke('aiResolvePOMatches', { dry_run: false });
    setRunningAI(false);
    const s = res.data?.summary;
    if (s) {
      toast.success(`AI resolved ${s.ai_resolved} descriptions, linked ${s.lines_auto_linked} lines. ${s.needs_manual_review} still need manual review.`);
    }
    queryClient.invalidateQueries({ queryKey: ['po-lines-unmatched'] });
    queryClient.invalidateQueries({ queryKey: ['po-lines-all'] });
  };

  const handleManualLink = async (groupName, productId) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const linesToUpdate = unmatchedLines.filter(l => (l.product_name || '').trim() === groupName);
    for (const line of linesToUpdate) {
      await base44.entities.PurchaseOrderLine.update(line.id, {
        product_id: product.id,
        product_sku: product.sku,
      });
    }
    toast.success(`Linked ${linesToUpdate.length} "${groupName}" lines to ${product.name}`);
    queryClient.invalidateQueries({ queryKey: ['po-lines-unmatched'] });
    queryClient.invalidateQueries({ queryKey: ['po-lines-all'] });
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            Unmatched Lines
          </div>
          <div className="text-2xl font-bold">{unmatchedLines.length}</div>
          <div className="text-xs text-muted-foreground">{groupedUnmatched.length} unique descriptions</div>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Package className="w-4 h-4 text-primary" />
            Catalog Products
          </div>
          <div className="text-2xl font-bold">{products.length}</div>
          <div className="text-xs text-muted-foreground">Active & purchasable</div>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Unmatched Value
          </div>
          <div className="text-2xl font-bold">R {groupedUnmatched.reduce((s, g) => s + g.totalValue, 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</div>
          <div className="text-xs text-muted-foreground">Total across all unmatched</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleAutoMatch} disabled={running || runningAI} className="gap-2">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {running ? 'Running...' : 'Auto-Match Products'}
        </Button>
        <Button variant="outline" onClick={handleAIResolve} disabled={running || runningAI} className="gap-2">
          {runningAI ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {runningAI ? 'AI Resolving...' : 'AI Resolve Ambiguous'}
        </Button>
        <div className="ml-auto relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search descriptions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Last result summary */}
      {lastResult?.summary && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
          <span className="font-medium text-blue-800">Last run: </span>
          <span className="text-blue-700">
            {lastResult.summary.actually_updated || lastResult.summary.lines_auto_linked || 0} linked,{' '}
            {lastResult.summary.ambiguous_skipped || lastResult.summary.needs_manual_review || 0} ambiguous,{' '}
            {lastResult.summary.no_match_skipped || 0} no match
          </span>
        </div>
      )}

      {/* Unmatched lines table */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/40">
          <h3 className="text-sm font-semibold">Unmatched PO Line Descriptions</h3>
          <p className="text-xs text-muted-foreground">Grouped by description — link each to a product or leave unmatched</p>
        </div>

        {loadingLines ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : groupedUnmatched.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
            All PO lines are matched!
          </div>
        ) : (
          <div className="divide-y divide-border">
            {groupedUnmatched.slice(0, 50).map(group => (
              <UnmatchedLineRow
                key={group.name}
                group={group}
                products={products}
                onLink={handleManualLink}
              />
            ))}
            {groupedUnmatched.length > 50 && (
              <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                Showing 50 of {groupedUnmatched.length} — use search to find specific items
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
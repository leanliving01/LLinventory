import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function ParLevelsTab() {
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 100),
  });

  const { data: parLevels = [] } = useQuery({
    queryKey: ['parLevels'],
    queryFn: () => base44.entities.ParLevel.list('-created_date', 100),
  });

  const parBySkuId = useMemo(() => {
    const map = {};
    parLevels.forEach(p => { map[p.sku_id] = p; });
    return map;
  }, [parLevels]);

  const filtered = useMemo(() => {
    return skus
      .filter(s => s.is_active !== false)
      .filter(s => filterType === 'all' || s.package_type === filterType)
      .filter(s => !search || s.meal_name?.toLowerCase().includes(search.toLowerCase()) || s.sku_code?.toLowerCase().includes(search.toLowerCase()));
  }, [skus, filterType, search]);

  const handleSave = async () => {
    const entries = Object.entries(edits).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) return;

    setSaving(true);
    const today = format(new Date(), 'yyyy-MM-dd');

    for (const [skuId, value] of entries) {
      const existing = parBySkuId[skuId];
      const sku = skus.find(s => s.id === skuId);
      if (existing) {
        await base44.entities.ParLevel.update(existing.id, { par_level: Number(value) });
      } else {
        await base44.entities.ParLevel.create({
          sku_id: skuId,
          sku_display_name: sku?.display_name || '',
          package_type: sku?.package_type || '',
          par_level: Number(value),
          effective_from: today,
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: ['parLevels'] });
    setEdits({});
    toast.success(`Updated par levels for ${entries.length} SKUs`);
    setSaving(false);
  };

  const packageTypes = ['all', 'MWL', 'MLM', 'WWL', 'WLM', 'LOW_CARB'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {packageTypes.map(type => (
            <Button key={type} variant={filterType === type ? 'default' : 'outline'} size="sm" onClick={() => setFilterType(type)} className="text-xs">
              {type === 'all' ? 'All' : type}
            </Button>
          ))}
        </div>
        <Button onClick={handleSave} disabled={saving || Object.keys(edits).length === 0} size="sm" className="gap-2">
          <Save className="w-3.5 h-3.5" />
          Save ({Object.values(edits).filter(v => v !== '' && v !== undefined).length})
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meal</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Current Par</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase w-36">New Par</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(sku => {
              const par = parBySkuId[sku.id];
              return (
                <tr key={sku.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{sku.sku_code}</td>
                  <td className="px-4 py-2.5 text-sm font-medium">{sku.meal_name}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px]">{sku.package_type}</Badge></td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums">
                    {par ? par.par_level : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Input
                      type="number"
                      min="0"
                      placeholder={par ? String(par.par_level) : 'Set...'}
                      value={edits[sku.id] ?? ''}
                      onChange={e => setEdits(prev => ({ ...prev, [sku.id]: e.target.value }))}
                      className="w-28 ml-auto text-right h-7 text-sm"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
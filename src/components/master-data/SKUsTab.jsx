import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

export default function SKUsTab() {
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 100),
  });

  const filtered = useMemo(() => {
    return skus
      .filter(s => filterType === 'all' || s.package_type === filterType)
      .filter(s => !search || s.meal_name?.toLowerCase().includes(search.toLowerCase()) || s.sku_code?.toLowerCase().includes(search.toLowerCase()));
  }, [skus, filterType, search]);

  const packageTypes = ['all', 'MWL', 'MLM', 'WWL', 'WLM', 'LOW_CARB'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search SKUs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {packageTypes.map(type => (
            <Button key={type} variant={filterType === type ? 'default' : 'outline'} size="sm" onClick={() => setFilterType(type)} className="text-xs">
              {type === 'all' ? 'All' : type}
            </Button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meal</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Package Type</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Portion (g)</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(sku => (
              <tr key={sku.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{sku.sku_code}</td>
                <td className="px-4 py-2.5 text-sm font-medium">{sku.meal_name}</td>
                <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px]">{sku.package_type}</Badge></td>
                <td className="px-4 py-2.5 text-right text-sm tabular-nums">{sku.portion_size_grams}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-1 rounded-full ${sku.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {sku.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          Showing {filtered.length} of {skus.length} SKUs
        </div>
      </div>
    </div>
  );
}
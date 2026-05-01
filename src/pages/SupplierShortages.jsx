import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import ShortageCard from '@/components/shortages/ShortageCard';
import ShortageDrawer from '@/components/shortages/ShortageDrawer';
import PageHelp from '@/components/help/PageHelp';

const HELP_ITEMS = [
  { title: 'What are shortages?', text: 'When a GRN is confirmed and the received quantity is less than expected, the system automatically creates a shortage record for the difference.' },
  { title: 'Resolve a shortage', text: 'Click on an open shortage and choose a resolution: Follow-up Delivery (supplier will send the rest), Credit Received (supplier issued a credit note), or Write Off (absorb the loss).' },
  { title: 'Track by supplier', text: 'Use the search to filter by supplier or product name to identify repeat offenders.' },
];

const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'all_resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

export default function SupplierShortages() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const { data: shortages = [], isLoading } = useQuery({
    queryKey: ['supplier-shortages'],
    queryFn: () => base44.entities.SupplierShortage.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return shortages.filter(s => {
      if (statusTab === 'open' && s.status !== 'open') return false;
      if (statusTab === 'all_resolved' && s.status === 'open') return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(s.product_name || '').toLowerCase().includes(q) &&
            !(s.product_sku || '').toLowerCase().includes(q) &&
            !(s.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [shortages, statusTab, search]);

  const openCount = shortages.filter(s => s.status === 'open').length;
  const resolvedCount = shortages.filter(s => s.status !== 'open').length;
  const totalOpenValue = shortages
    .filter(s => s.status === 'open')
    .reduce((sum, s) => sum + (s.shortage_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" /> Supplier Shortages
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track and resolve under-deliveries from suppliers
          </p>
        </div>
        {totalOpenValue > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-right">
            <p className="text-[10px] text-amber-600 uppercase font-semibold">Open Shortage Value</p>
            <p className="text-lg font-bold text-amber-700">R {totalOpenValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
          </div>
        )}
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Status tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusTab(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusTab === tab.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label} ({tab.key === 'open' ? openCount : tab.key === 'all_resolved' ? resolvedCount : shortages.length})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search product or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {shortages.length === 0 ? 'No shortages recorded yet.' : 'No shortages match your filter.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.slice(0, 15).map(s => (
            <ShortageCard key={s.id} shortage={s} onClick={setSelected} />
          ))}
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing 15 of {filtered.length} — use search to narrow
            </p>
          )}
        </div>
      )}

      {selected && (
        <ShortageDrawer
          shortage={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] })}
          canResolve={perms.returns_process}
        />
      )}
    </div>
  );
}
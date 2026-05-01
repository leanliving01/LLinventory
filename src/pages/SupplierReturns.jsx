import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RotateCcw, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import ReturnCard from '@/components/returns/ReturnCard';
import CreateReturnModal from '@/components/returns/CreateReturnModal';
import ReturnDrawer from '@/components/returns/ReturnDrawer';
import PageHelp from '@/components/help/PageHelp';

const HELP_ITEMS = [
  { title: 'Create a return', text: 'Click "New Return" to start. Select a supplier, choose a confirmed GRN, then pick the lines you want to return with quantities and reasons.' },
  { title: 'Process the return', text: 'Open a pending return and click "Mark as Returned". This deducts the returned items from stock (creates stock OUT movements).' },
  { title: 'Record credit note', text: 'Once the supplier issues a credit, open the returned record and enter the credit note number to mark it as resolved.' },
];

const STATUS_TABS = [
  { key: 'pending_return', label: 'Pending' },
  { key: 'returned', label: 'Returned' },
  { key: 'credit_received', label: 'Credit Received' },
  { key: 'all', label: 'All' },
];

export default function SupplierReturns() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('pending_return');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['supplier-returns'],
    queryFn: () => base44.entities.SupplierReturn.list('-created_date', 200),
  });

  const filtered = useMemo(() => {
    return returns.filter(r => {
      if (statusTab !== 'all' && r.status !== statusTab) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(r.return_number || '').toLowerCase().includes(q) &&
            !(r.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [returns, statusTab, search]);

  const statusCounts = useMemo(() => {
    const c = { all: returns.length };
    returns.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [returns]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-red-600" /> Supplier Returns
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage product returns and credit notes
          </p>
        </div>
        {perms.returns_process && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> New Return
          </Button>
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
            {tab.label} ({statusCounts[tab.key] || 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search return number or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
          {returns.length === 0 ? 'No returns yet.' : 'No returns match your filter.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.slice(0, 15).map(r => (
            <ReturnCard key={r.id} ret={r} onClick={setSelected} />
          ))}
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing 15 of {filtered.length}
            </p>
          )}
        </div>
      )}

      {showCreate && (
        <CreateReturnModal
          onCreated={(newRet) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
            if (newRet) setSelected(newRet);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selected && (
        <ReturnDrawer
          ret={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
            base44.entities.SupplierReturn.filter({ id: selected.id }).then(res => {
              if (res[0]) setSelected(res[0]); else setSelected(null);
            });
          }}
          canProcess={perms.returns_process}
        />
      )}
    </div>
  );
}
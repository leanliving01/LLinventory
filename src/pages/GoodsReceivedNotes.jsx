import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PackageCheck, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import GRNCard from '@/components/grn/GRNCard';
import CreateGRNModal from '@/components/grn/CreateGRNModal';
import GRNDrawer from '@/components/grn/GRNDrawer';
import PageHelp from '@/components/help/PageHelp';

const HELP_ITEMS = [
  { title: 'Create a GRN', text: 'Click "New GRN" to start. Select supplier and receiving location. Optionally link to an existing PO to pre-populate expected lines.' },
  { title: 'Blind receipt', text: 'If no PO exists yet (e.g. supplier delivered without a formal order), leave the PO field blank. Add products manually from the supplier catalog.' },
  { title: 'Enter quantities', text: 'Open a draft GRN and click "Edit Quantities". Enter actual received qty for each line. The system auto-calculates internal stock qty using the conversion factor and yield.' },
  { title: 'Flag issues', text: 'Set line condition to "Damaged" or "Rejected" for problem items. Rejected items are excluded from stock movements.' },
  { title: 'Confirm receipt', text: 'Click "Confirm Receipt" to finalise. This creates stock movements, updates on-hand quantities, recalculates weighted average costs, and logs shortages for any under-deliveries.' },
];

const STATUS_TABS = [
  { key: 'draft', label: 'Draft' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'all', label: 'All' },
];

export default function GoodsReceivedNotes() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('draft');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState(null);

  const { data: grns = [], isLoading } = useQuery({
    queryKey: ['grns-list'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-created_date', 200),
  });

  const filtered = useMemo(() => {
    return grns.filter(g => {
      if (statusTab !== 'all' && g.status !== statusTab) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(g.grn_number || '').toLowerCase().includes(q) &&
            !(g.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [grns, statusTab, search]);

  const statusCounts = useMemo(() => {
    const c = { all: grns.length };
    grns.forEach(g => { c[g.status] = (c[g.status] || 0) + 1; });
    return c;
  }, [grns]);

  const handleGRNUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['grns-list'] });
    if (selectedGRN) {
      base44.entities.GoodsReceivedNote.filter({ id: selectedGRN.id }).then(res => {
        if (res[0]) setSelectedGRN(res[0]); else setSelectedGRN(null);
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-primary" /> Goods Received
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Record and confirm supplier deliveries
          </p>
        </div>
        {perms.grn_create && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> New GRN
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
          <Input placeholder="Search GRN number or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
          {grns.length === 0 ? 'No GRNs yet. Click "New GRN" to record a delivery.' : 'No GRNs match your filter.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.slice(0, 15).map(grn => (
            <GRNCard key={grn.id} grn={grn} onClick={setSelectedGRN} />
          ))}
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing 15 of {filtered.length} — use search to narrow
            </p>
          )}
        </div>
      )}

      {showCreate && (
        <CreateGRNModal
          onCreated={(newGRN) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['grns-list'] });
            if (newGRN) setSelectedGRN(newGRN);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selectedGRN && (
        <GRNDrawer
          grn={selectedGRN}
          onClose={() => setSelectedGRN(null)}
          onUpdated={handleGRNUpdated}
        />
      )}
    </div>
  );
}
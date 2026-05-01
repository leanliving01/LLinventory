import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CookingPot, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import CookingRunCard from '@/components/cooking/CookingRunCard';
import CreateCookingRunModal from '@/components/cooking/CreateCookingRunModal';
import CookingRunDrawer from '@/components/cooking/CookingRunDrawer';

const STATUS_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export default function CookingRuns() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('active');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['cooking-runs'],
    queryFn: () => base44.entities.CookingRun.list('-created_date', 200),
  });

  const filtered = useMemo(() => {
    return runs.filter(r => {
      if (statusTab === 'active' && !['draft', 'in_progress'].includes(r.status)) return false;
      if (statusTab !== 'active' && statusTab !== 'all' && r.status !== statusTab) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(r.run_number || '').toLowerCase().includes(q) &&
            !(r.bulk_product_name || '').toLowerCase().includes(q) &&
            !(r.bulk_product_sku || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [runs, statusTab, search]);

  const statusCounts = useMemo(() => {
    const c = { active: 0 };
    runs.forEach(r => {
      c[r.status] = (c[r.status] || 0) + 1;
      if (['draft', 'in_progress'].includes(r.status)) c.active += 1;
    });
    return c;
  }, [runs]);

  const handleRunUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['cooking-runs'] });
    if (selectedRun) {
      base44.entities.CookingRun.filter({ id: selectedRun.id }).then(res => {
        if (res[0]) setSelectedRun(res[0]);
        else setSelectedRun(null);
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CookingPot className="w-6 h-6 text-primary" /> Cooking Runs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Bulk product cooking execution with yield tracking
          </p>
        </div>
        {perms.cooking_runs_create && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> New Cooking Run
          </Button>
        )}
      </div>

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
          <Input
            placeholder="Search runs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
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
          {runs.length === 0 ? 'No cooking runs yet. Click "New Cooking Run" to get started.' : 'No runs match your filter.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.slice(0, 15).map(run => (
            <CookingRunCard key={run.id} run={run} onClick={setSelectedRun} />
          ))}
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing 15 of {filtered.length} — use search or filters to narrow
            </p>
          )}
        </div>
      )}

      {showCreate && (
        <CreateCookingRunModal
          onCreated={(newRun) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['cooking-runs'] });
            if (newRun) setSelectedRun(newRun);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selectedRun && (
        <CookingRunDrawer
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          onUpdated={handleRunUpdated}
        />
      )}
    </div>
  );
}
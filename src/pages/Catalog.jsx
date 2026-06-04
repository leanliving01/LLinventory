import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Merge, ScanSearch, Plus, Archive, RotateCcw, Pencil, ChevronsDownUp, ChevronsUpDown, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import MergeProductsModal from '@/components/catalog/MergeProductsModal';
import DuplicateAuditModal from '@/components/catalog/DuplicateAuditModal';
import GroupedProductTable from '@/components/catalog/GroupedProductTable';
import ProductBulkEditModal from '@/components/catalog/ProductBulkEditModal';
import TypeDropChips from '@/components/catalog/TypeDropChips';
import TypeChangeConfirmDialog from '@/components/catalog/TypeChangeConfirmDialog';
import { SUBCATEGORIZED_TYPES, TYPE_LABELS, resolveSubcategory } from '@/lib/productClassification';
import { useSubcategories } from '@/lib/useSubcategories';
import { DragDropContext } from '@hello-pangea/dnd';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

export default function Catalog() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('raw');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sellableFilter, setSellableFilter] = useState('all');
  const [purchasableFilter, setPurchasableFilter] = useState('all');
  const [inventoryFilter, setInventoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name_asc');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('catalog_view_mode') || 'grouped');
  const [expanded, setExpanded] = useState({});
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [mergeSelection, setMergeSelection] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showDuplicateAudit, setShowDuplicateAudit] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredType, setHoveredType] = useState(null);
  const hoveredTypeRef = React.useRef(null);
  const [typeChangeRequest, setTypeChangeRequest] = useState(null); // { product, fromType, toType }
  const queryClient = useQueryClient();
  const { getSubcategoriesForType } = useSubcategories();

  React.useEffect(() => { hoveredTypeRef.current = hoveredType; }, [hoveredType]);
  useEffect(() => { localStorage.setItem('catalog_view_mode', viewMode); }, [viewMode]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['catalog-products'],
    queryFn: () => base44.entities.Product.list('-created_date', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
    staleTime: 60_000,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-list'],
    queryFn: () => base44.entities.Location.list('name', 500),
    staleTime: 300_000,
  });

  const sohMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      map[s.product_id] = (map[s.product_id] || 0) + (s.qty_on_hand || 0);
    });
    return map;
  }, [stockRecords]);

  const locationMap = useMemo(() => {
    const m = {};
    locations.forEach(l => { m[l.id] = l.name; });
    return m;
  }, [locations]);

  // Subcategory reclassify (within same type)
  const handleProductReclassify = async (productId, fromCategory, toCategory) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const updateData = {};
    if (product.type === 'raw') {
      updateData.pick_category = toCategory;
    } else {
      updateData.subcategory = toCategory;
    }

    await base44.entities.Product.update(productId, updateData);
    queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
    toast.success(`Moved "${product.name}" from "${fromCategory}" → "${toCategory}"`);
  };

  const handleDragStart = () => setIsDragging(true);

  const handleDragEnd = (result) => {
    const typeOnDrop = hoveredTypeRef.current;
    setIsDragging(false);
    setHoveredType(null);

    const { draggableId, source, destination } = result;
    const productId = draggableId;

    // Priority 1: dropped over a type chip (manual hover detection)
    if (typeOnDrop) {
      const product = products.find(p => p.id === productId);
      if (!product || product.type === typeOnDrop) return;
      setTypeChangeRequest({ product, fromType: product.type, toType: typeOnDrop });
      return;
    }

    // Priority 2: standard dnd destination (subcategory droppables)
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;
    handleProductReclassify(productId, source.droppableId, destination.droppableId);
  };

  const handleTypeChangeConfirmed = async (manager) => {
    if (!typeChangeRequest) return;
    const { product, toType } = typeChangeRequest;

    await base44.entities.Product.update(product.id, {
      type: toType,
      subcategory: '', // Clear override so auto-detect runs for new type
    });

    queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
    toast.success(`"${product.name}" moved to ${TYPE_LABELS[toType] || toType} (approved by ${manager.manager_name})`);
    setTypeChangeRequest(null);
  };

  const handleBulkStatusChange = async (newStatus) => {
    for (const id of mergeSelection) {
      await base44.entities.Product.update(id, { status: newStatus });
    }
    queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
    toast.success(`${mergeSelection.length} product${mergeSelection.length > 1 ? 's' : ''} ${newStatus === 'archived' ? 'archived' : 'activated'}`);
    setMergeSelection([]);
  };

  const filtered = useMemo(() => {
    const list = products.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (sellableFilter !== 'all') {
        const isSellable = p.sellable === true;
        if (sellableFilter === 'yes' && !isSellable) return false;
        if (sellableFilter === 'no' && isSellable) return false;
      }
      if (purchasableFilter !== 'all') {
        const isPurchasable = p.purchasable !== false;
        if (purchasableFilter === 'yes' && !isPurchasable) return false;
        if (purchasableFilter === 'no' && isPurchasable) return false;
      }
      if (inventoryFilter !== 'all') {
        const isTracked = p.inventory_tracked !== false;
        if (inventoryFilter === 'yes' && !isTracked) return false;
        if (inventoryFilter === 'no' && isTracked) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (p.sku || '').toLowerCase().includes(s) ||
               (p.name || '').toLowerCase().includes(s) ||
               (p.barcode || '').toLowerCase().includes(s);
      }
      return true;
    });
    switch (sortBy) {
      case 'name_desc':
        list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        break;
      case 'date_desc':
        list.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
        break;
      case 'date_asc':
        list.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
        break;
      case 'sku_asc':
        list.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
        break;
      case 'name_asc':
      default:
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
    }
    return list;
  }, [products, search, typeFilter, statusFilter, sellableFilter, purchasableFilter, inventoryFilter, sortBy]);

  // Count by type
  const typeCounts = useMemo(() => {
    const counts = {};
    products.filter(p => statusFilter === 'all' || p.status === statusFilter).forEach(p => {
      counts[p.type] = (counts[p.type] || 0) + 1;
    });
    return counts;
  }, [products, statusFilter]);

  // Visible subcategory group names (drives Expand/Collapse All)
  const groupNames = useMemo(() => {
    const set = new Set();
    filtered.forEach(p => set.add(resolveSubcategory(p) || 'Other'));
    return [...set];
  }, [filtered]);

  // Group toggle — also handles the table's "__expand_all__" auto-expand signal
  const handleToggle = (name, expandList) => {
    if (name === '__expand_all__' && Array.isArray(expandList)) {
      setExpanded(prev => {
        const next = { ...prev };
        expandList.forEach(n => { next[n] = true; });
        return next;
      });
      return;
    }
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const setAllExpanded = (open) => {
    setExpanded(prev => {
      const next = { ...prev };
      groupNames.forEach(g => { next[g] = open; });
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => mergeSelection.includes(p.id));
  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const ids = new Set(filtered.map(p => p.id));
      setMergeSelection(prev => prev.filter(id => !ids.has(id)));
    } else {
      setMergeSelection(prev => [...new Set([...prev, ...filtered.map(p => p.id)])]);
    }
  };

  const dndActive = perms.catalog_edit && viewMode === 'grouped' && SUBCATEGORIZED_TYPES.includes(typeFilter);

  const content = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {products.length} products
            {mergeSelection.length > 0 && ` · ${mergeSelection.length} selected`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {perms.catalog_edit && mergeSelection.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowBulkEdit(true)} className="gap-1.5">
                <Pencil className="w-3.5 h-3.5" />
                Bulk Edit ({mergeSelection.length})
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkStatusChange('archived')} className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50">
                <Archive className="w-3.5 h-3.5" />
                Archive ({mergeSelection.length})
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkStatusChange('active')} className="gap-1.5 text-emerald-600 border-emerald-300 hover:bg-emerald-50">
                <RotateCcw className="w-3.5 h-3.5" />
                Activate ({mergeSelection.length})
              </Button>
            </>
          )}
          {perms.catalog_edit && mergeSelection.length >= 2 && (
            <Button variant="outline" size="sm" onClick={() => setShowMergeModal(true)} className="gap-1.5">
              <Merge className="w-3.5 h-3.5" />
              Merge ({mergeSelection.length})
            </Button>
          )}
          {perms.catalog_edit && (
            <Button variant="outline" onClick={() => setShowDuplicateAudit(true)} className="gap-2">
              <ScanSearch className="w-4 h-4" />
              Scan Duplicates
            </Button>
          )}
          {perms.catalog_edit && (
            <Button onClick={() => navigate('/catalog/new')} className="gap-2">
              <Plus className="w-4 h-4" />
              New Product
            </Button>
          )}
        </div>
      </div>

      <SyncStatusBanner syncKeys={['shopify_products']} />

      {/* Category summary chips — mouse-hover drop targets during drag */}
      <TypeDropChips
        typeCounts={typeCounts}
        currentTypeFilter={typeFilter}
        isDragging={isDragging}
        hoveredType={hoveredType}
        setHoveredType={setHoveredType}
        onTypeClick={(type) => { setTypeFilter(typeFilter === type ? 'all' : type); }}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU, name, or barcode..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sellableFilter} onValueChange={setSellableFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sellable</SelectItem>
            <SelectItem value="yes">Sellable</SelectItem>
            <SelectItem value="no">Not Sellable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={purchasableFilter} onValueChange={setPurchasableFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Purchasable</SelectItem>
            <SelectItem value="yes">Purchasable</SelectItem>
            <SelectItem value="no">Not Purchasable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={inventoryFilter} onValueChange={setInventoryFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Inventory</SelectItem>
            <SelectItem value="yes">Tracked</SelectItem>
            <SelectItem value="no">Not Tracked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc">Name (A-Z)</SelectItem>
            <SelectItem value="name_desc">Name (Z-A)</SelectItem>
            <SelectItem value="date_desc">Date (newest)</SelectItem>
            <SelectItem value="date_asc">Date (oldest)</SelectItem>
            <SelectItem value="sku_asc">SKU (A-Z)</SelectItem>
          </SelectContent>
        </Select>
        {(search || typeFilter !== 'all' || statusFilter !== 'active' || sellableFilter !== 'all' || purchasableFilter !== 'all' || inventoryFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setTypeFilter('all'); setStatusFilter('active'); setSellableFilter('all'); setPurchasableFilter('all'); setInventoryFilter('all'); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* View controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={viewMode} onValueChange={setViewMode}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="grouped">Grouped (collapsible)</SelectItem>
            <SelectItem value="flat">Flat grouped</SelectItem>
          </SelectContent>
        </Select>
        {viewMode === 'grouped' && (
          <>
            <Button variant="outline" size="sm" onClick={() => setAllExpanded(true)} className="gap-1.5">
              <ChevronsUpDown className="w-3.5 h-3.5" /> Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAllExpanded(false)} className="gap-1.5">
              <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse All
            </Button>
          </>
        )}
        {perms.catalog_edit && (
          <Button variant="outline" size="sm" onClick={toggleSelectAllFiltered} className="gap-1.5">
            <CheckSquare className="w-3.5 h-3.5" />
            {allFilteredSelected ? 'Deselect all' : `Select all ${filtered.length}`}
          </Button>
        )}
        {mergeSelection.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMergeSelection([])} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear selection
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading catalog...</div>
      ) : (
        <GroupedProductTable
          products={filtered}
          type={typeFilter}
          viewMode={viewMode}
          expanded={expanded}
          onToggle={handleToggle}
          showCheckbox={perms.catalog_edit}
          mergeSelection={mergeSelection}
          setMergeSelection={setMergeSelection}
          onProductReclassify={dndActive ? handleProductReclassify : undefined}
          sohMap={sohMap}
          locationMap={locationMap}
          search={search}
          subcategoryOrder={typeFilter !== 'all' ? getSubcategoriesForType(typeFilter) : undefined}
        />
      )}

      {showBulkEdit && (
        <ProductBulkEditModal
          productIds={mergeSelection}
          products={products.filter(p => mergeSelection.includes(p.id))}
          locations={locations}
          onCancel={() => setShowBulkEdit(false)}
          onDone={() => {
            setShowBulkEdit(false);
            setMergeSelection([]);
            queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
          }}
        />
      )}

      {showMergeModal && (
        <MergeProductsModal
          products={products.filter(p => mergeSelection.includes(p.id))}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => {
            setShowMergeModal(false);
            setMergeSelection([]);
            queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
          }}
        />
      )}

      {showDuplicateAudit && (
        <DuplicateAuditModal
          onClose={() => setShowDuplicateAudit(false)}
          onMergesComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
          }}
        />
      )}

      {typeChangeRequest && (
        <TypeChangeConfirmDialog
          product={typeChangeRequest.product}
          fromType={typeChangeRequest.fromType}
          toType={typeChangeRequest.toType}
          onConfirm={handleTypeChangeConfirmed}
          onCancel={() => setTypeChangeRequest(null)}
        />
      )}
    </div>
  );

  // Only wrap in DragDropContext when reclassify drag is active (grouped + subcategorised)
  if (dndActive) {
    return (
      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {content}
      </DragDropContext>
    );
  }

  return content;
}

import { createClient } from '@supabase/supabase-js';

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// In development, route all Supabase requests through the Vite proxy (/__sb)
// so browser extensions that block *.supabase.co don't interfere.
// In production the real URL is used directly.
const SUPABASE_URL = import.meta.env.DEV
  ? `${window.location.origin}/__sb`
  : import.meta.env.VITE_SUPABASE_URL;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Abort any Supabase query that takes longer than 15 seconds so pages never
// hang on "loading" indefinitely when the project is cold-starting or the
// network is flaky. The error path in each method returns [] so the UI
// degrades gracefully instead of spinning forever.
function withTimeout(queryBuilder, ms = 60000) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve({ data: null, error: { message: `Query timed out after ${ms / 1000}s` } });
    }, ms);
    // Call .then() exactly once on the builder so only one HTTP request is made
    queryBuilder.abortSignal(controller.signal).then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err)    => { clearTimeout(timer); resolve({ data: null, error: err }); },
    );
  });
}

// Entity name → Supabase table name
const ENTITY_TABLE_MAP = {
  User:                     'users',
  Location:                 'locations',
  UnitOfMeasure:            'units_of_measure',
  ProductCategory:          'product_categories',
  ProductFamily:            'product_families',
  Supplier:                 'suppliers',
  Equipment:                'equipment',
  TeamMember:               'team_members',
  Customer:                 'customers',
  Setting:                  'settings',
  HelpGuide:                'help_guides',
  PackingMaterialRule:      'packing_material_rules',
  ProductSubcategory:       'product_subcategories',
  EquipmentCapacity:        'equipment_capacities',
  DispatchTeamMember:       'dispatch_team_members',
  Product:                  'products',
  Bom:                      'boms',
  SupplierProduct:          'supplier_products',
  ProductPurchaseUom:       'product_purchase_uoms',
  PackBom:                  'pack_boms',
  ParLevel:                 'par_levels',
  ParLevelRecommendation:   'par_level_recommendations',
  StockOnHand:              'stock_on_hand',
  StockSnapshot:            'stock_snapshots',
  BomComponent:             'bom_components',
  BomOperation:             'bom_operations',
  SupplierPriceHistory:     'supplier_price_histories',
  SupplierYieldRecord:      'supplier_yield_records',
  PurchaseOrder:            'purchase_orders',
  SalesOrder:               'sales_orders',
  GoodsReceivedNote:        'goods_received_notes',
  PurchaseOrderLine:        'purchase_order_lines',
  SalesOrderLine:           'sales_order_lines',
  GRNLine:                  'grn_lines',
  PurchaseInvoice:          'purchase_invoices',
  CommittedDemand:          'committed_demands',
  DecomposedLine:           'decomposed_lines',
  PurchaseInvoiceLine:      'purchase_invoice_lines',
  SupplierShortage:         'supplier_shortages',
  SupplierReturn:           'supplier_returns',
  SupplierReturnLine:       'supplier_return_lines',
  ProductionRun:            'production_runs',
  CookingRun:               'cooking_runs',
  ProductionRunLine:        'production_run_lines',
  PickList:                 'pick_lists',
  WipBatch:                 'wip_batches',
  PortioningRun:            'portioning_runs',
  ProductionTask:           'production_tasks',
  PickLine:                 'pick_lines',
  WipQualityCheck:          'wip_quality_checks',
  QualityCheckSession:      'quality_check_sessions',
  PortioningRunLine:        'portioning_run_lines',
  TaskConsumption:          'task_consumptions',
  ProductionTaskLog:        'production_task_logs',
  YieldRecord:              'yield_records',
  RestTimeOverrideLog:      'rest_time_override_logs',
  WipWriteOff:              'wip_write_offs',
  StockWriteOff:            'stock_write_offs',
  WastageLog:               'wastage_logs',
  ProductionWastageEvent:   'production_wastage_events',
  WastageLine:              'wastage_lines',
  StockMovement:            'stock_movements',
  NewStockTake:             'new_stock_takes',
  StockTakeLine:            'stock_take_lines',
  ShopifyOrder:             'shopify_orders',
  ShopifyOrderLine:         'shopify_order_lines',
  ShopifyWebhookEvent:      'shopify_webhook_events',
  HistoricalOrder:          'historical_orders',
  Meal:                     'meals',
  SKU:                      'skus',
  PackageProduct:           'package_products',
  PackageBOMLine:           'package_bom_lines',
  SyncState:                'sync_states',
  SyncLog:                  'sync_logs',
  CostLayer:                'cost_layers',
  UnmatchedSkuAlert:        'unmatched_sku_alerts',
  ReconciliationMismatch:   'reconciliation_mismatches',
  AuditLog:                 'audit_logs',
  ImportLog:                'import_logs',
  BugReport:                'bug_reports',
  TaxRate:                  'tax_rates',
  DocNumberSequence:        'doc_number_sequences',
  SupplierCreditNote:       'supplier_credit_notes',
  SupplierCreditNoteMatch:  'supplier_credit_note_matches',
  InvoicePOMatchSuggestion: 'invoice_po_match_suggestions',
};

function applyFilters(query, filters) {
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined) {
      query = query.is(key, null);
    } else if (Array.isArray(value)) {
      query = query.in(key, value);
    } else if (typeof value === 'object') {
      if (value.$lt  !== undefined) query = query.lt(key, value.$lt);
      if (value.$lte !== undefined) query = query.lte(key, value.$lte);
      if (value.$gt  !== undefined) query = query.gt(key, value.$gt);
      if (value.$gte !== undefined) query = query.gte(key, value.$gte);
      if (value.$ne  !== undefined) query = query.neq(key, value.$ne);
      if (value.$in  !== undefined) query = query.in(key, value.$in);
      if (value.$ilike !== undefined) query = query.ilike(key, `%${value.$ilike}%`);
    } else {
      query = query.eq(key, value);
    }
  }
  return query;
}

const STUB = {
  list:       async () => [],
  filter:     async () => [],
  get:        async () => null,
  create:     async (d) => d,
  update:     async (_id, d) => d,
  delete:     async () => {},
  bulkCreate: async () => [],
  bulkUpdate: async () => [],
  bulkDelete: async () => [],
  subscribe:  () => () => {}, // no-op unsubscribe
};

function createEntityProxy(entityName) {
  const table = ENTITY_TABLE_MAP[entityName];
  if (!table) return STUB;

  return {
    async list(sortField = '-created_date', limit = 1000) {
      const ascending = !sortField.startsWith('-');
      const field = sortField.replace(/^-/, '');
      const { data, error } = await withTimeout(
        supabase.from(table).select('*').order(field, { ascending }).limit(limit)
      );
      if (error) { console.error(`[supabase] ${table} list:`, error.message); return []; }
      return data || [];
    },

    async filter(filters = {}, sortField = '-created_date', limit = 1000) {
      const ascending = !sortField.startsWith('-');
      const field = sortField.replace(/^-/, '');
      let query = supabase.from(table).select('*');
      query = applyFilters(query, filters);
      const { data, error } = await withTimeout(query.order(field, { ascending }).limit(limit));
      if (error) { console.error(`[supabase] ${table} filter:`, error.message); return []; }
      return data || [];
    },

    async get(id) {
      const { data, error } = await withTimeout(
        supabase.from(table).select('*').eq('id', id).maybeSingle()
      );
      if (error) { console.error(`[supabase] ${table} get:`, error.message); return null; }
      return data;
    },

    async create(record) {
      const now = new Date().toISOString();
      const row = { id: crypto.randomUUID(), ...record, created_date: record.created_date || now, updated_date: now };
      const { data, error } = await supabase.from(table).insert(row).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async update(id, updates) {
      const row = { ...updates, updated_date: new Date().toISOString() };
      const { data, error } = await supabase
        .from(table).update(row).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async bulkCreate(records) {
      const now = new Date().toISOString();
      const rows = records.map(r => ({ id: crypto.randomUUID(), ...r, created_date: r.created_date || now, updated_date: now }));
      const { data, error } = await supabase.from(table).insert(rows).select();
      if (error) throw new Error(error.message);
      return data || [];
    },

    async bulkUpdate(records) {
      const now = new Date().toISOString();
      const rows = records.map(r => ({ ...r, updated_date: now }));
      const { data, error } = await supabase
        .from(table).upsert(rows, { onConflict: 'id' }).select();
      if (error) throw new Error(error.message);
      return data || [];
    },

    async bulkDelete(ids) {
      const { error } = await supabase.from(table).delete().in('id', ids);
      if (error) throw new Error(error.message);
    },

    // Real-time subscriptions — returns unsubscribe fn (Supabase channels can be added later)
    subscribe: (callback) => {
      const channel = supabase
        .channel(`${table}-changes`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, callback)
        .subscribe();
      return () => supabase.removeChannel(channel);
    },
  };
}

const entitiesProxy = new Proxy({}, {
  get(_, entityName) { return createEntityProxy(entityName); }
});

// Atomic SOH adjustment — replaces all client-side read-modify-write SOH mutations.
// delta > 0 = add (GRN, production output), delta < 0 = remove (pick, write-off, return).
// newCostAvg: pass the incoming unit cost when adding stock; omit when deducting.
export async function adjustStockOnHand(productId, locationId, delta, newCostAvg = null) {
  const { data, error } = await supabase.rpc('adjust_stock_on_hand', {
    p_product_id:   productId,
    p_location_id:  locationId,
    p_delta:        delta,
    p_new_cost_avg: newCostAvg,
  });
  if (error) throw new Error(error.message);
  return data;
}

export const base44 = {
  entities: entitiesProxy,

  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${fileName}`;
        
        const { data, error } = await supabase.storage
          .from('recipe-files')
          .upload(filePath, file);
          
        if (error) {
          console.error('[supabase] Upload error:', error.message);
          throw new Error(error.message);
        }
        
        const { data: { publicUrl } } = supabase.storage
          .from('recipe-files')
          .getPublicUrl(filePath);
          
        return { file_url: publicUrl };
      }
    }
  },

  // Server-side functions — routes to Supabase Edge Functions where implemented
  functions: {
    invoke: async (fnName, payload) => {
      const EDGE_FUNCTIONS = {
        xeroAuth:                    'xero-auth',
        syncXeroInvoices:            'sync-xero-invoices',
        syncXeroPurchaseOrders:      'sync-xero-purchase-orders',
        reconcileShopify:            'reconcile-shopify',
        costRollup:                  'cost-rollup',
        syncShopifyProducts:         'sync-shopify-products',
        syncHistoricalOrders:        'sync-historical-orders',
        calculateParRecommendations: 'calculate-par-recs',
        autoLinkPOLines:             'auto-link-po-lines',
        aiResolvePOMatches:          'ai-resolve-po-matches',
        cin7Import:                  'cin7-import',
        cin7BomImport:               'cin7-bom-import',
        bulkSyncOrders:              'sync-shopify-orders',
        recalcCommittedDemand:       'recalc-demand',
        'recalc-demand':             'recalc-demand',
        'recalc-committed-stock':    'recalc-committed-stock',
        bulkSyncCustomers:           'sync-shopify-customers',
      };
      const edgeFn = EDGE_FUNCTIONS[fnName];
      if (edgeFn) {
        const { data, error } = await supabase.functions.invoke(edgeFn, { body: payload });
        if (error) return { data: { error: error.message } };
        return { data };
      }
      console.warn(`[supabase] base44.functions.invoke('${fnName}') not yet implemented as Edge Function`);
      return { data: { status: 'not_implemented', fn: fnName } };
    },
  },

  auth: {
    me: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw { status: 401 };
      return { email: user.email, id: user.id, role: 'admin' };
    },
    updateMe: async (updates) => {
      console.warn('[supabase] auth.updateMe not yet implemented');
    },
    logout: async (redirectUrl) => {
      await supabase.auth.signOut();
      if (redirectUrl) window.location.href = redirectUrl;
    },
    redirectToLogin: (returnUrl) => {
      window.location.href = `/login${returnUrl ? `?next=${encodeURIComponent(returnUrl)}` : ''}`;
    },
  },
};

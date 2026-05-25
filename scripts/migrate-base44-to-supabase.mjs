/**
 * Base44 → Supabase Migration Script
 *
 * Setup:
 *   1. Copy .env.migration.example → .env.migration and fill in your keys
 *   2. Run: node scripts/migrate-base44-to-supabase.mjs
 *
 * To migrate a single entity only:
 *   node scripts/migrate-base44-to-supabase.mjs Product
 */

import { createClient as createBase44Client } from '@base44/sdk';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── load .env.migration ─────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envFile = join(__dir, '..', '.env.migration');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}

const {
  BASE44_APP_ID,
  BASE44_APP_BASE_URL,
  BASE44_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!BASE44_APP_ID || !BASE44_APP_BASE_URL || !BASE44_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\nMissing required env vars. Create LLinventory/.env.migration:\n');
  console.error('  BASE44_APP_ID=your_app_id');
  console.error('  BASE44_APP_BASE_URL=https://your-app.base44.app');
  console.error('  BASE44_TOKEN=your_access_token');
  console.error('  SUPABASE_URL=https://xxxx.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key\n');
  process.exit(1);
}

// ─── clients ─────────────────────────────────────────────────────────────────
// In Node.js there's no browser origin, so we derive serverUrl from appBaseUrl
const serverUrl = new URL(BASE44_APP_BASE_URL).origin;

const base44 = createBase44Client({
  appId: BASE44_APP_ID,
  token: BASE44_TOKEN,
  requiresAuth: false,
  serverUrl,
  appBaseUrl: BASE44_APP_BASE_URL,
});

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── migration order: parents before children ────────────────────────────────
const ENTITIES = [
  // Tier 1 — no FK dependencies
  { entity: 'Location',               table: 'locations' },
  { entity: 'UnitOfMeasure',          table: 'units_of_measure' },
  { entity: 'ProductCategory',        table: 'product_categories' },
  { entity: 'ProductFamily',          table: 'product_families' },
  { entity: 'Supplier',               table: 'suppliers' },
  { entity: 'Equipment',              table: 'equipment' },
  { entity: 'TeamMember',             table: 'team_members' },
  { entity: 'Customer',               table: 'customers' },
  { entity: 'Setting',                table: 'settings' },
  { entity: 'HelpGuide',              table: 'help_guides' },
  { entity: 'PackingMaterialRule',    table: 'packing_material_rules' },

  // Tier 2 — depends on tier 1
  { entity: 'ProductSubcategory',     table: 'product_subcategories' },
  { entity: 'EquipmentCapacity',      table: 'equipment_capacities' },
  { entity: 'DispatchTeamMember',     table: 'dispatch_team_members' },

  // Tier 3 — products
  { entity: 'Product',                table: 'products' },

  // Tier 4 — depend on products
  { entity: 'Bom',                    table: 'boms' },
  { entity: 'SupplierProduct',        table: 'supplier_products' },
  { entity: 'ProductPurchaseUom',     table: 'product_purchase_uoms' },
  { entity: 'PackBom',                table: 'pack_boms' },
  { entity: 'ParLevel',               table: 'par_levels' },
  { entity: 'ParLevelRecommendation', table: 'par_level_recommendations' },
  { entity: 'StockOnHand',            table: 'stock_on_hand' },
  { entity: 'StockSnapshot',          table: 'stock_snapshots' },

  // Tier 5 — BOM children + supplier history
  { entity: 'BomComponent',           table: 'bom_components' },
  { entity: 'BomOperation',           table: 'bom_operations' },
  { entity: 'SupplierPriceHistory',   table: 'supplier_price_histories' },
  { entity: 'SupplierYieldRecord',    table: 'supplier_yield_records' },

  // Tier 6 — orders (header)
  { entity: 'PurchaseOrder',          table: 'purchase_orders' },
  { entity: 'SalesOrder',             table: 'sales_orders' },
  { entity: 'GoodsReceivedNote',      table: 'goods_received_notes' },

  // Tier 7 — order lines
  { entity: 'PurchaseOrderLine',      table: 'purchase_order_lines' },
  { entity: 'SalesOrderLine',         table: 'sales_order_lines' },
  { entity: 'GRNLine',                table: 'grn_lines' },
  { entity: 'PurchaseInvoice',        table: 'purchase_invoices' },
  { entity: 'CommittedDemand',        table: 'committed_demands' },
  { entity: 'DecomposedLine',         table: 'decomposed_lines' },

  // Tier 8 — invoice lines + supplier transactions
  { entity: 'PurchaseInvoiceLine',    table: 'purchase_invoice_lines' },
  { entity: 'SupplierShortage',       table: 'supplier_shortages' },
  { entity: 'SupplierReturn',         table: 'supplier_returns' },
  { entity: 'SupplierReturnLine',     table: 'supplier_return_lines' },

  // Tier 9 — production
  { entity: 'ProductionRun',          table: 'production_runs' },
  { entity: 'CookingRun',             table: 'cooking_runs' },
  { entity: 'ProductionRunLine',      table: 'production_run_lines' },
  { entity: 'PickList',               table: 'pick_lists' },
  { entity: 'WipBatch',               table: 'wip_batches' },
  { entity: 'PortioningRun',          table: 'portioning_runs' },

  // Tier 10 — production tasks + picks
  { entity: 'ProductionTask',         table: 'production_tasks' },
  { entity: 'PickLine',               table: 'pick_lines' },
  { entity: 'WipQualityCheck',        table: 'wip_quality_checks' },
  { entity: 'QualityCheckSession',    table: 'quality_check_sessions' },
  { entity: 'PortioningRunLine',      table: 'portioning_run_lines' },

  // Tier 11 — task-level
  { entity: 'TaskConsumption',        table: 'task_consumptions' },
  { entity: 'ProductionTaskLog',      table: 'production_task_logs' },
  { entity: 'YieldRecord',            table: 'yield_records' },
  { entity: 'RestTimeOverrideLog',    table: 'rest_time_override_logs' },

  // Tier 12 — write-offs & wastage
  { entity: 'WipWriteOff',            table: 'wip_write_offs' },
  { entity: 'StockWriteOff',          table: 'stock_write_offs' },
  { entity: 'WastageLog',             table: 'wastage_logs' },
  { entity: 'ProductionWastageEvent', table: 'production_wastage_events' },
  { entity: 'WastageLine',            table: 'wastage_lines' },

  // Tier 13 — stock movements & takes
  { entity: 'StockMovement',          table: 'stock_movements' },
  { entity: 'NewStockTake',           table: 'new_stock_takes' },
  { entity: 'StockTakeLine',          table: 'stock_take_lines' },

  // Shopify / legacy
  { entity: 'ShopifyOrder',           table: 'shopify_orders' },
  { entity: 'ShopifyOrderLine',       table: 'shopify_order_lines' },
  { entity: 'ShopifyWebhookEvent',    table: 'shopify_webhook_events' },
  { entity: 'HistoricalOrder',        table: 'historical_orders' },
  { entity: 'Meal',                   table: 'meals' },
  { entity: 'SKU',                    table: 'skus' },
  { entity: 'PackageProduct',         table: 'package_products' },
  { entity: 'PackageBOMLine',         table: 'package_bom_lines' },

  // System / audit
  { entity: 'SyncState',              table: 'sync_states' },
  { entity: 'ReconciliationMismatch', table: 'reconciliation_mismatches' },
  { entity: 'AuditLog',              table: 'audit_logs' },
  { entity: 'ImportLog',              table: 'import_logs' },
  { entity: 'BugReport',              table: 'bug_reports' },
];

const FETCH_LIMIT = 5000;  // max records to fetch per entity per pass
const INSERT_BATCH = 500;  // rows per Supabase upsert call
const LOG_FILE = join(__dir, '..', 'migration.log');

// Cache of table → Set<columnName> built from PostgREST OpenAPI spec
const tableColumns = {};

async function loadAllColumns() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch Supabase schema: ${res.status} ${res.statusText}`);
  const spec = await res.json();
  for (const [defName, def] of Object.entries(spec.definitions ?? {})) {
    // PostgREST definition names map directly to table names
    tableColumns[defName] = new Set(Object.keys(def.properties ?? {}));
  }
}

async function getColumns(table) {
  if (Object.keys(tableColumns).length === 0) await loadAllColumns();
  if (!tableColumns[table]) throw new Error(`Table '${table}' not found in Supabase schema`);
  return tableColumns[table];
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

async function fetchAll(entityName) {
  const all = [];
  let cursor = null; // oldest created_date seen — used as pagination cursor

  for (let page = 0; page < 50; page++) { // max 50 pages = 250,000 records
    let batch;
    try {
      if (cursor) {
        batch = await base44.entities[entityName].filter(
          { created_date: { $lt: cursor } },
          '-created_date',
          FETCH_LIMIT
        );
      } else {
        batch = await base44.entities[entityName].list('-created_date', FETCH_LIMIT);
      }
    } catch (err) {
      throw new Error(`Base44 fetch error: ${err.message}`);
    }

    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < FETCH_LIMIT) break; // last page

    cursor = batch[batch.length - 1].created_date;
    log(`  Fetched ${all.length} ${entityName} so far, continuing...`);
  }

  return all;
}

async function upsertBatches(table, records) {
  const cols = await getColumns(table);
  // Only keep fields that exist as columns in Supabase — drops all Base44 internals
  // Also convert empty strings to null (Postgres rejects "" for timestamps/numbers)
  const cleaned = records.map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (!cols.has(k)) continue;
      out[k] = (v === '') ? null : v;
    }
    return out;
  });

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < cleaned.length; i += INSERT_BATCH) {
    const batch = cleaned.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    if (!error) {
      inserted += batch.length;
    } else {
      // Batch failed — try row by row to save good rows and log bad ones
      for (const row of batch) {
        const { error: rowErr } = await supabase.from(table).upsert(row, { onConflict: 'id' });
        if (!rowErr) {
          inserted++;
        } else {
          skipped++;
          log(`SKIP ${table} id=${row.id ?? '?'}: ${rowErr.message}`);
        }
      }
    }
    process.stdout.write(`  ${inserted + skipped}/${records.length} rows (${skipped} skipped)\r`);
  }
  if (skipped > 0) log(`WARNING: ${skipped} rows skipped in ${table} — check migration.log`);
  return inserted;
}

async function migrateOne({ entity, table }) {
  process.stdout.write(`\n${entity} → ${table} ... `);
  let records;
  try {
    records = await fetchAll(entity);
  } catch (err) {
    log(`ERROR fetching ${entity}: ${err.message}`);
    return { entity, table, count: 0, error: err.message };
  }

  if (records.length === 0) {
    process.stdout.write('(empty)\n');
    return { entity, table, count: 0 };
  }

  try {
    const count = await upsertBatches(table, records);
    process.stdout.write(`\n`);
    log(`OK ${table}: ${count} records`);
    return { entity, table, count };
  } catch (err) {
    process.stdout.write(`\n`);
    log(`ERROR inserting ${table}: ${err.message}`);
    return { entity, table, count: 0, error: err.message };
  }
}

async function main() {
  const targetEntity = process.argv[2]; // optional: single entity name OR "from:EntityName"
  let targets;
  if (!targetEntity) {
    targets = ENTITIES;
  } else if (targetEntity.startsWith('from:')) {
    const fromName = targetEntity.slice(5);
    const idx = ENTITIES.findIndex(e => e.entity === fromName);
    targets = idx === -1 ? ENTITIES : ENTITIES.slice(idx);
  } else {
    targets = ENTITIES.filter(e => e.entity === targetEntity);
  }

  if (targetEntity && targets.length === 0) {
    console.error(`Unknown entity: ${targetEntity}`);
    console.error(`Valid entities: ${ENTITIES.map(e => e.entity).join(', ')}`);
    process.exit(1);
  }

  log('=== Base44 → Supabase Migration Started ===');
  log(`Migrating ${targets.length} entities`);

  const results = [];
  for (const step of targets) {
    const result = await migrateOne(step);
    results.push(result);
  }

  // Summary
  const errors = results.filter(r => r.error);
  const total = results.reduce((s, r) => s + r.count, 0);

  console.log('\n\n=== Migration Summary ===');
  for (const r of results) {
    const icon = r.error ? '❌' : r.count === 0 ? '·' : '✓';
    const detail = r.error ? ` — ${r.error}` : ` (${r.count} rows)`;
    console.log(`  ${icon} ${r.table}${detail}`);
  }
  console.log(`\nTotal: ${total} rows across ${results.length} tables`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length} tables failed — check migration.log`);
  } else {
    console.log('All tables migrated successfully.');
  }

  log(`=== Migration Complete: ${total} rows, ${errors.length} errors ===`);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});

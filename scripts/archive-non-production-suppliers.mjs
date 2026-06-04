// One-off: archive (set status='inactive') every supplier that is NOT flagged
// as a production supplier. Production suppliers are left active. Reversible
// per-supplier by re-ticking "Production Supplier" in the app.
//
// Usage:
//   node scripts/archive-non-production-suppliers.mjs          # dry run (no writes)
//   node scripts/archive-non-production-suppliers.mjs --apply  # perform the update
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Load VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const APPLY = process.argv.includes('--apply');

const { data: suppliers, error } = await supabase
  .from('suppliers')
  .select('id, name, status, is_production_supplier');
if (error) { console.error('Query failed:', error.message); process.exit(1); }

const nonProd = suppliers.filter(s => s.is_production_supplier !== true);
const toArchive = nonProd.filter(s => s.status !== 'inactive');
const prodCount = suppliers.length - nonProd.length;

console.log(`Total suppliers:        ${suppliers.length}`);
console.log(`Production (kept active):${prodCount}`);
console.log(`Non-production:          ${nonProd.length}`);
console.log(`Will be archived now:    ${toArchive.length} (already-inactive skipped)`);

if (!APPLY) {
  console.log('\nDRY RUN — no changes written. Re-run with --apply to archive.');
  toArchive.slice(0, 20).forEach(s => console.log(`  - ${s.name} (${s.status} -> inactive)`));
  if (toArchive.length > 20) console.log(`  ...and ${toArchive.length - 20} more`);
  process.exit(0);
}

const ids = toArchive.map(s => s.id);
let archived = 0;
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100);
  const { error: upErr } = await supabase
    .from('suppliers')
    .update({ status: 'inactive', updated_date: new Date().toISOString() })
    .in('id', batch);
  if (upErr) { console.error('Update failed:', upErr.message); process.exit(1); }
  archived += batch.length;
}
console.log(`\nArchived ${archived} non-production suppliers.`);

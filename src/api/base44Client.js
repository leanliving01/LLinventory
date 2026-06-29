// Data layer swapped from Base44 → Supabase.
// All pages import { base44 } from here — no page code needs to change.
export { base44, supabase, adjustStockOnHand, repriceSupplierProduct } from './supabaseClient';

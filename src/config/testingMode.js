// Testing-phase feature flags.
//
// These are intentionally simple constants so the testing phase can be turned
// off in one place: flip the flag back to `false` and redeploy.
//
// HIDE_INVOICES — during the PO testing phase we are not working with purchase
// invoices. When true, the "Invoices (Xero)" entry is removed from the sidebar
// and the Invoices page renders a placeholder instead of the list. No invoice
// DATA is touched — it stays in the database, and the product / SKU review work
// lives in the Review Queue (not here), so nothing is lost. Flip to false to
// bring the Invoices section back exactly as it was.
export const HIDE_INVOICES = true;

-- 026_knowledge_base.sql
-- Livi assistant knowledge base: the maintained "system manual" Livi answers from.
-- Edit/insert rows here (or in the Table editor) and Livi reflects it instantly.
-- Idempotent. RLS disabled project-wide (022).

CREATE TABLE IF NOT EXISTS knowledge_base (
  id           text PRIMARY KEY,
  slug         text NOT NULL,
  category     text,
  title        text NOT NULL,
  content      text NOT NULL,             -- markdown
  sort_order   numeric NOT NULL DEFAULT 0,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by   text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_base_slug ON knowledge_base (slug);
ALTER TABLE knowledge_base DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_guard_timestamps ON knowledge_base;
CREATE TRIGGER trg_guard_timestamps BEFORE INSERT OR UPDATE ON knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.guard_row_timestamps();

-- ── Seed: v1 system manual ──────────────────────────────────────────────────
INSERT INTO knowledge_base (id, slug, category, title, content, sort_order) VALUES
('kb-overview', 'overview', 'General', 'What this system is', $md$
Lean Living runs a meal-prep + supplement business in South Africa. This app manages the whole operation: catalog & recipes, purchasing from suppliers, inventory/stock, production (cooking & portioning), and sales → packing → dispatch of customer orders (mostly from Shopify). Money is in South African Rand (ZAR), shown as "R 1,234.56".

The app is used on a management dashboard (web) and a floor app (tablets) for kitchen and packing staff. Access is controlled by roles & permissions — people only see what their role allows.
$md$, 1),

('kb-glossary', 'glossary', 'General', 'Glossary of terms', $md$
- **PO** — Purchase Order: a formal order placed with a supplier.
- **GRN** — Goods Received Note: the record of what was actually delivered against a PO (or a "blind" receipt with no PO).
- **Shortage** — when a delivery is short of what was ordered; tracked until resolved (more stock delivered, a credit note, or written off).
- **Credit note** — a supplier credit for returns or shortages, matched against POs/invoices.
- **Three-way match** — checking PO vs GRN vs Invoice agree before paying.
- **BOM** — Bill of Materials: a recipe (cook / portion / pack / prep type) listing inputs and outputs.
- **WIP** — Work In Progress: bulk-cooked product waiting to be portioned/packed.
- **Yield** — how much usable output you get from raw input (e.g. cooked kg from raw kg).
- **SOH** — Stock On Hand.
- **Par level** — the reorder threshold for a product/location.
- **Dispatch / packing** — preparing customer orders to ship.
- **Meal** vs **Supplement** — order items are classified by product type; meals are food, supplements are pills/powders/drinks.
$md$, 2),

('kb-purchasing', 'purchasing', 'Purchasing', 'Purchasing: PO → GRN → Invoice → Credit notes', $md$
Flow: create a **Purchase Order** (draft → approved) → receive goods on a **GRN** (links to the PO, or a "blind receipt" with no PO) → match the supplier **Invoice** (three-way match: PO vs GRN vs Invoice) → pay.

- **Shortages**: if a GRN is short, a shortage is recorded and stays open until resolved — either the remainder is delivered, a **credit note** is raised, or it's written off.
- **Returns & credit notes**: goods returned to a supplier get a credit note; one credit note can cover multiple shortages/returns across a supplier's POs, with per-item allocation and variance.
- **Price variance**: PO/invoice line prices are compared to expected; large changes are flagged.
- **Supplier scorecard**: each supplier is scored 0–100 = delivery 30% (on-time PO delivery) + quality 25% (GRN rejection/damage rate) + price stability 25% (large price changes) + shortage 20% (open shortages vs POs).
$md$, 10),

('kb-inventory', 'inventory', 'Inventory', 'Inventory, stock, par levels, wastage', $md$
- **Stock on hand** is tracked per product per location, with on-hand / committed / available quantities.
- **Stock movements** record every change with a reason (receipt, transfer, production consume/yield, sale fulfilment, wastage, write-off, stocktake adjustment).
- **Par levels** are reorder thresholds; items below par should be reordered (lead time matters).
- **Wastage vs write-off**: wastage = product spoiled/unusable during handling/production (logged by reason); write-off = a permanent stock loss event. Both reduce stock and carry a cost.
- **Stock takes** are periodic counts that adjust stock to reality.
$md$, 20),

('kb-production', 'production', 'Production', 'Production runs, tasks, cooking, WIP, yield', $md$
- A **Production Run** is a batch scheduled for a date (draft → scheduled → in_progress → completed), made up of run lines (one product each, planned vs actual qty).
- **Production tasks** are per-station jobs — **prep**, **cook**, **portion** — assigned to a team member, timed (started/finished, pauses excluded).
- **Cooking runs** turn raw material into bulk cooked output (**WIP**), tracking yield % and cost per cooked kg.
- **WIP batches** are the physical cooked stock (fresh / use-today / quarantine / written-off), with rest-time and expiry.
- **Yield records** track actual vs planned yield per task/batch; large variances are flagged for review.
- **BOMs** (cook/portion/pack/prep) define inputs→outputs and the step/station sequence.
$md$, 30),

('kb-packing', 'packing', 'Dispatch', 'Packing orders: split sections, Busy Packing, PIN, proof-of-pack', $md$
Customer orders are packed on the floor app. An order can contain **supplements** and **meals**, and these are packed as **two independent sections** (one order number — never duplicated):

- On opening an order that has **both**, the packer is asked "Supplements or Meals?"; single-type orders go straight in.
- Each section has its **own packer, timer and scan progress**. The supplements team (outside) and meals team (freezer) can pack the same order at the same time.
- Identity: a packer picks their name then enters their **4-digit Packing PIN** (set by a manager in Settings → Production Team) so nobody packs under someone else's name.
- **Timer** auto-starts when they enter a section and pauses (saving) when they leave. At Finish, they photograph the sealed, labelled box (**proof-of-pack**) — the timer stops then and the section completes.
- **Statuses**: an order is **"Busy Packing"** while in progress; **"Part-Packed"** when one section is done but not the other; **"Packed"** only once **every** section it contains is done.
- The proof photo is viewable by expanding the order on the Sales page (per section, with who packed it and when). Proof photos auto-delete after 45 days.
$md$, 40),

('kb-dispatch-kpis', 'dispatch-kpis', 'Dispatch', 'Dispatch performance KPIs & the performance % formula', $md$
Packing performance is measured per packer from completed packing events (each section a packer finishes), so supplements credit the supplement packer and meals credit the meals packer.

- **Throughput unit (TU)** per completed section = line items packed + a small per-order overhead (box/label/seal).
- **Performance %** = a packer's TU per **active** hour ÷ a benchmark, ×100. The benchmark defaults to the **team average** (so 100% = average), or a configured standard rate if set. Capped at 200%; packers with fewer than 3 orders in the period are flagged "insufficient data".
- Because it's a rate per active hour, total time-on-task does NOT win — a fast packer with few orders outranks a slow packer who logged the most hours.
- Reports: **Dispatch Performance** (packing only) and **Employee Performance** (all stations combined, production + dispatch). Default date range is the current month, so change it if recent activity is in another month.
$md$, 41),

('kb-food-cost', 'food-cost', 'Reports', 'Food cost & margins', $md$
Cost flows from raw materials → bulk WIP cost/kg → per-meal cost → per-package cost via BOMs. Margin = (price − average cost) ÷ price. Products under ~30% margin or with zero cost are flagged. (Cost & pricing data is only visible to roles with the cost permissions.)
$md$, 50),

('kb-roles', 'roles-permissions', 'System', 'Roles & permissions', $md$
Access is by role; each role grants a set of permissions. Built-in roles include admin, director, ops_manager, financial_manager, kitchen_manager, kitchen, stock_controller, picker_packer, floor_operator, viewer. Cost/pricing data is gated behind specific permissions (dashboard_costs, reports_costs, food_cost_view) so non-financial staff don't see money figures. Livi follows the same rule: it only answers about data your role permits, and hides pricing if you don't have a cost permission.
$md$, 60),

('kb-howto-packing', 'howto-packing', 'How-to', 'How do I pack an order?', $md$
1. Open the floor app → **Order Packing** → pick your name → enter your **PIN**.
2. Choose the order. If it has both supplements and meals, pick which section you're packing.
3. The timer starts automatically. Scan each item (USB/handheld scanner or the camera button). The keyboard only appears if you tap the text box.
4. When everything is scanned, tap **Finish** → photograph the sealed, labelled box. The section completes and you return to the remaining orders.
5. The order shows **Busy Packing** / **Part-Packed** until every section is done, then **Packed**.
$md$, 70),

('kb-howto-pin', 'howto-set-pin', 'How-to', 'How do I set a packer''s PIN?', $md$
On the management dashboard: **Settings → Production Team** → click the pencil (edit) on the person → make sure **Dispatch** is ticked under Duties → a **Packing PIN** box appears → enter 4 digits → **Save**. The row then shows "Pack PIN: ••••".
$md$, 71)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, content = EXCLUDED.content, category = EXCLUDED.category, sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 060_product_classification_rules.sql
--
-- Data-driven product classification so NEW products auto-file into the right
-- Category (product.type) and Subcategory (product.subcategory) on Shopify sync
-- and manual creation — instead of the old hardcoded `type:'finished_meal'`
-- default in sync-shopify-products.
--
-- A rule matches on SKU prefix/regex, product title keyword, or Shopify
-- product_type. Lowest `priority` wins (first match). Adding a new product line
-- (e.g. a new seasonal range) becomes a row here, not a code edit.
--
-- SAFE BY DESIGN: classify_product() returns NULL when nothing matches, and the
-- caller falls back to its existing default — so this can never regress an
-- existing product (the sync only classifies on INSERT, never on UPDATE).
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_classification_rules (
  id            text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),

  match_type    text NOT NULL CHECK (match_type IN ('sku_prefix','sku_regex','title_keyword','shopify_type')),
  pattern       text NOT NULL,
  assigned_type text NOT NULL CHECK (assigned_type IN (
                  'raw','packaging','wip_bulk','finished_meal','supplement',
                  'package','sauce','solo_serve','bundle','service')),
  assigned_subcategory text,           -- nullable: let subcategory auto-detect if blank
  priority      int NOT NULL DEFAULT 100,  -- lower = checked first
  is_active     boolean NOT NULL DEFAULT true,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_pcr_active_priority ON product_classification_rules(is_active, priority);

-- ── Classifier ─────────────────────────────────────────────────────────────
-- Returns {"type": <category>, "subcategory": <subcategory-or-null>} for the
-- first matching active rule (by priority), or NULL if nothing matches.
CREATE OR REPLACE FUNCTION classify_product(
  p_sku          text,
  p_name         text DEFAULT NULL,
  p_shopify_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r       RECORD;
  v_sku   text := upper(coalesce(p_sku, ''));
  v_name  text := lower(coalesce(p_name, ''));
  v_stype text := lower(coalesce(p_shopify_type, ''));
  matched boolean;
BEGIN
  FOR r IN
    SELECT * FROM product_classification_rules
    WHERE is_active = true
    ORDER BY priority ASC, created_date ASC
  LOOP
    matched := false;
    IF r.match_type = 'sku_prefix' THEN
      matched := v_sku LIKE (upper(r.pattern) || '%');
    ELSIF r.match_type = 'sku_regex' THEN
      matched := v_sku ~ upper(r.pattern);
    ELSIF r.match_type = 'title_keyword' THEN
      matched := v_name LIKE ('%' || lower(r.pattern) || '%');
    ELSIF r.match_type = 'shopify_type' THEN
      matched := v_stype = lower(r.pattern);
    END IF;

    IF matched THEN
      RETURN jsonb_build_object(
        'type', r.assigned_type,
        'subcategory', r.assigned_subcategory
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION classify_product(text, text, text) TO service_role, authenticated, anon;

-- ── Seed: high-confidence, store-specific rules ─────────────────────────────
-- These SKU patterns are precise for Lean Living's coded SKUs. The
-- `^PREFIX[0-9]+$` shape distinguishes a MEAL (e.g. WWR3, MWL12) from a sleeve
-- or pack that merely shares the prefix. WWR15/30/60 boxes win over WWR<n>
-- because their rule has a lower priority number.
-- Guarded so re-running the migration does not duplicate the seed rows.
INSERT INTO product_classification_rules (match_type, pattern, assigned_type, assigned_subcategory, priority, notes)
SELECT * FROM (VALUES
  ('sku_regex', '^WWR(15|30|60)$', 'package',       'Winter Warmer Packages',                    10, 'Winter Warmer sellable boxes (15/30/60 meals)'),
  ('sku_regex', '^WWR[0-9]+$',     'finished_meal', 'Winter Warmer Range',                       20, 'Winter Warmer individual meals (soups/stews)'),
  ('sku_regex', '^MWL[0-9]+$',     'finished_meal', 'Men''s Weight Loss / BYO Meals (MWL)',      50, 'Goal-based meal'),
  ('sku_regex', '^MLM[0-9]+$',     'finished_meal', 'Men''s Lean Muscle Meals (MLM)',            50, 'Goal-based meal'),
  ('sku_regex', '^WLM[0-9]+$',     'finished_meal', 'Women''s Lean Muscle Meals (WLM)',          50, 'Goal-based meal'),
  ('sku_regex', '^WWL[0-9]+$',     'finished_meal', 'Women''s Weight Loss Meals (WWL)',          50, 'Goal-based meal'),
  -- Shopify product_type fallbacks (case-insensitive exact match). Harmless if
  -- the store never sends these strings; edit/extend in Settings as needed.
  ('shopify_type', 'Packages',     'package',       NULL,                                        80, 'Shopify product_type = Packages'),
  ('shopify_type', 'Supplements',  'supplement',    NULL,                                        80, 'Shopify product_type = Supplements'),
  ('shopify_type', 'Packaging',    'packaging',     NULL,                                        80, 'Shopify product_type = Packaging')
) AS v(match_type, pattern, assigned_type, assigned_subcategory, priority, notes)
WHERE NOT EXISTS (SELECT 1 FROM product_classification_rules);

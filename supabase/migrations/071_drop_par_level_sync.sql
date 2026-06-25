-- ============================================================================
-- 071_drop_par_level_sync
-- products.par_level is now the SINGLE SOURCE OF TRUTH for finished-meal par
-- levels. It is written directly by:
--   • the Par Levels tab          (src/components/master-data/ParLevelsTab.jsx)
--   • the AI Recommendations tab  (src/components/master-data/ParRecommendationsTab.jsx)
-- and it is the only par store Production Planning reads.
--
-- The legacy par_levels → products mirror (trg_sync_par_level /
-- sync_par_level_to_product, from par_level_sync_trigger.sql) is removed here.
-- It only ever covered type='finished_meal' rows joined on skus.sku_code =
-- products.sku, so it silently no-op'd for SKUs the legacy skus table doesn't
-- cover (e.g. Winter Warmer) AND was a latent clobber risk — any write to the
-- old par_levels table would overwrite a manual products.par_level edit.
-- Dropping it makes products.par_level authoritative and edit-safe.
--
-- ⚠️  Must be applied in the Supabase SQL Editor before/with this deploy.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_par_level ON par_levels;
DROP FUNCTION IF EXISTS sync_par_level_to_product();

-- ============================================================================
-- 083_wwr_sticker_stock_count
-- One-time physical-count set for the Winter Warmer sticker packaging, from the
-- on-hand counts the user supplied (the "Stickers left" column).
--
-- Location: (PE) Extra Storage House  (id 69ea6bec8ec21eb792730862) — where the
-- bulk of packaging stock is held.
-- For the 5 soups with a separate Front + Back sticker, the count is "that many
-- of EACH", so both the Front and Back SKUs are set to the same number.
--
--   WWR1 Smokey Beef & Bean Soup     Front+Back  1059
--   WWR2 Chicken Chickpea Soup       Front+Back   934
--   WWR3 Creamy Chicken Soup         Front+Back   934
--   WWR4 Roasted Butternut Soup      Front+Back   934
--   WWR5 Chunky Veg & Lentil Soup    Front+Back   764
--   WWR6 Spicy Chicken Noodles       Sticker     1818
--   WWR7 Homestyle Beef Stew         Sticker     1647
--   WWR8 Traditional Curry & Rice    Sticker     1820
--   WWR9 Classic Chicken À La King   Sticker     1809
--
-- Direct set of stock_on_hand (the same approach used for the 2026-06 clean-slate
-- physical count). qty_available is recomputed = on_hand − committed.
--
-- ⚠️  Run in the Supabase SQL Editor.
-- ============================================================================

WITH counts(sku, qty) AS (
  VALUES
    ('WWR1StickerFront', 1059), ('WWR1StickerBack', 1059),
    ('WWR2StickerFront',  934), ('WWR2StickerBack',  934),
    ('WWR3StickerFront',  934), ('WWR3StickerBack',  934),
    ('WWR4StickerFront',  934), ('WWR4StickerBack',  934),
    ('WWR5StickerFront',  764), ('WWR5StickerBack',  764),
    ('WWR6Sticker',      1818),
    ('WWR7Sticker',      1647),
    ('WWR8Sticker',      1820),
    ('WWR9Sticker',      1809)
)
UPDATE stock_on_hand s
   SET qty_on_hand   = c.qty,
       qty_available = c.qty - COALESCE(s.qty_committed, 0),
       updated_date  = now()
  FROM counts c
  JOIN products p ON p.sku = c.sku
 WHERE s.product_id  = p.id
   AND s.location_id = '69ea6bec8ec21eb792730862';

-- Verify (optional): should return 14 rows with the counts above.
-- SELECT p.sku, s.qty_on_hand, s.qty_available
-- FROM stock_on_hand s JOIN products p ON p.id = s.product_id
-- WHERE p.sku LIKE 'WWR%Sticker%' AND s.location_id = '69ea6bec8ec21eb792730862'
-- ORDER BY p.sku;

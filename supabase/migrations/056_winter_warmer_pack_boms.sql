-- Winter Warmer Range pack compositions (WWR15 / WWR30 / WWR60).
-- Composition is fixed; the 30 and 60 packs are the 15-pack multiplied ×2 and ×4.
-- Most meals are ×2 per 15-pack, except WWR1 (Smokey Beef & Bean),
-- WWR5 (Chunky Veg & Lentil) and WWR7 (Homestyle Beef Stew) which are ×1.
--
--   SKU   Meal                         15  30  60
--   WWR1  Smokey Beef & Bean Soup       1   2   4
--   WWR2  Chicken Chickpea Soup         2   4   8
--   WWR3  Creamy Chicken Soup           2   4   8
--   WWR4  Roasted Butternut Soup        2   4   8
--   WWR5  Chunky Vegetable & Lentil     1   2   4
--   WWR6  Spicy Chicken Noodle          2   4   8
--   WWR7  Homestyle Beef Stew           1   2   4
--   WWR8  Traditional Curry & Rice      2   4   8
--   WWR9  Classic Chicken A La King     2   4   8
--   TOTAL                              15  30  60

-- id has no DB default — the app generates 24-char hex ids (Mongo ObjectId style),
-- so we generate matching ids here with pgcrypto's gen_random_bytes.
INSERT INTO pack_boms
  (id, package_sku, package_type, multiplier, component_skus, disabled_skus, sku_overrides, active)
VALUES
  (encode(gen_random_bytes(12), 'hex'), 'WWR15', 'bundle', 2,
   ARRAY['WWR1','WWR2','WWR3','WWR4','WWR5','WWR6','WWR7','WWR8','WWR9'],
   ARRAY[]::text[],
   '{"WWR1":1,"WWR5":1,"WWR7":1}', true),
  (encode(gen_random_bytes(12), 'hex'), 'WWR30', 'bundle', 4,
   ARRAY['WWR1','WWR2','WWR3','WWR4','WWR5','WWR6','WWR7','WWR8','WWR9'],
   ARRAY[]::text[],
   '{"WWR1":2,"WWR5":2,"WWR7":2}', true),
  (encode(gen_random_bytes(12), 'hex'), 'WWR60', 'bundle', 8,
   ARRAY['WWR1','WWR2','WWR3','WWR4','WWR5','WWR6','WWR7','WWR8','WWR9'],
   ARRAY[]::text[],
   '{"WWR1":4,"WWR5":4,"WWR7":4}', true)
ON CONFLICT DO NOTHING;

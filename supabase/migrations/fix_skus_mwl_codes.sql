-- Fix MWL sku_codes: update from legacy descriptive codes to clean numbered format matching products.sku
UPDATE skus SET sku_code = CASE meal_name
  WHEN 'Beef & Beans'                                                       THEN 'MWL1'
  WHEN 'Beef Trinchado + (white basmati rice + stir-fry)'                   THEN 'MWL2'
  WHEN 'Chicken breast, Sweet potato, Mixed veg'                            THEN 'MWL3'
  WHEN 'Chicken breast, Butternut, Stir-fry'                                THEN 'MWL4'
  WHEN 'Chicken breast, Cous cous, Mixed veg'                               THEN 'MWL5'
  WHEN 'Chicken breast, Potato Wedges, Creamy spinach (Swt Chilli Sauce)'  THEN 'MWL6'
  WHEN 'Chicken Curry + (white rice + butternut)'                           THEN 'MWL7'
  WHEN 'Cottage Pie + (Sweet potato Mash + Creamy spinach)'                 THEN 'MWL8'
  WHEN 'Keto Butter Chicken + (cauliflower + spinach)'                      THEN 'MWL9'
  WHEN 'Lean Mince – Pasta Shells and Corn'                                 THEN 'MWL10'
  WHEN 'Lean mince, White basmati rice, Broccoli'                          THEN 'MWL11'
  WHEN 'Lean mince, White basmati rice, Green beans'                        THEN 'MWL12'
  WHEN 'Steak – Brown Rice and Carrots'                                     THEN 'MWL13'
  WHEN 'Steak, Sweet potato, Broccoli'                                      THEN 'MWL14'
  WHEN 'Sweet Chilli Chicken + (brown rice + stirfry)'                      THEN 'MWL15'
END
WHERE package_type = 'MWL' AND sku_code NOT LIKE 'MWL%';

-- Verify
SELECT sku_code, meal_name FROM skus WHERE package_type = 'MWL' ORDER BY sku_code;

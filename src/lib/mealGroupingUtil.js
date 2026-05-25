/**
 * Builds a SKU → group-name map from PackBom records for stock-take grouping.
 *
 * Rules:
 * - MLM* SKUs → "Men's Lean Muscle" (same meals as BYO at 300g, labelled MWL)
 * - MWL SKUs (BeeandBea-2, BeeTri, etc.) → "Men's Weight Loss" (also BYO — same SKUs)
 * - WLM* SKUs → "Women's Lean Muscle"
 * - WWL* SKUs → "Women's Weight Loss"
 * - Low Carb SKUs (SCP*) → "Low Carb"
 * - Anything else in a PackBom → "Other Meals"
 *
 * Returns { groupMap: { sku → groupName }, validSkus: Set<string> }
 */

const PACKAGE_PREFIX_MAP = {
  MenLeaMus: "Men's Lean Muscle",
  MenWeiLos: "Men's Weight Loss",
  WomLeaMus: "Women's Lean Muscle",
  WomWeiLos: "Women's Weight Loss",
};

const PACKAGE_TYPE_MAP = {
  low_carb: 'Low Carb',
};

function resolveGroupName(packageSku, packageType) {
  for (const [prefix, label] of Object.entries(PACKAGE_PREFIX_MAP)) {
    if (packageSku.startsWith(prefix)) return label;
  }
  if (PACKAGE_TYPE_MAP[packageType]) return PACKAGE_TYPE_MAP[packageType];
  return 'Other Meals';
}

export function buildMealGrouping(packBoms) {
  const groupMap = {};   // sku → group name
  const validSkus = new Set();

  for (const bom of packBoms) {
    const groupName = resolveGroupName(bom.package_sku, bom.package_type);
    for (const sku of (bom.component_skus || [])) {
      validSkus.add(sku);
      // First assignment wins — a SKU in multiple packages keeps its first group
      if (!groupMap[sku]) {
        groupMap[sku] = groupName;
      }
    }
  }

  return { groupMap, validSkus };
}
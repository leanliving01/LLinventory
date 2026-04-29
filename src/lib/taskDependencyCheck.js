/**
 * Component-level dependency checker for production tasks.
 *
 * For COOK tasks: all prep tasks for the same line_id must be done.
 * For PORTION tasks: all cook tasks whose OUTPUT product is an INPUT
 *   component of the portion BOM must be done. Skin vacuum packs (SVP)
 *   are excluded from blocking — they're always available on the machine.
 *
 * Returns null if no blockers, or a user-friendly message string.
 */

// SKUs that never block (always available on the line)
const EXEMPT_SKUS = ['SVP'];

function isExempt(sku) {
  if (!sku) return false;
  const upper = sku.toUpperCase();
  return EXEMPT_SKUS.some(e => upper === e || upper.startsWith(e));
}

/**
 * @param {object} task - The task being started
 * @param {object[]} allTasks - All tasks in the run (non-archived)
 * @param {object[]} bomComponents - BomComponent records for the task's portion/cook BOM
 * @param {object[]} allBoms - All active BOMs (to map component product_id → cook BOM output)
 * @param {boolean} pickListConfirmed
 * @returns {string|null} Block message or null
 */
export function checkTaskDependencies(task, allTasks, bomComponents, allBoms, pickListConfirmed) {
  if (!pickListConfirmed) {
    return 'Pick list has not been confirmed yet. Stock must be picked first.';
  }

  // PREP tasks have no upstream dependencies
  if (task.station === 'prep') return null;

  // COOK tasks: simple — all prep tasks for same line_id must be done
  if (task.station === 'cook') {
    const prepTasks = allTasks.filter(
      t => t.station === 'prep' && t.line_id === task.line_id && !t.archived
    );
    const incomplete = prepTasks.filter(t => t.status !== 'done');
    if (incomplete.length > 0) {
      const names = incomplete.map(t => `"${t.name || t.meal_name}"`).join(', ');
      return `First complete prep: ${names} before cooking.`;
    }
    return null;
  }

  // PORTION tasks: component-level check
  if (task.station === 'portion') {
    // 1. Check same-line cook tasks first (basic check)
    const sameLineCookTasks = allTasks.filter(
      t => t.station === 'cook' && t.line_id === task.line_id && !t.archived
    );
    const incompleteBasic = sameLineCookTasks.filter(t => t.status !== 'done');
    if (incompleteBasic.length > 0) {
      const names = incompleteBasic.map(t => `"${t.name || t.meal_name}"`).join(', ');
      return `First finish cooking: ${names} before portioning.`;
    }

    // 2. Component-level check using BOM data
    if (bomComponents.length > 0 && allBoms.length > 0) {
      // Build a map: product_id → cook BOM (these are the WIP products that need to be cooked)
      const cookBomByProduct = {};
      allBoms.filter(b => b.bom_type === 'cook' && b.is_active).forEach(b => {
        cookBomByProduct[b.product_id] = b;
      });

      const missing = [];
      for (const comp of bomComponents) {
        // Skip exempt items (SVP etc)
        if (isExempt(comp.input_product_sku)) continue;

        // Check if this component's input product has a cook BOM
        // (meaning it's a WIP that needs to be cooked)
        const cookBom = cookBomByProduct[comp.input_product_id];
        if (!cookBom) continue; // Not a cooked item (e.g. packaging sleeve — handled by pick list)

        // Find cook tasks in this run for this product
        const cookTasks = allTasks.filter(
          t => t.station === 'cook' && t.product_id === comp.input_product_id && !t.archived
        );

        if (cookTasks.length === 0) {
          // No cook task exists for this component — might be pre-cooked or from stock
          continue;
        }

        const incompleteCook = cookTasks.filter(t => t.status !== 'done');
        if (incompleteCook.length > 0) {
          missing.push(comp.input_product_name || comp.input_product_sku || 'Unknown');
        }
      }

      if (missing.length > 0) {
        const unique = [...new Set(missing)];
        return `Cannot start portioning — these components are not yet cooked:\n• ${unique.join('\n• ')}`;
      }
    }

    return null;
  }

  return null;
}

/**
 * Build a set of blocked task IDs for the task list display.
 * Same logic as checkTaskDependencies but batch-optimized.
 */
export function getBlockedTaskIds(tasks, allTasks, bomComponentsMap, allBoms, pickListConfirmed) {
  const blocked = new Set();

  if (!pickListConfirmed) {
    tasks.filter(t => t.status === 'pending').forEach(t => blocked.add(t.id));
    return blocked;
  }

  // Build cook BOM lookup
  const cookBomByProduct = {};
  allBoms.filter(b => b.bom_type === 'cook' && b.is_active).forEach(b => {
    cookBomByProduct[b.product_id] = b;
  });

  tasks.filter(t => t.status === 'pending').forEach(task => {
    if (task.station === 'prep') return;

    if (task.station === 'cook') {
      const prepTasks = allTasks.filter(
        t => t.station === 'prep' && t.line_id === task.line_id && !t.archived
      );
      if (prepTasks.length > 0 && prepTasks.some(t => t.status !== 'done')) {
        blocked.add(task.id);
      }
      return;
    }

    if (task.station === 'portion') {
      // Basic same-line check
      const sameLineCook = allTasks.filter(
        t => t.station === 'cook' && t.line_id === task.line_id && !t.archived
      );
      if (sameLineCook.length > 0 && sameLineCook.some(t => t.status !== 'done')) {
        blocked.add(task.id);
        return;
      }

      // Component-level check
      const comps = bomComponentsMap[task.product_id] || [];
      for (const comp of comps) {
        if (isExempt(comp.input_product_sku)) continue;
        if (!cookBomByProduct[comp.input_product_id]) continue;

        const cookTasks = allTasks.filter(
          t => t.station === 'cook' && t.product_id === comp.input_product_id && !t.archived
        );
        if (cookTasks.length > 0 && cookTasks.some(t => t.status !== 'done')) {
          blocked.add(task.id);
          return;
        }
      }
    }
  });

  return blocked;
}
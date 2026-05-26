import { supabase } from '@/api/supabaseClient';

/**
 * Atomically generates the next document number for a given prefix and date.
 * Uses the doc_number_sequences table via the next_doc_number DB function.
 *
 * Format: {PREFIX}-YYYYMMDD-NNN (expands to NNNN if seq > 999 in one day)
 *
 * Examples:
 *   nextDocNumber('PO')  → 'PO-20260526-001'
 *   nextDocNumber('BR')  → 'BR-20260526-001'
 *   nextDocNumber('GRN') → 'GRN-20260526-001'
 *
 * @param {string} prefix - Document type prefix (PO, BR, GRN, RTN, SCN)
 * @param {Date}   [date]  - Date for the sequence (defaults to today)
 * @returns {Promise<string>} The formatted document number
 */
export async function nextDocNumber(prefix, date = new Date()) {
  // Use local calendar date (not UTC) to avoid midnight timezone shifts for SAST (UTC+2)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const { data, error } = await supabase.rpc('next_doc_number', {
    p_prefix: prefix,
    p_date: dateStr,
  });
  if (error) throw new Error(`Document numbering error for ${prefix}: ${error.message}`);
  return data;
}

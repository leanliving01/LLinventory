import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const isIframe = window.self !== window.top;

// ---------------------------------------------------------------------------
// Currency — South African format: R 1 234,56
// ---------------------------------------------------------------------------
export function formatZAR(val) {
  if (val == null || isNaN(val)) return 'R 0,00';
  return 'R ' + Number(val).toLocaleString('af-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Payment terms — structured label + due date computation
// ---------------------------------------------------------------------------
export function computePaymentTermsLabel(basis, days, cutoffDay) {
  if (!basis) return '';
  const d = parseInt(days) || 0;
  const c = parseInt(cutoffDay) || 0;
  if (basis === 'invoice_date') {
    return d === 0 ? 'Immediate / COD' : `${d} days from invoice date`;
  }
  if (basis === 'end_of_month_of_invoice') {
    return d === 0 ? 'End of month' : `${d} days after end of month`;
  }
  if (basis === 'specific_day_of_month') {
    return `${c}th of following month`;
  }
  return '';
}

function lastDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// Returns a Date object for when the invoice is due.
// invoiceDate may be a Date, ISO string, or null.
export function computeDueDate(invoiceDate, basis, days, cutoffDay) {
  if (!invoiceDate || !basis) return null;
  const d = parseInt(days) || 0;
  const c = parseInt(cutoffDay) || 0;
  const base = new Date(invoiceDate);
  if (isNaN(base.getTime())) return null;

  if (basis === 'invoice_date') {
    const due = new Date(base);
    due.setDate(due.getDate() + d);
    return due;
  }
  if (basis === 'end_of_month_of_invoice') {
    const eom = lastDayOfMonth(base);
    const due = new Date(eom);
    due.setDate(due.getDate() + d);
    return due;
  }
  if (basis === 'specific_day_of_month') {
    // e.g. "20th of following month"
    const due = new Date(base.getFullYear(), base.getMonth() + 1, c);
    return due;
  }
  return null;
}

// Format a Date or ISO string as DD/MM/YYYY (SAST display)
export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  });
}

// Days between two dates (positive = first is in the past relative to second)
export function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / 86400000);
}

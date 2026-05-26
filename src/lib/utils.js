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

// ---------------------------------------------------------------------------
// Payment terms v2 — uses the new payment_term_type enum (Prompt 11)
// ---------------------------------------------------------------------------

// Ordinal suffix helper — e.g. 1 → "1st", 25 → "25th"
function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Calculate a due date from the new payment_term_type enum.
// Returns a Date (in local time) or null.
// Handles edge case: if day > last day of target month, use last valid day.
export function calculateDueDate(invoiceDate, paymentTermType, paymentTermValue) {
  if (!invoiceDate || !paymentTermType) return null;
  const base = new Date(invoiceDate);
  if (isNaN(base.getTime())) return null;
  const value = parseInt(paymentTermValue);

  if (paymentTermType === 'immediate') {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate());
  }

  if (paymentTermType === 'days_after_invoice') {
    const days = isNaN(value) ? 0 : value;
    const due = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    due.setDate(due.getDate() + days);
    return due;
  }

  // day_of_* requires a valid day 1-31
  if (paymentTermType === 'day_of_invoice_month') {
    if (!value || value < 1 || value > 31) return null;
    const year = base.getFullYear();
    const month = base.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(value, lastDay));
  }

  if (paymentTermType === 'day_of_following_month') {
    if (!value || value < 1 || value > 31) return null;
    let year = base.getFullYear();
    let month = base.getMonth() + 1;
    if (month > 11) { month = 0; year++; }
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(value, lastDay));
  }

  return null;
}

// Human-readable label for the new payment_term_type enum
export function formatPaymentTerms(paymentTermType, paymentTermValue) {
  const v = parseInt(paymentTermValue) || 0;
  switch (paymentTermType) {
    case 'immediate':              return 'Immediate / COD';
    case 'days_after_invoice':     return v === 0 ? 'Immediate / COD' : `${v} days from invoice date`;
    case 'day_of_invoice_month':   return `${ordinal(v)} of invoice month`;
    case 'day_of_following_month': return `${ordinal(v)} of following month`;
    default:                       return '';
  }
}

// Colour code for due date display.
// Returns 'green' (>7 days), 'amber' (3-7 days), or 'red' (<3 days or overdue).
export function dueDateColour(dueDateStr) {
  if (!dueDateStr) return 'default';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays > 7)  return 'green';
  if (diffDays >= 3) return 'amber';
  return 'red';
}

// Format a Date object to an ISO date string (YYYY-MM-DD) for DB storage.
// Uses local calendar date (not UTC) to avoid midnight timezone shifts for SAST (UTC+2).
export function toISODate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

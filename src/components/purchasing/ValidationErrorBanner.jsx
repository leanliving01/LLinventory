import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Displays a list of validation errors in a destructive-coloured banner.
 * All errors are shown at once. Returns null if there are no errors.
 *
 * @param {string[]} errors - Array of error message strings
 */
export default function ValidationErrorBanner({ errors = [] }) {
  if (!errors.length) return null;
  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-2">
      <p className="text-sm font-semibold text-destructive flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {errors.length === 1
          ? '1 issue must be resolved before continuing'
          : `${errors.length} issues must be resolved before continuing`}
      </p>
      <ul className="list-disc list-inside space-y-1">
        {errors.map((e, i) => (
          <li key={i} className="text-xs text-destructive">{e}</li>
        ))}
      </ul>
    </div>
  );
}

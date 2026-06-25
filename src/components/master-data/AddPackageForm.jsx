import React from 'react';
import { Button } from '@/components/ui/button';
import { X, AlertTriangle } from 'lucide-react';

// LEGACY package creation has been retired.
//
// Packages used to be created here as `PackageProduct` rows (+ `PackageBOMLine`
// rows via the variant BOM editor). Those legacy tables feed NOTHING in the live
// stock / deduction / production / par flow, so anything created here was an
// orphan, invisible to the rest of the system.
//
// The correct, modern flow:
//   1. Create the package in the Catalog as a product with type = "package".
//   2. Open that product's PACKING BOM and add its components there.
// The Packing BOM derives the pack_boms explosion map that actually drives
// deduction, demand and packing.
//
// This component now only renders a signpost. No create action remains.
export default function AddPackageForm({ onClose }) {
  return (
    <div className="bg-card border border-amber-300 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold">Packages are no longer created here</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              This legacy package form has been retired because packages created here
              were invisible to stock, deduction, production and par planning.
            </p>
          </div>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="ml-8 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">To add a package, use the modern flow:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Create the package in the <span className="font-semibold text-foreground">Catalog</span> as a
            product with <span className="font-mono text-foreground">type = package</span>.
          </li>
          <li>
            Open that product&apos;s <span className="font-semibold text-foreground">Packing BOM</span> and
            add its components there.
          </li>
        </ol>
        <p className="pt-1">
          The Packing BOM drives the live deduction, demand and packing flow automatically.
        </p>
      </div>
    </div>
  );
}

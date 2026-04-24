import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';

export default function DependencyBlockModal({ message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-red-50 dark:bg-red-900/20 rounded-t-2xl">
          <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
          <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Cannot Start Task</h3>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="px-6 py-6">
          <p className="text-sm text-foreground leading-relaxed">{message}</p>
        </div>
        <div className="px-6 py-4 border-t border-border">
          <Button onClick={onClose} className="w-full h-12 text-base">
            OK, Got It
          </Button>
        </div>
      </div>
    </div>
  );
}
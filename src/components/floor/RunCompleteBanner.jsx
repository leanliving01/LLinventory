import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ArrowRight } from 'lucide-react';

/**
 * Shown on the floor tasks page when every task in the run is done.
 * Links to the Production Run Detail page for manager approval.
 */
export default function RunCompleteBanner({ runId, runNumber }) {
  return (
    <div className="bg-green-50 dark:bg-green-950 border-2 border-green-300 dark:border-green-700 rounded-2xl p-6 text-center space-y-3">
      <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
      <h2 className="text-xl font-bold text-green-800 dark:text-green-200">All Tasks Complete!</h2>
      <p className="text-sm text-green-700 dark:text-green-300">
        Every task in {runNumber || 'this run'} is finished. A manager needs to review and approve the run to update stock.
      </p>
      <Link to={`/production/run/${runId}`}>
        <Button size="lg" className="h-14 px-8 gap-2 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl mt-2">
          Complete Run <ArrowRight className="w-5 h-5" />
        </Button>
      </Link>
    </div>
  );
}
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react';
import ManagerPinModal from '@/components/production/ManagerPinModal';
import { toast } from 'sonner';

/**
 * Shown on the floor tasks page when every task in the run is done.
 * Requires manager PIN verification before navigating to run completion.
 */
export default function RunCompleteBanner({ runId, runNumber }) {
  const [showPinModal, setShowPinModal] = useState(false);
  const navigate = useNavigate();

  const handleVerified = ({ manager_name }) => {
    setShowPinModal(false);
    toast.success(`Approved by ${manager_name}`);
    // Navigate to the run detail page with the manager approval flag
    navigate(`/production/run/${runId}?approved_by=${encodeURIComponent(manager_name)}`);
  };

  return (
    <>
      <div className="bg-green-50 dark:bg-green-950 border-2 border-green-300 dark:border-green-700 rounded-2xl p-6 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
        <h2 className="text-xl font-bold text-green-800 dark:text-green-200">All Tasks Complete!</h2>
        <p className="text-sm text-green-700 dark:text-green-300">
          Every task in {runNumber || 'this run'} is finished. A manager needs to review and approve the run to update stock.
        </p>
        <Button
          size="lg"
          className="h-14 px-8 gap-2 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl mt-2"
          onClick={() => setShowPinModal(true)}
        >
          <ShieldCheck className="w-5 h-5" />
          View & Complete Run <ArrowRight className="w-5 h-5" />
        </Button>
      </div>

      {showPinModal && (
        <ManagerPinModal
          onVerified={handleVerified}
          onCancel={() => setShowPinModal(false)}
        />
      )}
    </>
  );
}
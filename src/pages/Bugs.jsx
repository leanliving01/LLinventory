import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Bug, Loader2 } from 'lucide-react';
import BugReportForm from '@/components/bugs/BugReportForm';
import BugReportCard from '@/components/bugs/BugReportCard';

export default function Bugs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: bugs = [], isLoading } = useQuery({
    queryKey: ['bug-reports'],
    queryFn: () => base44.entities.BugReport.list('-created_date', 100),
    enabled: isAdmin,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bug-reports'] });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bug className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Bug Reports</h1>
          <p className="text-sm text-muted-foreground">Report issues and track fixes</p>
        </div>
      </div>

      {/* Report form — visible to all */}
      <BugReportForm onSubmitted={refresh} />

      {/* Bug list — admin only */}
      {isAdmin && (
        <div>
          <h2 className="text-sm font-bold mb-3">All Bug Reports</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading...
            </div>
          ) : bugs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No bug reports yet.</p>
          ) : (
            <div className="space-y-3">
              {bugs.map(bug => (
                <BugReportCard key={bug.id} bug={bug} isAdmin={isAdmin} onUpdate={refresh} onDelete={refresh} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
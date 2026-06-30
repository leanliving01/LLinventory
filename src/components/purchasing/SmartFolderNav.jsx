import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PO_FOLDERS, buildPoFolderContext, folderCounts } from '@/lib/poFolders';

const CREDIT_RETURN_SUBFILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'credit_notes', label: 'Credit Notes' },
  { key: 'returns',      label: 'Returns' },
];

function FolderItem({ label, count, badgeVariant, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left',
        isActive
          ? 'bg-primary/10 text-primary font-semibold'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shrink-0 ml-1',
          badgeVariant === 'red'   ? 'bg-red-100 text-red-700' :
          badgeVariant === 'amber' ? 'bg-amber-100 text-amber-700' :
          'bg-muted text-muted-foreground'
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function SmartFolderNav({
  pos = [],
  grns = [],
  invoices = [],
  returns = [],
  creditNotes = [],
  posNeedingAttention = new Set(),
  activeFolder,
  onFolderSelect,
  creditReturnsFilter = 'all',
  onCreditReturnsFilterChange,
}) {
  const counts = useMemo(() => {
    const ctx = buildPoFolderContext({ grns, invoices, creditNotes, returns, posNeedingAttention });
    return folderCounts(pos, ctx);
  }, [pos, grns, invoices, returns, creditNotes, posNeedingAttention]);

  return (
    <nav className="w-52 shrink-0 space-y-0.5 pr-2 border-r border-border">
      <p className="text-[10px] uppercase font-semibold text-muted-foreground px-3 pb-1 pt-0.5 tracking-wide">
        Folders
      </p>
      {PO_FOLDERS.map(folder => (
        <React.Fragment key={folder.key}>
          <FolderItem
            label={folder.label}
            count={counts[folder.key] || 0}
            badgeVariant={folder.badge}
            isActive={activeFolder === folder.key}
            onClick={() => onFolderSelect(folder.key)}
          />
          {/* Credit Notes & Returns: in-folder filter to split the two */}
          {folder.key === 'credit_returns' && activeFolder === 'credit_returns' && (
            <div className="flex flex-wrap gap-1 pl-4 pr-1 pb-1.5 pt-0.5">
              {CREDIT_RETURN_SUBFILTERS.map(sf => (
                <button
                  key={sf.key}
                  onClick={() => onCreditReturnsFilterChange && onCreditReturnsFilterChange(sf.key)}
                  className={cn(
                    'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                    creditReturnsFilter === sf.key
                      ? 'bg-primary/10 text-primary border-primary/30 font-medium'
                      : 'text-muted-foreground border-border hover:bg-muted'
                  )}
                >
                  {sf.label}
                </button>
              ))}
            </div>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

import React, { useMemo } from 'react';
import PurchaseAttachmentsPanel from '@/components/purchasing/PurchaseAttachmentsPanel';

export default function WorkspaceAttachmentsTab({ po, invoices = [] }) {
  const legacyUrls = useMemo(() => (
    po?.attachment_urls
      ? (typeof po.attachment_urls === 'string'
          ? po.attachment_urls.split('\n').map(u => u.trim()).filter(Boolean)
          : po.attachment_urls)
      : []
  ), [po]);

  return (
    <PurchaseAttachmentsPanel
      purchaseOrderId={po?.id || null}
      invoiceIds={invoices.map(i => i.id)}
      legacyUrls={legacyUrls}
    />
  );
}

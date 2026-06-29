import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { isOpenShortage } from '@/lib/shortageEngine';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { toast } from 'sonner';

import WorkspaceHeader from '@/components/purchasing/workspace/WorkspaceHeader';
import StepIndicator from '@/components/purchasing/workspace/StepIndicator';
import WorkspaceSummaryTab from '@/components/purchasing/workspace/WorkspaceSummaryTab';
import WorkspacePurchaseOrderTab from '@/components/purchasing/workspace/WorkspacePurchaseOrderTab';
import WorkspaceInvoiceTab from '@/components/purchasing/workspace/WorkspaceInvoiceTab';
import WorkspaceGRNTab from '@/components/purchasing/workspace/WorkspaceGRNTab';
import WorkspaceCreditReturnsTab from '@/components/purchasing/workspace/WorkspaceCreditReturnsTab';
import WorkspaceAttachmentsTab from '@/components/purchasing/workspace/WorkspaceAttachmentsTab';
import WorkspaceActivityTab from '@/components/purchasing/workspace/WorkspaceActivityTab';

export default function PurchaseWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  // 'lines' is the legacy combined tab — now split into Purchase Order + Invoice.
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(initialTab === 'lines' ? 'purchase_order' : (initialTab || 'summary'));

  // Load PO
  const { data: poList = [], isLoading: poLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ id }),
    enabled: !!id,
  });
  const po = poList[0] || null;

  // Load PO lines
  const { data: poLines = [] } = useQuery({
    queryKey: ['po-lines', id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: id }, 'created_date', 200),
    enabled: !!id,
  });

  // Load GRNs
  const { data: grns = [] } = useQuery({
    queryKey: ['workspace-grns', id],
    queryFn: () => base44.entities.GoodsReceivedNote.filter({ purchase_order_id: id }, '-received_date', 20),
    enabled: !!id,
  });

  // Load invoices
  const { data: invoices = [] } = useQuery({
    queryKey: ['workspace-invoices', id],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ purchase_order_id: id }, '-invoice_date', 10),
    enabled: !!id,
  });
  const invoice = invoices.find(i => !i.is_credit_note) || null;

  // Load invoice lines
  const { data: invoiceLines = [] } = useQuery({
    queryKey: ['workspace-invoice-lines', invoice?.id],
    queryFn: () => base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'created_date', 100),
    enabled: !!invoice?.id,
  });

  // Load shortages for this PO. Anchored on the PO (not just linked GRNs) so a shortage
  // raised from an invoice with no GRN still surfaces here, and only the OPEN ones are
  // shown — once a shortage is received/credited/cancelled it drops off the PO.
  const { data: allShortages = [] } = useQuery({
    queryKey: ['workspace-shortages', id],
    queryFn: () => base44.entities.SupplierShortage.filter({ purchase_order_id: id }, '-created_date', 100),
    enabled: !!id,
  });
  const shortages = React.useMemo(() => allShortages.filter(isOpenShortage), [allShortages]);

  // Load returns for this PO
  const { data: returns = [] } = useQuery({
    queryKey: ['workspace-returns', id],
    queryFn: () => base44.entities.SupplierReturn.filter({ purchase_order_id: id }, '-created_date', 20),
    enabled: !!id,
  });

  // Load credit notes raised against THIS PO only (not every credit note for the supplier)
  const { data: creditNotes = [] } = useQuery({
    queryKey: ['workspace-credit-notes', id],
    queryFn: () => base44.entities.SupplierCreditNote.filter({ purchase_order_id: id }, '-created_date', 50),
    enabled: !!id,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['po', id] });
    qc.invalidateQueries({ queryKey: ['po-lines', id] });
    qc.invalidateQueries({ queryKey: ['workspace-grns', id] });
    qc.invalidateQueries({ queryKey: ['workspace-invoices', id] });
    qc.invalidateQueries({ queryKey: ['workspace-shortages', id] });
    qc.invalidateQueries({ queryKey: ['lines-tab-grn-lines', id] });
  };

  const handleRevertToDraft = async () => {
    await base44.entities.PurchaseOrder.update(id, { status: 'draft' });
    toast.success('PO reverted to draft');
    qc.invalidateQueries({ queryKey: ['po', id] });
  };

  const handleDeletePO = async () => {
    await base44.entities.PurchaseOrder.update(id, { status: 'cancelled' });
    toast.success('Purchase order cancelled');
    navigate('/purchasing/orders');
  };

  if (poLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!po) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        <p className="text-lg font-semibold mb-2">Purchase order not found</p>
        <Button variant="outline" onClick={() => navigate('/purchasing/orders')}>Back to Orders</Button>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Sticky header */}
      <WorkspaceHeader
        po={po}
        invoice={invoice}
        grns={grns}
        perms={perms}
        onRevertToDraft={handleRevertToDraft}
        onDeletePO={handleDeletePO}
      />

      <div className="px-4 pt-4 space-y-3">
        {/* Back navigation */}
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground" onClick={() => navigate('/purchasing/orders')}>
          <ArrowLeft className="w-4 h-4" /> Back to Orders
        </Button>

        {/* Step indicator */}
        <StepIndicator po={po} invoice={invoice} grns={grns} />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="purchase_order">Purchase Order</TabsTrigger>
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
            <TabsTrigger value="grn">GRN</TabsTrigger>
            <TabsTrigger value="credits">Credits & Returns</TabsTrigger>
            <TabsTrigger value="attachments">Attachments</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <TabsContent value="summary">
              <WorkspaceSummaryTab
                po={po}
                invoice={invoice}
                grns={grns}
                shortages={shortages}
                returns={returns}
                onTabChange={setActiveTab}
              />
            </TabsContent>

            <TabsContent value="purchase_order">
              <WorkspacePurchaseOrderTab po={po} poLines={poLines} />
            </TabsContent>

            <TabsContent value="invoice">
              <WorkspaceInvoiceTab
                po={po}
                poLines={poLines}
                invoice={invoice}
                invoiceLines={invoiceLines}
                onInvoiceAuthorised={invalidateAll}
              />
            </TabsContent>

            <TabsContent value="grn">
              <WorkspaceGRNTab
                po={po}
                grns={grns}
                poLines={poLines}
                shortages={shortages}
                onGRNCreated={invalidateAll}
              />
            </TabsContent>

            <TabsContent value="credits">
              <WorkspaceCreditReturnsTab
                po={po}
                shortages={shortages}
                returns={returns}
                creditNotes={creditNotes}
                onDataChanged={invalidateAll}
              />
            </TabsContent>

            <TabsContent value="attachments">
              <WorkspaceAttachmentsTab po={po} invoices={invoices} />
            </TabsContent>

            <TabsContent value="activity">
              <WorkspaceActivityTab poId={id} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

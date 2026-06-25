import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Database, Building2, Bell, Ruler, Package, UserCog, FolderTree, ShoppingBag, RefreshCw, Calculator, ShieldCheck, Smartphone, Download } from 'lucide-react';
import { LATEST_APK_URL, REQUIRED_NATIVE_BUILD } from '@/config/nativeApp';
import SettingsOrgTab from '@/components/settings/SettingsOrgTab';
import SettingsSyncTab from '@/components/settings/SettingsSyncTab';
import SettingsAccountingTab from '@/components/settings/SettingsAccountingTab';
import SettingsUsersTab from '@/components/settings/SettingsUsersTab';
import SettingsCin7Tab from '@/components/settings/SettingsCin7Tab';
import SettingsShopifyTab from '@/components/settings/SettingsShopifyTab';
import SettingsProductionTab from '@/components/settings/SettingsProductionTab';
import SettingsAlertsTab from '@/components/settings/SettingsAlertsTab';
import SettingsUomTab from '@/components/settings/SettingsUomTab';
import SettingsPackingMaterialsTab from '@/components/settings/SettingsPackingMaterialsTab';
import SettingsCategoriesTab from '@/components/settings/SettingsCategoriesTab';
import SettingsPurchasingTab from '@/components/settings/SettingsPurchasingTab';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

export default function SettingsPage() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration, integrations, and data import</p>
      </div>

      {/* Android App download */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Android App (Floor Tablet)</h3>
        </div>
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Download the Android app (APK)</p>
            <p className="text-xs text-muted-foreground max-w-md">
              Install the native app on your floor tablet instead of using the web version.
              Open this page on the tablet and tap Download, or send the link to the device.
            </p>
            <p className="text-xs text-muted-foreground">Build {REQUIRED_NATIVE_BUILD}</p>
          </div>
          <a
            href={LATEST_APK_URL}
            download
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition shrink-0"
          >
            <Download className="w-4 h-4" />
            Download APK
          </a>
        </div>
      </div>

      <Tabs defaultValue="org">
        <TabsList>
          <TabsTrigger value="org" className="gap-1.5"><Building2 className="w-3.5 h-3.5" />Organisation</TabsTrigger>
          <TabsTrigger value="accounting" className="gap-1.5"><Calculator className="w-3.5 h-3.5" />Accounting</TabsTrigger>
          {perms.user_management && <TabsTrigger value="users" className="gap-1.5"><Users className="w-3.5 h-3.5" />Users &amp; Roles</TabsTrigger>}
          <TabsTrigger value="team" className="gap-1.5"><UserCog className="w-3.5 h-3.5" />Production Team</TabsTrigger>
          {perms.category_manage && <TabsTrigger value="categories" className="gap-1.5"><FolderTree className="w-3.5 h-3.5" />Categories</TabsTrigger>}
          <TabsTrigger value="uom" className="gap-1.5"><Ruler className="w-3.5 h-3.5" />Units</TabsTrigger>
          <TabsTrigger value="packing" className="gap-1.5"><Package className="w-3.5 h-3.5" />Packing Materials</TabsTrigger>
          <TabsTrigger value="purchasing" className="gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />Purchasing</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5"><Bell className="w-3.5 h-3.5" />Alerts</TabsTrigger>
          <TabsTrigger value="shopify" className="gap-1.5"><ShoppingBag className="w-3.5 h-3.5" />Shopify</TabsTrigger>
          <TabsTrigger value="cin7" className="gap-1.5"><Database className="w-3.5 h-3.5" />Cin7 Import</TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Sync &amp; Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="mt-4"><SettingsOrgTab /></TabsContent>
        <TabsContent value="accounting" className="mt-4"><SettingsAccountingTab /></TabsContent>
        {perms.user_management && <TabsContent value="users" className="mt-4"><SettingsUsersTab /></TabsContent>}
        <TabsContent value="team" className="mt-4"><SettingsProductionTab /></TabsContent>
        {perms.category_manage && <TabsContent value="categories" className="mt-4"><SettingsCategoriesTab /></TabsContent>}
        <TabsContent value="uom" className="mt-4"><SettingsUomTab /></TabsContent>
        <TabsContent value="packing" className="mt-4"><SettingsPackingMaterialsTab /></TabsContent>
        <TabsContent value="purchasing" className="mt-4"><SettingsPurchasingTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><SettingsAlertsTab /></TabsContent>
        <TabsContent value="shopify" className="mt-4"><SettingsShopifyTab /></TabsContent>
        <TabsContent value="cin7" className="mt-4"><SettingsCin7Tab /></TabsContent>
        <TabsContent value="sync" className="mt-4"><SettingsSyncTab /></TabsContent>
      </Tabs>
    </div>
  );
}
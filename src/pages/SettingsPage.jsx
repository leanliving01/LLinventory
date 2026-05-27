import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Database, Building2, Bell, Ruler, Package, UserCog, FolderTree, ShoppingBag, RefreshCw, Percent } from 'lucide-react';
import SettingsOrgTab from '@/components/settings/SettingsOrgTab';
import SettingsSyncTab from '@/components/settings/SettingsSyncTab';
import SettingsTaxRatesTab from '@/components/settings/SettingsTaxRatesTab';
import SettingsUsersTab from '@/components/settings/SettingsUsersTab';
import SettingsCin7Tab from '@/components/settings/SettingsCin7Tab';
import SettingsShopifyTab from '@/components/settings/SettingsShopifyTab';
import SettingsProductionTab from '@/components/settings/SettingsProductionTab';
import SettingsAlertsTab from '@/components/settings/SettingsAlertsTab';
import SettingsUomTab from '@/components/settings/SettingsUomTab';
import SettingsPackingMaterialsTab from '@/components/settings/SettingsPackingMaterialsTab';
import SettingsCategoriesTab from '@/components/settings/SettingsCategoriesTab';
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
      <Tabs defaultValue="org">
        <TabsList>
          <TabsTrigger value="org" className="gap-1.5"><Building2 className="w-3.5 h-3.5" />Organisation</TabsTrigger>
          <TabsTrigger value="tax" className="gap-1.5"><Percent className="w-3.5 h-3.5" />Tax Rates</TabsTrigger>
          {perms.user_management && <TabsTrigger value="users" className="gap-1.5"><Users className="w-3.5 h-3.5" />Users &amp; Roles</TabsTrigger>}
          <TabsTrigger value="team" className="gap-1.5"><UserCog className="w-3.5 h-3.5" />Production Team</TabsTrigger>
          {perms.category_manage && <TabsTrigger value="categories" className="gap-1.5"><FolderTree className="w-3.5 h-3.5" />Categories</TabsTrigger>}
          <TabsTrigger value="uom" className="gap-1.5"><Ruler className="w-3.5 h-3.5" />Units</TabsTrigger>
          <TabsTrigger value="packing" className="gap-1.5"><Package className="w-3.5 h-3.5" />Packing Materials</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5"><Bell className="w-3.5 h-3.5" />Alerts</TabsTrigger>
          <TabsTrigger value="shopify" className="gap-1.5"><ShoppingBag className="w-3.5 h-3.5" />Shopify</TabsTrigger>
          <TabsTrigger value="cin7" className="gap-1.5"><Database className="w-3.5 h-3.5" />Cin7 Import</TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Sync &amp; Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="mt-4"><SettingsOrgTab /></TabsContent>
        <TabsContent value="tax" className="mt-4"><SettingsTaxRatesTab /></TabsContent>
        {perms.user_management && <TabsContent value="users" className="mt-4"><SettingsUsersTab /></TabsContent>}
        <TabsContent value="team" className="mt-4"><SettingsProductionTab /></TabsContent>
        {perms.category_manage && <TabsContent value="categories" className="mt-4"><SettingsCategoriesTab /></TabsContent>}
        <TabsContent value="uom" className="mt-4"><SettingsUomTab /></TabsContent>
        <TabsContent value="packing" className="mt-4"><SettingsPackingMaterialsTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><SettingsAlertsTab /></TabsContent>
        <TabsContent value="shopify" className="mt-4"><SettingsShopifyTab /></TabsContent>
        <TabsContent value="cin7" className="mt-4"><SettingsCin7Tab /></TabsContent>
        <TabsContent value="sync" className="mt-4"><SettingsSyncTab /></TabsContent>
      </Tabs>
    </div>
  );
}
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings as SettingsIcon, Users, Database, Download, Building2, ChefHat, Bell, Ruler, Truck, Package } from 'lucide-react';
import SettingsOrgTab from '@/components/settings/SettingsOrgTab';
import SettingsUsersTab from '@/components/settings/SettingsUsersTab';
import SettingsCin7Tab from '@/components/settings/SettingsCin7Tab';
import SettingsImportLogTab from '@/components/settings/SettingsImportLogTab';
import SettingsProductionTab from '@/components/settings/SettingsProductionTab';
import SettingsAlertsTab from '@/components/settings/SettingsAlertsTab';
import SettingsUomTab from '@/components/settings/SettingsUomTab';
import SettingsDispatchTab from '@/components/settings/SettingsDispatchTab';
import SettingsPackingMaterialsTab from '@/components/settings/SettingsPackingMaterialsTab';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration, integrations, and data import</p>
      </div>
      <Tabs defaultValue="org">
        <TabsList>
          <TabsTrigger value="org" className="gap-1.5"><Building2 className="w-3.5 h-3.5" />Organisation</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="w-3.5 h-3.5" />Users</TabsTrigger>
          <TabsTrigger value="cin7" className="gap-1.5"><Database className="w-3.5 h-3.5" />Cin7 Import</TabsTrigger>
          <TabsTrigger value="production" className="gap-1.5"><ChefHat className="w-3.5 h-3.5" />Production</TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5"><Download className="w-3.5 h-3.5" />Import Log</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5"><Bell className="w-3.5 h-3.5" />Alerts</TabsTrigger>
          <TabsTrigger value="uom" className="gap-1.5"><Ruler className="w-3.5 h-3.5" />Units</TabsTrigger>
          <TabsTrigger value="dispatch" className="gap-1.5"><Truck className="w-3.5 h-3.5" />Dispatch Team</TabsTrigger>
          <TabsTrigger value="packing" className="gap-1.5"><Package className="w-3.5 h-3.5" />Packing Materials</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="mt-4"><SettingsOrgTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><SettingsUsersTab /></TabsContent>
        <TabsContent value="production" className="mt-4"><SettingsProductionTab /></TabsContent>
        <TabsContent value="cin7" className="mt-4"><SettingsCin7Tab /></TabsContent>
        <TabsContent value="logs" className="mt-4"><SettingsImportLogTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><SettingsAlertsTab /></TabsContent>
        <TabsContent value="uom" className="mt-4"><SettingsUomTab /></TabsContent>
        <TabsContent value="dispatch" className="mt-4"><SettingsDispatchTab /></TabsContent>
        <TabsContent value="packing" className="mt-4"><SettingsPackingMaterialsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
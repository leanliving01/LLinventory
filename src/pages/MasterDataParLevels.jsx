import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ParLevelsTab from '@/components/master-data/ParLevelsTab';
import ParRecommendationsTab from '@/components/master-data/ParRecommendationsTab';
import ParPackagingRecommendations from '@/components/master-data/ParPackagingRecommendations';

export default function MasterDataParLevels() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Par Levels</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Set minimum stock thresholds and view AI-recommended adjustments</p>
      </div>
      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">Current Par Levels</TabsTrigger>
          <TabsTrigger value="recommendations">Meal Recommendations</TabsTrigger>
          <TabsTrigger value="packaging">Packaging Recommendations</TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="mt-4">
          <ParLevelsTab />
        </TabsContent>
        <TabsContent value="recommendations" className="mt-4">
          <ParRecommendationsTab />
        </TabsContent>
        <TabsContent value="packaging" className="mt-4">
          <ParPackagingRecommendations />
        </TabsContent>
      </Tabs>
    </div>
  );
}
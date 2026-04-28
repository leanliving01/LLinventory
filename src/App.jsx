import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import ProductionPlanning from '@/pages/ProductionPlanning';
import NewProduction from '@/pages/NewProduction';
import StockTake from '@/pages/StockTake';
import ShopifySync from '@/pages/ShopifySync';
import MasterDataMeals from '@/pages/MasterDataMeals';
import MasterDataSKUs from '@/pages/MasterDataSKUs';
import MasterDataParLevels from '@/pages/MasterDataParLevels';
import MasterDataPackages from '@/pages/MasterDataPackages';
import MasterDataBOM from '@/pages/MasterDataBOM';
import Reports from '@/pages/Reports';
import DemandAudit from '@/pages/DemandAudit';
import ProductionRuns from '@/pages/ProductionRuns';
import PlanRunReview from '@/pages/PlanRunReview';
import ProductionRunDetail from '@/pages/ProductionRunDetail';
import Wastage from '@/pages/Wastage';
import Settings from '@/pages/Settings';
import SettingsPage from '@/pages/SettingsPage';
import Catalog from '@/pages/Catalog';
import ProductEdit from '@/pages/ProductEdit';
import Recipes from '@/pages/Recipes';
import Suppliers from '@/pages/Suppliers';
import StockTransfer from '@/pages/StockTransfer';
import Receiving from '@/pages/Receiving';
import StockTakeNew from '@/pages/StockTakeNew';
import PickList from '@/pages/PickList';
import Kanban from '@/pages/Kanban';
import Kitchen from '@/pages/Kitchen';
import KitchenSettings from '@/pages/KitchenSettings';
import TeamPerformance from '@/pages/TeamPerformance';
import PurchaseOrders from '@/pages/PurchaseOrders';
import POSettings from '@/pages/POSettings';
import ReorderReport from '@/pages/ReorderReport';
import XeroCallback from '@/pages/XeroCallback';
import Sales from '@/pages/Sales';
import Customers from '@/pages/Customers';
import EquipmentManager from '@/pages/EquipmentManager';
import TrendForecasting from '@/pages/TrendForecasting';
import FloorLayout from '@/components/floor/FloorLayout';
import FloorHome from '@/pages/floor/FloorHome';
import FloorScan from '@/pages/floor/FloorScan';
import FloorTasks from '@/pages/floor/FloorTasks';
import FloorPick from '@/pages/floor/FloorPick';
import FloorStockTake from '@/pages/floor/FloorStockTake';
import FloorTransfer from '@/pages/floor/FloorTransfer';
import FloorReceive from '@/pages/floor/FloorReceive';
import FloorPack from '@/pages/floor/FloorPack';

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  // Floor-only roles go straight to /floor
  const FLOOR_ROLES = ['kitchen', 'picker_packer', 'stock_controller'];
  const isFloorUser = FLOOR_ROLES.includes(user?.role);

  return (
    <Routes>
      {/* Xero OAuth callback — no sidebar */}
      <Route path="/XeroCallback" element={<XeroCallback />} />

      {/* Kitchen tablet routes — no sidebar (legacy, still accessible) */}
      <Route path="/kitchen" element={<Kitchen />} />
      <Route path="/kitchen/settings" element={<KitchenSettings />} />

      {/* Floor Workspace — mobile-first, no sidebar */}
      <Route element={<FloorLayout />}>
        <Route path="/floor" element={<FloorHome />} />
        <Route path="/floor/tasks" element={<FloorTasks />} />
        <Route path="/floor/pick" element={<FloorPick />} />
        <Route path="/floor/stock-take" element={<FloorStockTake />} />
        <Route path="/floor/transfer" element={<FloorTransfer />} />
        <Route path="/floor/receive" element={<FloorReceive />} />
        <Route path="/floor/pack" element={<FloorPack />} />
        <Route path="/floor/scan" element={<FloorScan />} />
      </Route>

      <Route element={<AppLayout />}>
        <Route path="/" element={isFloorUser ? <Navigate to="/floor" replace /> : <Dashboard />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/catalog/:productId" element={<ProductEdit />} />
        <Route path="/recipes" element={<Recipes />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchasing/orders" element={<PurchaseOrders />} />
        <Route path="/purchasing/settings" element={<POSettings />} />
        <Route path="/purchasing/reorder" element={<ReorderReport />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/equipment" element={<EquipmentManager />} />
        <Route path="/production" element={<ProductionPlanning />} />
        <Route path="/production/runs" element={<ProductionRuns />} />
        <Route path="/production/plan-review" element={<PlanRunReview />} />
        <Route path="/production/run/:runId" element={<ProductionRunDetail />} />
        <Route path="/production/run/:runId/pick-list" element={<PickList />} />
        <Route path="/production/run/:runId/kanban" element={<Kanban />} />
        <Route path="/stock/new-production" element={<NewProduction />} />
        <Route path="/stock/wastage" element={<Wastage />} />
        <Route path="/stock/stock-take" element={<StockTakeNew />} />
        <Route path="/stock/stock-take-legacy" element={<StockTake />} />
        <Route path="/stock/transfer" element={<StockTransfer />} />
        <Route path="/stock/receive" element={<Receiving />} />
        <Route path="/shopify" element={<ShopifySync />} />
        <Route path="/master-data/meals" element={<MasterDataMeals />} />
        <Route path="/master-data/skus" element={<MasterDataSKUs />} />
        <Route path="/master-data/par-levels" element={<MasterDataParLevels />} />
        <Route path="/master-data/packages" element={<MasterDataPackages />} />
        <Route path="/master-data/bom" element={<MasterDataBOM />} />
        <Route path="/demand" element={<DemandAudit />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/team" element={<TeamPerformance />} />
        <Route path="/reports/forecasting" element={<TrendForecasting />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* Redirects for old routes */}
        <Route path="/stock" element={<Navigate to="/stock/new-production" replace />} />
        <Route path="/master-data" element={<Navigate to="/master-data/meals" replace />} />
      </Route>
      <Route path="/Dashboard" element={<Navigate to="/" replace />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
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
import MasterDataParLevels from '@/pages/MasterDataParLevels';
import Reports from '@/pages/Reports';

import ProductionRuns from '@/pages/ProductionRuns';
import PlanRunReview from '@/pages/PlanRunReview';
import ProductionRunDetail from '@/pages/ProductionRunDetail';
import RunCompletionReview from '@/pages/RunCompletionReview';
import Wastage from '@/pages/Wastage';
import Settings from '@/pages/Settings';
import SettingsPage from '@/pages/SettingsPage';
import SyncHistory from '@/pages/SyncHistory';
import Catalog from '@/pages/Catalog';
import ProductEdit from '@/pages/ProductEdit';
import Recipes from '@/pages/Recipes';
import RecipeDetail from '@/pages/RecipeDetail';
import Suppliers from '@/pages/Suppliers';
import StockTransfer from '@/pages/StockTransfer';
import Receiving from '@/pages/Receiving';
import StockTakeNew from '@/pages/StockTakeNew';
import StockMovements from '@/pages/StockMovements';
import PickList from '@/pages/PickList';
import Kanban from '@/pages/Kanban';
import Kitchen from '@/pages/Kitchen';
import KitchenSettings from '@/pages/KitchenSettings';
import TeamPerformance from '@/pages/TeamPerformance';
import PurchaseOrders from '@/pages/PurchaseOrders';
import POSettings from '@/pages/POSettings';
import ReorderReport from '@/pages/ReorderReport';
import PackBomManager from '@/pages/PackBomManager';
import PackBomDetail from '@/pages/PackBomDetail';
import InventoryOverview from '@/pages/InventoryOverview';
import XeroCallback from '@/pages/XeroCallback';
import Sales from '@/pages/Sales';
import Customers from '@/pages/Customers';
import EquipmentManager from '@/pages/EquipmentManager';
import Bugs from '@/pages/Bugs';
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
import Login from '@/pages/Login';
import CookingRuns from '@/pages/CookingRuns';
import WipInventory from '@/pages/WipInventory';
import WipPlanning from '@/pages/WipPlanning';
// Portioning is handled by ProductionTasks on the Kanban board
import YieldReview from '@/pages/YieldReview';
import SupplierYieldDashboard from '@/pages/SupplierYieldDashboard';
import SupplierProductCatalog from '@/pages/SupplierProductCatalog';
import GoodsReceivedNotes from '@/pages/GoodsReceivedNotes';
import SupplierShortages from '@/pages/SupplierShortages';
import SupplierReturns from '@/pages/SupplierReturns';
import SupplierCreditsReturns from '@/pages/SupplierCreditsReturns';
import PurchaseInvoices from '@/pages/PurchaseInvoices';
import ProductReviewQueue from '@/pages/ProductReviewQueue';
import PriceVarianceDashboard from '@/pages/PriceVarianceDashboard';
import ThreeWayMatch from '@/pages/ThreeWayMatch';
import PurchasingDashboard from '@/pages/PurchasingDashboard';
import PurchaseWorkspace from '@/pages/PurchaseWorkspace';
import POWorkspace from '@/components/purchasing/POWorkspace';
import FoodCostDashboard from '@/pages/FoodCostDashboard';
import SupplierScorecard from '@/pages/SupplierScorecard';
import ActivityLog from '@/pages/ActivityLog';
import StockWriteOffs from '@/pages/StockWriteOffs';
import ConnectionWatchdog from '@/components/layout/ConnectionWatchdog';
import SessionBanner from '@/components/layout/SessionBanner';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import NativeUpdateGate from '@/components/layout/NativeUpdateGate';

function NativeAppRoleError() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto">
        <span className="text-2xl font-black text-primary-foreground">LL</span>
      </div>
      <div>
        <h2 className="text-xl font-bold">Floor App Only</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          This app is for floor staff. Management access is available at the web dashboard.
        </p>
      </div>
      <button onClick={logout} className="text-sm text-primary underline">Sign out</button>
    </div>
  );
}

// Detect if running inside Capacitor (native Android/iOS app)
function getIsNativeApp() {
  try {
    // Capacitor sets window.Capacitor when running natively
    return !!(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}
const IS_NATIVE_APP = getIsNativeApp();

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isFloorUser } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  // Not logged in — show login page
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
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

  // In the native Android app, non-floor users see a clear error rather than management screens
  if (IS_NATIVE_APP && !isFloorUser) {
    return <NativeAppRoleError />;
  }

  // In native app: only expose floor routes
  if (IS_NATIVE_APP) {
    return (
      <Routes>
        <Route element={<FloorLayout />}>
          <Route path="/" element={<Navigate to="/floor" replace />} />
          <Route path="/floor" element={<FloorHome />} />
          <Route path="/floor/tasks" element={<FloorTasks />} />
          <Route path="/floor/pick" element={<FloorPick />} />
          <Route path="/floor/stock-take" element={<FloorStockTake />} />
          <Route path="/floor/transfer" element={<FloorTransfer />} />
          <Route path="/floor/receive" element={<FloorReceive />} />
          <Route path="/floor/pack" element={<FloorPack />} />
          <Route path="/floor/scan" element={<FloorScan />} />
        </Route>
        <Route path="*" element={<Navigate to="/floor" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Xero OAuth callback — no sidebar */}
      <Route path="/xero-callback" element={<XeroCallback />} />

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
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/catalog/:productId" element={<ProductEdit />} />
        <Route path="/recipes" element={<Recipes />} />
        <Route path="/recipes/:bomId" element={<RecipeDetail />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchasing/orders" element={<ErrorBoundary><PurchaseOrders /></ErrorBoundary>} />
        <Route path="/purchasing/purchase-orders/:poId" element={<ErrorBoundary><POWorkspace /></ErrorBoundary>} />
        <Route path="/purchasing/settings" element={<POSettings />} />
        <Route path="/purchasing/reorder" element={<ReorderReport />} />
        <Route path="/purchasing/supplier-products" element={<SupplierProductCatalog />} />
        <Route path="/purchasing/grn" element={<ErrorBoundary><GoodsReceivedNotes /></ErrorBoundary>} />
        <Route path="/purchasing/shortages" element={<SupplierShortages />} />
        <Route path="/purchasing/returns" element={<SupplierReturns />} />
        <Route path="/purchasing/credits-returns" element={<ErrorBoundary><SupplierCreditsReturns /></ErrorBoundary>} />
        <Route path="/purchasing/invoices" element={<PurchaseInvoices />} />
        <Route path="/purchasing/review-queue" element={<ProductReviewQueue />} />
        <Route path="/purchasing/price-variance" element={<PriceVarianceDashboard />} />
        <Route path="/purchasing/three-way-match" element={<ThreeWayMatch />} />
        <Route path="/purchasing/dashboard" element={<PurchasingDashboard />} />
        <Route path="/purchasing/workspace/:id" element={<PurchaseWorkspace />} />
        <Route path="/purchasing/scorecard" element={<SupplierScorecard />} />
        <Route path="/purchasing/pack-bom" element={<PackBomManager />} />
        <Route path="/purchasing/pack-bom/:packBomId" element={<PackBomDetail />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/equipment" element={<EquipmentManager />} />
        <Route path="/bugs" element={<Bugs />} />
        <Route path="/production" element={<ProductionPlanning />} />
        <Route path="/production/runs" element={<ProductionRuns />} />
        <Route path="/production/plan-review" element={<PlanRunReview />} />
        <Route path="/production/run/:runId" element={<ProductionRunDetail />} />
        <Route path="/production/run/:runId/complete" element={<RunCompletionReview />} />
        <Route path="/production/run/:runId/pick-list" element={<PickList />} />
        <Route path="/production/run/:runId/kanban" element={<Kanban />} />
        <Route path="/production/cooking" element={<CookingRuns />} />
        <Route path="/production/wip" element={<WipInventory />} />
        <Route path="/production/wip-planning" element={<WipPlanning />} />
        {/* Portioning removed — handled by ProductionTasks on the Kanban */}
        <Route path="/production/yield-review" element={<YieldReview />} />
        <Route path="/production/supplier-yield" element={<SupplierYieldDashboard />} />
        <Route path="/stock/new-production" element={<Navigate to="/production/runs" replace />} />
        <Route path="/stock/wastage" element={<Wastage />} />
        <Route path="/stock/write-offs" element={<StockWriteOffs />} />
        <Route path="/stock/stock-take" element={<StockTakeNew />} />
        <Route path="/stock/overview" element={<InventoryOverview />} />
        <Route path="/stock/movements" element={<StockMovements />} />
        <Route path="/stock/stock-take-legacy" element={<StockTake />} />
        <Route path="/stock/transfer" element={<StockTransfer />} />
        <Route path="/stock/receive" element={<Receiving />} />
        <Route path="/shopify" element={<ShopifySync />} />
        <Route path="/stock/par-levels" element={<MasterDataParLevels />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/team" element={<TeamPerformance />} />
        <Route path="/reports/forecasting" element={<TrendForecasting />} />
        <Route path="/reports/food-cost" element={<FoodCostDashboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/sync-history" element={<SyncHistory />} />
        <Route path="/activity-log" element={<ActivityLog />} />
        {/* Redirects for old routes */}
        <Route path="/stock" element={<Navigate to="/stock/receive" replace />} />
        <Route path="/master-data" element={<Navigate to="/catalog" replace />} />
        <Route path="/master-data/par-levels" element={<Navigate to="/stock/par-levels" replace />} />
        <Route path="/demand" element={<Navigate to="/" replace />} />
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
        <NativeUpdateGate>
          <SessionBanner />
          <Router>
            <AuthenticatedApp />
          </Router>
          <ConnectionWatchdog />
          <Toaster />
          <SonnerToaster />
        </NativeUpdateGate>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useParams, useNavigate } from "react-router-dom";
import { TelegramAuthProvider } from "@/components/TelegramAuthProvider";
import { CartProvider } from "@/contexts/CartContext";
import { FavoritesProvider } from "@/components/FavoritesContext";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import Index from "./pages/Index";
import SupplierRegistration from "./pages/SupplierRegistration";
import SupplierDashboard from "./pages/SupplierDashboard";
import ProductDetail from "./pages/ProductDetail";
import SearchResults from "./pages/SearchResults";
import Manager from "./pages/Manager";
import AdminDashboard from "./pages/AdminDashboard";
import Suppliers from "./pages/Suppliers";
import SupplierProfile from "./pages/SupplierProfile";
import Support from "./pages/Support";
import Promos from "./pages/Promos";
import ModeratorPanel from "./pages/ModeratorPanel";
import Referrals from "./pages/Referrals";
import StoreManagement from "./pages/StoreManagement";
import SupplierStoreOrders from "./pages/SupplierStoreOrders";
import OrdersHistoryPage from "./pages/OrdersHistoryPage";
import SupplierStoreOrdersHistory from "./pages/SupplierStoreOrdersHistory";
import MyShops from "./pages/MyShops";
import ManagerChats from "./pages/ManagerChats";
import WalletAccount from "./pages/WalletAccount";
import SupportChat from "./components/SupportChat";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import Login from "./pages/Login";
import { AppBackProvider } from "@/hooks/useAppBack";
import Ratings from "./pages/Ratings";
import { FloatingDevRoleSwitcher } from "@/components/dev/FloatingDevRoleSwitcher";
import { FloatingBonusWidget } from "@/components/promos/FloatingBonusWidget";
import { FloatingToolsProvider } from "@/components/floating/FloatingToolsContext";
import { AIChatAssistant } from "@/components/AIChatAssistant";
import { FloatingSupportWidget } from "@/components/floating/FloatingSupportWidget";
import { SupplierImportProgress } from "@/components/supplier/SupplierImportProgress";

const queryClient = new QueryClient();

/** Старий маршрут рахунку магазину → єдиний рахунок */
function ShopWalletRedirect() {
  const { supplierId } = useParams();
  return <Navigate to={supplierId ? `/wallet/${supplierId}` : "/wallet"} replace />;
}

// Page transition variants
const pageVariants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransition = {
  type: "tween" as const,
  ease: "easeInOut" as const,
  duration: 0.2,
};

function TelegramStartParamRouter() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const fromTg = tg?.initDataUnsafe?.start_param as string | undefined;
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get("startapp") || params.get("supplier");
    const raw = String(fromTg || fromQuery || "");
    const match = raw.match(/admin_supplier_(\d+)/);
    if (!match) return;
    const id = match[1];
    const target = `/admin-dashboard?supplier=${id}`;
    if (location.pathname !== "/admin-dashboard" || params.get("supplier") !== id) {
      navigate(target, { replace: true });
    }
  }, [navigate, location.pathname, location.search]);

  return null;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AppBackProvider>
      <TelegramStartParamRouter />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial="initial"
          animate="enter"
          exit="exit"
          variants={pageVariants}
          transition={pageTransition}
          className="min-h-screen pb-safe w-full max-w-[100vw]"
        >
          <Routes location={location}>
            <Route path="/" element={<Index />} />
            <Route path="/ratings" element={<Ratings />} />
            <Route path="/partner" element={<SupplierRegistration />} />
            <Route path="/supplier" element={<SupplierDashboard />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/manager" element={<Manager />} />
            <Route path="/admin-dashboard" element={<AdminDashboard />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/supplier/:id" element={<SupplierProfile />} />
            <Route path="/support" element={<Support />} />
            <Route path="/support/chat/:ticketId" element={<SupportChat />} />
            <Route path="/promos" element={<Promos />} />
            <Route path="/moderator" element={<ModeratorPanel />} />
            <Route path="/referrals" element={<Referrals />} />
            <Route path="/personal-bonuses" element={<Navigate to="/wallet" replace />} />
            <Route path="/bonus-account" element={<Navigate to="/wallet" replace />} />
            <Route path="/wallet" element={<WalletAccount />} />
            <Route path="/wallet/:supplierId" element={<WalletAccount />} />
            <Route path="/store-management" element={<StoreManagement />} />
            <Route path="/store-management/:supplierId" element={<StoreManagement />} />
            <Route path="/store-orders" element={<SupplierStoreOrders />} />
            <Route path="/store-orders/:supplierId" element={<SupplierStoreOrders />} />
            <Route path="/my-shops" element={<MyShops />} />
            <Route path="/manager-chats" element={<ManagerChats />} />
            <Route path="/supplier-balance" element={<Navigate to="/wallet" replace />} />
            <Route path="/supplier-balance/:supplierId" element={<ShopWalletRedirect />} />
            <Route path="/orders-history" element={<OrdersHistoryPage />} />
            <Route path="/store-orders-history" element={<SupplierStoreOrdersHistory />} />
            <Route path="/store-orders-history/:supplierId" element={<SupplierStoreOrdersHistory />} />
            <Route path="/login" element={<Login />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </AppBackProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <TelegramAuthProvider>
        <CartProvider>
          <FavoritesProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <FloatingToolsProvider>
                <AnimatedRoutes />
                <AIChatAssistant />
                <FloatingSupportWidget />
                <FloatingBonusWidget />
                <FloatingDevRoleSwitcher />
                <SupplierImportProgress />
              </FloatingToolsProvider>
            </BrowserRouter>

          </FavoritesProvider>
        </CartProvider>
      </TelegramAuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
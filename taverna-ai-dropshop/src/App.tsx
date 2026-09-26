import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useParams, useNavigate } from "react-router-dom";
import { TelegramAuthProvider } from "@/components/TelegramAuthProvider";
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
import StoreManagers from "./pages/StoreManagers";
import Cart from "./pages/Cart";
import ShopBonuses from "./pages/ShopBonuses";
import ShopRating from "./pages/ShopRating";
import ManagerChats from "./pages/ManagerChats";
import SupportPanel from "./pages/SupportPanel";
import WalletAccount from "./pages/WalletAccount";
import SupportChat from "./components/SupportChat";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import Login from "./pages/Login";
import { AppBackProvider } from "@/hooks/useAppBack";
import { TelegramUIBridge } from "@/hooks/useTelegramUI";
import Ratings from "./pages/Ratings";
import { FloatingDevRoleSwitcher } from "@/components/dev/FloatingDevRoleSwitcher";
import { FloatingToolsProvider } from "@/components/floating/FloatingToolsContext";
import { FloatingToolsContainer } from "@/components/floating/FloatingToolsContainer";
import { GlobalAIWidget } from "@/components/supplier/GlobalAIWidget";

const queryClient = new QueryClient();

/** Старий маршрут рахунку магазину → єдиний рахунок */
function ShopWalletRedirect() {
  const { supplierId } = useParams();
  return <Navigate to={supplierId ? `/wallet/${supplierId}` : "/wallet"} replace />;
}

/** /supplier/{id}/reviews → профіль магазину одразу на вкладці «Відгуки» */
function ShopReviewsRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/supplier/${id}?tab=reviews` : "/suppliers"} replace />;
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
      <TelegramUIBridge>
      <TelegramStartParamRouter />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial="initial"
          animate="enter"
          exit="exit"
          variants={pageVariants}
          transition={pageTransition}
          className="min-h-screen pb-safe w-full max-w-[100vw] bg-tg-bg text-tg-text"
        >
          <Routes location={location}>
            <Route path="/" element={<Index />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/ratings" element={<Ratings />} />
            <Route path="/partner" element={<SupplierRegistration />} />
            <Route path="/supplier" element={<SupplierDashboard />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/catalog" element={<SearchResults />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/manager" element={<Manager />} />
            <Route path="/admin-dashboard" element={<AdminDashboard />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/supplier/:id" element={<SupplierProfile />} />
            {/* Міні-іконки картки магазину: бонуси / рейтинг / відгуки */}
            <Route path="/supplier/:id/bonuses" element={<ShopBonuses />} />
            {/* Рейтинг конкретного магазину (іконки Trophy / ThumbsUp) */}
            <Route path="/supplier/:id/rating" element={<ShopRating />} />
            <Route path="/supplier/:id/reviews" element={<ShopReviewsRedirect />} />
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
            {/* Менеджери магазину: інвайт-посилання + RBAC-контракти (лише власник) */}
            <Route path="/store-managers/:supplierId" element={<StoreManagers />} />
            <Route path="/store-orders" element={<SupplierStoreOrders />} />
            <Route path="/store-orders/:supplierId" element={<SupplierStoreOrders />} />
            <Route path="/my-shops" element={<MyShops />} />
            <Route path="/manager-chats" element={<ManagerChats />} />
            {/* B2B Панель Підтримки: тікети клієнтів + AI-резюме (менеджер/власник) */}
            <Route path="/support/panel" element={<SupportPanel />} />
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
      </TelegramUIBridge>
    </AppBackProvider>
  );
}

function GlobalFloatingWidgets() {
  const location = useLocation();
  const hideGlobalButtons =
    location.pathname.includes("/product/") ||
    location.pathname.includes("/supplier/");

  if (hideGlobalButtons) return null;

  return (
    <>
      <FloatingToolsContainer />
      <FloatingDevRoleSwitcher />
      <GlobalAIWidget />
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <TelegramAuthProvider>
        <FavoritesProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <FloatingToolsProvider>
              <AnimatedRoutes />
              <GlobalFloatingWidgets />
            </FloatingToolsProvider>
          </BrowserRouter>
        </FavoritesProvider>
      </TelegramAuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
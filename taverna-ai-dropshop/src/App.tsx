import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useParams } from "react-router-dom";
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
import WalletAccount from "./pages/WalletAccount";
import SupportChat from "./components/SupportChat";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import Login from "./pages/Login";
import { FloatingDevRoleSwitcher } from "@/components/dev/FloatingDevRoleSwitcher";
import { FloatingBonusWidget } from "@/components/promos/FloatingBonusWidget";

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

// Telegram BackButton handler
function TelegramBackButton() {
  const location = useLocation();

  useEffect(() => {
    // Access Telegram WebApp without strict typing
    const telegram = (window as any).Telegram;
    const tg = telegram?.WebApp;
    const backButton = tg?.BackButton;
    
    if (!backButton) return;

    // Main tabs where back button should be hidden
    const mainRoutes = ['/', '/search', '/promos', '/support'];
    const isMainRoute = mainRoutes.includes(location.pathname);

    if (isMainRoute) {
      backButton.hide?.();
    } else {
      backButton.show?.();
      const handleBack = () => window.history.back();
      backButton.onClick?.(handleBack);
      
      return () => {
        backButton.offClick?.(handleBack);
      };
    }
  }, [location.pathname]);

  return null;
}

// Animated Routes wrapper
function AnimatedRoutes() {
  const location = useLocation();

  return (
    <>
      <TelegramBackButton />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial="initial"
          animate="enter"
          exit="exit"
          variants={pageVariants}
          transition={pageTransition}
          className="min-h-screen pb-safe"
        >
          <Routes location={location}>
            <Route path="/" element={<Index />} />
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
    </>
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
              <AnimatedRoutes />
              <FloatingBonusWidget />
              <FloatingDevRoleSwitcher />
            </BrowserRouter>

          </FavoritesProvider>
        </CartProvider>
      </TelegramAuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
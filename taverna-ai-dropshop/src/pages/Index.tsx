import { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Shield, Shirt, Watch, Footprints, ChevronRight, LogOut, Loader2 } from "lucide-react";
import { AIChatAssistant } from "@/components/AIChatAssistant";
import { Header } from "@/components/Header";
import { BottomNavigation } from "@/components/BottomNavigation";
import { ProductCard } from "@/components/ProductCard";
import { CategoryCard } from "@/components/CategoryCard";
import { LiveFeedItem } from "@/components/LiveFeedItem";
import { PartnerBanner } from "@/components/PartnerBanner";
import { PromoCard } from "@/components/PromoCard";
import { PromoHeroBanner } from "@/components/PromoHeroBanner";
import { SearchModal } from "@/components/SearchModal";
import { CartModal } from "@/components/CartModal";
import { CheckoutModal } from "@/components/CheckoutModal";
import { AllCategoriesModal } from "@/components/AllCategoriesModal";
import { WishlistModal } from "@/components/WishlistModal";
import { OrdersHistory } from "@/components/OrdersHistory";
import { ProfileDashboard } from "@/components/profile/ProfileDashboard";
import { LiveActivityFeed } from "@/components/LiveActivityFeed";
import { RatingsTab } from "@/components/RatingsTab";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { useProducts } from "@/hooks/useProducts";
import { toast } from "sonner";
import { getCategoryGradient } from "@/lib/categoryColors";
import { ProductGridSkeleton } from "@/components/ui/product-skeleton";

// Fallback product images
import tacticalGloves from "@/assets/products/tactical-gloves.jpg";
import tacticalShirt from "@/assets/products/tactical-shirt.jpg";
import tacticalBackpack from "@/assets/products/tactical-backpack.jpg";
import tacticalBoots from "@/assets/products/tactical-boots.jpg";

// Mock data for categories with icons
const categoryIcons: Record<string, React.ElementType> = {
  "Мілітарі": Shield,
  "Одяг": Shirt,
  "Аксесуари": Watch,
  "Взуття": Footprints,
};

// Fallback mock products
const fallbackProducts = [
  {
    id: "fallback-1",
    name: "Тактичні рукавички M-Pact чорні",
    price: 890,
    original_price: 1200,
    images: [tacticalGloves],
    category: { name: "Мілітарі" },
    in_stock: true,
  },
  {
    id: "fallback-2",
    name: "Футболка тактична Coolmax олива",
    price: 650,
    images: [tacticalShirt],
    category: { name: "Одяг" },
    in_stock: true,
  },
  {
    id: "fallback-3",
    name: "Рюкзак тактичний 35л мультикам",
    price: 2450,
    original_price: 2900,
    images: [tacticalBackpack],
    category: { name: "Сумки" },
    in_stock: true,
  },
  {
    id: "fallback-4",
    name: "Берці зимові Gore-Tex чорні",
    price: 4200,
    images: [tacticalBoots],
    category: { name: "Взуття" },
    in_stock: false,
  },
];

const liveFeed = [
  { type: "purchase" as const, username: "Олександр", amount: 2450, productName: "Рюкзак тактичний", timestamp: new Date(Date.now() - 5 * 60000) },
  { type: "registration" as const, username: "Марія", timestamp: new Date(Date.now() - 15 * 60000) },
  { type: "purchase" as const, username: "Дмитро", amount: 890, productName: "Тактичні рукавички", timestamp: new Date(Date.now() - 25 * 60000) },
  { type: "return" as const, username: "Іван", amount: 650, timestamp: new Date(Date.now() - 45 * 60000) },
  { type: "purchase" as const, username: "Анна", amount: 4200, productName: "Берці Gore-Tex", timestamp: new Date(Date.now() - 60 * 60000) },
];

const promos = [
  {
    id: "1",
    title: "Знижка -20% на все",
    description: "Для нових клієнтів при першому замовленні",
    type: "discount" as const,
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },
  {
    id: "2",
    title: "Запроси друга",
    description: "Отримай 100₴ бонусів за кожного запрошеного",
    type: "referral" as const,
  },
  {
    id: "3",
    title: "Flash Sale",
    description: "Знижки до 50% на обрані товари",
    type: "flash" as const,
    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
];

// Tab content components
const CatalogTab = ({ 
  onOpenAllCategories, 
  onProductClick,
  onAddToCart,
  onToggleFavorite,
  isFavorite,
  products,
  categories,
  isLoading,
  onViewAllProducts,
}: { 
  onOpenAllCategories: () => void; 
  onProductClick: (id: string) => void;
  onAddToCart: (product: any, size?: string, color?: string) => void;
  onToggleFavorite: (product: any) => void;
  isFavorite: (id: string) => boolean;
  products: any[];
  categories: any[];
  isLoading: boolean;
  onViewAllProducts: () => void;
}) => {
  const displayProducts = products.length > 0 ? products : fallbackProducts;
  
  return (
    <div className="space-y-6 pb-28 animate-fade-in">
      <PromoHeroBanner />

      {/* Categories */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-foreground">Категорії</h2>
          <button 
            onClick={onOpenAllCategories}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 active:scale-95 transition-all min-h-[36px]"
          >
            Всі <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(categories.length > 0 ? categories.slice(0, 4) : [
            { id: "1", name: "Мілітарі", product_count: 156 },
            { id: "2", name: "Одяг", product_count: 234 },
            { id: "3", name: "Аксесуари", product_count: 89 },
            { id: "4", name: "Взуття", product_count: 67 },
          ]).map((cat) => {
            const IconComponent = categoryIcons[cat.name] || Shield;
            // Use dynamic color based on category ID
            const dynamicGradient = getCategoryGradient(cat.id);
            return (
            <CategoryCard
              key={cat.id}
              name={cat.name}
              icon={IconComponent}
              count={cat.product_count || 0}
              gradient={dynamicGradient}
              onClick={() => toast.info(`Категорія: ${cat.name}`)}
            />
          );})}
        </div>
      </section>

      {/* Products */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-foreground">Популярні товари</h2>
          <button 
            onClick={onViewAllProducts}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 active:scale-95 transition-all min-h-[36px]"
          >
            Всі товари <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        
        {isLoading ? (
          <ProductGridSkeleton count={8} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {displayProducts.slice(0, 8).map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                name={product.name}
                price={product.price}
                originalPrice={product.original_price}
                image={product.images?.[0] || tacticalGloves}
                videoUrl={product.video_url}
                category={product.category?.name}
                inStock={product.in_stock !== false}
                stockQuantity={product.stock_quantity}
                sizes={product.sizes}
                colors={product.colors}
                rating={product.rating}
                reviewCount={product.review_count}
                isBoosted={product.is_boosted}
                viewsCount={product.views_count}
                isFavorite={isFavorite(product.id)}
                onClick={() => onProductClick(product.id)}
                onAddToCart={(size?: string, color?: string) => onAddToCart(product, size, color)}
                onToggleFavorite={() => onToggleFavorite(product)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const LiveTab = () => (
  <div className="space-y-4 pb-28 animate-fade-in">
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-bold text-foreground">Live Активність</h2>
      <span className="w-2 h-2 rounded-full bg-live animate-pulse-live" />
    </div>

    {/* Realtime feed with auto-refresh */}
    <LiveActivityFeed maxItems={15} autoRefresh={true} />
  </div>
);

const AccountTab = () => {
  return (
    <div className="space-y-4 pb-28 animate-fade-in">
      {/* Profile Dashboard with full functionality - no duplicate buttons */}
      <ProfileDashboard />
    </div>
  );
};

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useTelegramAuthContext();

  const getTabFromSearch = (search: string) => {
    const tab = new URLSearchParams(search).get("tab");
    return ["catalog", "live", "ratings", "account"].includes(tab || "") ? tab! : "catalog";
  };

  const [activeTab, setActiveTab] = useState(() => getTabFromSearch(location.search));
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAllCategoriesOpen, setIsAllCategoriesOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  
  // Use cart context for synchronized cart
  const { items: cartItems, totalItems, addItem, updateQuantity, removeItem, clearCart, fetchCart } = useCartContext();
  
  // Use favorites context
  const { isFavorite, toggleFavorite, totalFavorites } = useFavoritesContext();
  
  // Use products hook for real database products with Trending sort
  const { products, categories, isLoading, fetchProducts } = useProducts();
  
  // Fetch products sorted by trending on mount
  useEffect(() => {
    fetchProducts({ sortBy: 'trending', limit: 20 });
  }, [fetchProducts]);

  useEffect(() => {
    const tabFromUrl = getTabFromSearch(location.search);
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [location.search, activeTab]);

  const setMainTab = (tab: string) => {
    setActiveTab(tab);
    navigate(
      { pathname: "/", search: tab === "catalog" ? "" : `?tab=${tab}` },
      { replace: true }
    );
  };

  const handleSearch = (query: string) => {
    setIsSearchOpen(false);
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const handleUpdateQuantity = async (id: string, quantity: number) => {
    await updateQuantity(id, quantity);
  };

  const handleRemoveItem = async (id: string) => {
    const success = await removeItem(id);
    if (success) {
      toast.success("Товар видалено з кошика");
    }
  };

  const handleCheckout = () => {
    if (cartItems.length === 0) {
      toast.error("Кошик порожній");
      return;
    }
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  };

  const handleOrderComplete = async (orderId: string) => {
    setIsCheckoutOpen(false);
    await clearCart();
    await fetchCart();
    setMainTab("account");
    toast.success("Дякуємо за замовлення!");
  };

  const handleAddToCart = async (product: any, size?: string, color?: string) => {
    const success = await addItem(
      product.id,
      product.name,
      product.price,
      product.images?.[0] || product.image,
      size,
      color
    );
    if (success) {
      toast.success(`${product.name} додано до кошика`);
    }
  };

  const handleToggleFavorite = async (product: any) => {
    await toggleFavorite(
      product.id,
      product.name,
      product.price,
      product.images?.[0] || product.image
    );
  };

  const handleProductClick = (id: string) => {
    navigate(`/product/${id}`);
  };

  const handleSelectCategory = (categoryId: string, subcategoryId?: string) => {
    setIsAllCategoriesOpen(false);
    if (subcategoryId) {
      toast.info(`Підкатегорія: ${subcategoryId}`);
    } else {
      toast.info(`Категорія: ${categoryId}`);
    }
  };

  const handleTabChange = (tab: string) => {
    if (tab === "suppliers") {
      navigate("/suppliers");
    } else if (tab === "support") {
      navigate("/support");
    } else {
      setMainTab(tab);
    }
  };

  const handleViewAllProducts = () => {
    navigate('/search?all=true');
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "catalog":
        return (
          <CatalogTab 
            onOpenAllCategories={() => setIsAllCategoriesOpen(true)}
            onProductClick={handleProductClick}
            onAddToCart={handleAddToCart}
            onToggleFavorite={handleToggleFavorite}
            isFavorite={isFavorite}
            products={products}
            categories={categories}
            isLoading={isLoading}
            onViewAllProducts={handleViewAllProducts}
          />
        );
      case "live":
        return <LiveTab />;
      case "ratings":
        return <RatingsTab />;
      case "account":
        return <AccountTab />;
      default:
        return (
          <CatalogTab 
            onOpenAllCategories={() => setIsAllCategoriesOpen(true)}
            onProductClick={handleProductClick}
            onAddToCart={handleAddToCart}
            onToggleFavorite={handleToggleFavorite}
            isFavorite={isFavorite}
            products={products}
            categories={categories}
            isLoading={isLoading}
            onViewAllProducts={handleViewAllProducts}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header 
        cartCount={totalItems}
        favoritesCount={totalFavorites}
        onCartClick={() => setIsCartOpen(true)}
        onSearchClick={() => setIsSearchOpen(true)}
        onNotificationsClick={() => toast.info("Сповіщення")}
        onFavoritesClick={() => setIsWishlistOpen(true)}
        onPromoClick={() => navigate("/promos")}
        onRatingsClick={() => setMainTab("ratings")}
      />
      
      <main className="px-4 py-4">
        {renderTabContent()}
      </main>

      <BottomNavigation 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
      />

      {/* Modals */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSearch={handleSearch}
      />

      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onCheckout={handleCheckout}
      />

      <AllCategoriesModal
        isOpen={isAllCategoriesOpen}
        onClose={() => setIsAllCategoriesOpen(false)}
        onSelectCategory={handleSelectCategory}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        items={cartItems}
        onOrderComplete={handleOrderComplete}
      />

      <WishlistModal
        isOpen={isWishlistOpen}
        onClose={() => setIsWishlistOpen(false)}
        onProductClick={(id: string) => {
          setIsWishlistOpen(false);
          navigate(`/product/${id}`);
        }}
      />

      {/* AI Chat Assistant - Floating Button */}
      <AIChatAssistant />
    </div>
  );
};

export default Index;
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Store, Star, Package, ChevronRight, Loader2, Tag, Search, X } from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNavigation } from "@/components/BottomNavigation";
import { SupplierBadge, getSupplierBadge, type SupplierBadgeInfo } from "@/components/ui/supplier-badge";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { SearchModal } from "@/components/SearchModal";
import { CartModal } from "@/components/CartModal";
import { WishlistModal } from "@/components/WishlistModal";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { getPublicSuppliers } from "@/lib/backendApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Формат даних з FastAPI (GET /api/v1/suppliers/public). Відгуки/категорії
// з Supabase більше не тягнемо — FastAPI їх поки не віддає, тому в
// мапінгу лишаємо нульові значення (UI сам ховає ці блоки).
interface Supplier {
  id: number;
  name?: string | null;
  store_name: string;
  store_description?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  telegram_channel_link?: string | null;
  is_active: boolean;
  product_count?: number;
  completed_products?: number;
  review_count?: number;
  avg_rating?: number;
  categories?: string[];
  badge?: SupplierBadgeInfo;
  created_at?: string | null;
}

const Suppliers = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("suppliers");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Пошук магазинів: debounce 500мс, сам пошук відбувається НА БЕКЕНДІ
  // (?search= через ilike по store_name/name), а не фільтром на клієнті.
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 500);
  
  const { items: cartItems, totalItems, updateQuantity, removeItem } = useCartContext();
  const { totalFavorites } = useFavoritesContext();

  const fetchSuppliers = useCallback(async (search: string) => {
    try {
      setIsLoading(true);

      // GET /api/v1/suppliers/public — публічний запит, БЕЗ авторизації.
      // Бекенд сам фільтрує живі магазини (active/parsing) і рахує
      // product_count для кожного.
      const backendSuppliers = await getPublicSuppliers({
        search: search || undefined,
        limit: 100,
      });

      const mapped: Supplier[] = backendSuppliers.map((s) => ({
        id: s.id,
        name: s.name,
        store_name: s.store_name,
        store_description: s.store_description,
        logo_url: s.logo_url,
        cover_image_url: s.cover_image_url,
        telegram_channel_link: s.telegram_channel_link,
        is_active: s.is_active,
        product_count: s.product_count || 0,
        completed_products: s.completed_products || 0,
        review_count: 0,
        avg_rating: 0,
        categories: [],
        badge: { tier: null } as SupplierBadgeInfo, // will be assigned after sorting
        created_at: s.created_at,
      }));

      // Assign badges based on revenue/product ranking (simulate weekly/monthly/yearly)
      const sorted = [...mapped].sort((a, b) => (b.product_count || 0) - (a.product_count || 0));
      sorted.forEach((s, idx) => {
        const rank = idx + 1;
        // Use rank to determine badge tier
        s.badge = getSupplierBadge(
          rank <= 10 ? rank : null, // yearly rank
          rank <= 10 ? rank : null, // monthly rank  
          rank <= 10 ? rank : null  // weekly rank
        );
      });
      
      setSuppliers(mapped);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      toast.error('Помилка завантаження постачальників');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers(debouncedSearch);
  }, [fetchSuppliers, debouncedSearch]);

  const handleTabChange = (tab: string) => {
    if (tab === "catalog") {
      navigate("/");
    } else if (tab === "suppliers") {
      setActiveTab(tab);
    } else if (tab === "support") {
      navigate("/support");
    } else if (tab === "account") {
      navigate("/?tab=account");
    } else if (tab === "live") {
      navigate("/?tab=live");
    } else {
      navigate("/");
    }
  };

  const handleSearch = (query: string) => {
    setIsSearchOpen(false);
    navigate(`/catalog?q=${encodeURIComponent(query)}`);
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
      />
      
      <main className="px-4 pt-3 pb-28">
        <div className="flex items-center gap-2 mb-4">
          <Store className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Постачальники</h1>
        </div>
        
        <p className="text-sm text-muted-foreground mb-6">
          Обирайте товари від перевірених партнерів Taverna Group
        </p>

        {/* Пошук магазинів — запит летить на бекенд після 500мс паузи */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Пошук магазину..."
            className={cn(
              "w-full h-11 pl-10 pr-10 rounded-xl",
              "bg-muted/50 border border-border",
              "text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary",
              "transition-all"
            )}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-12">
            <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            {debouncedSearch ? (
              <>
                <p className="text-muted-foreground">За запитом «{debouncedSearch}» нічого не знайдено</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Спробуйте іншу назву магазину
                </p>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">Постачальників ще немає</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Станьте першим партнером Taverna Group!
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {suppliers.map((supplier) => (
              <button
                key={supplier.id}
                onClick={() => navigate(`/supplier/${supplier.id}`)}
                className="w-full bg-card rounded-2xl overflow-hidden border border-border hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left group"
              >
                {/* Cover as background with overlay */}
                <div className="relative h-28 w-full">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-muted to-accent/15 overflow-hidden rounded-t-2xl">
                    {supplier.cover_image_url ? (
                      <img src={supplier.cover_image_url} alt="" className="w-full h-full object-cover" />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                  </div>
                  
                  {/* Rating badge on cover */}
                  {(supplier.avg_rating || 0) > 0 && (
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      <Star className="h-3 w-3 text-warning fill-warning" />
                      <span className="text-xs font-semibold text-foreground">{supplier.avg_rating!.toFixed(1)}</span>
                    </div>
                  )}

                  {/* Avatar overlapping the cover — outside overflow-hidden */}
                  <div className="absolute -bottom-7 left-4 z-10">
                    <div className="w-14 h-14 rounded-xl bg-card border-2 border-card shadow-xl flex items-center justify-center flex-shrink-0 overflow-hidden ring-2 ring-background">
                      {supplier.logo_url ? (
                        <img src={supplier.logo_url} alt={supplier.store_name || ''} className="w-full h-full object-cover" />
                      ) : (
                        <Store className="h-7 w-7 text-primary" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Info section below cover */}
                <div className="px-4 pt-9 pb-4">
                  {/* Name & verified */}
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-foreground truncate text-base group-hover:text-primary transition-colors">
                      {supplier.store_name}
                    </h3>
                    {supplier.badge && supplier.badge.tier && (
                      <SupplierBadge badge={supplier.badge} size="sm" />
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0" />
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2.5">
                    <span className="flex items-center gap-1">
                      <Package className="h-3.5 w-3.5" />
                      {supplier.product_count || 0} товарів
                    </span>
                    {(supplier.review_count || 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-warning fill-warning" />
                        {supplier.avg_rating!.toFixed(1)} ({supplier.review_count} відгуків)
                      </span>
                    )}
                    {supplier.review_count === 0 && (
                      <span className="text-muted-foreground/50">Ще немає відгуків</span>
                    )}
                  </div>

                  {/* Categories */}
                  {supplier.categories && supplier.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {supplier.categories.slice(0, 4).map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/80 border border-primary/10"
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {cat}
                        </span>
                      ))}
                      {supplier.categories.length > 4 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          +{supplier.categories.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <BottomNavigation 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSearch={handleSearch}
      />

      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeItem}
        onCheckout={() => {
          setIsCartOpen(false);
          navigate("/");
        }}
      />

      <WishlistModal
        isOpen={isWishlistOpen}
        onClose={() => setIsWishlistOpen(false)}
        onProductClick={(id) => {
          setIsWishlistOpen(false);
          navigate(`/product/${id}`);
        }}
      />
    </div>
  );
};

export default Suppliers;

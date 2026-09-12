import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Store, Star, MapPin, Package, ChevronRight, Loader2, User, MessageSquare, Tag } from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNavigation } from "@/components/BottomNavigation";
import { Badge } from "@/components/ui/badge";
import { SupplierBadge, getSupplierBadge, type SupplierBadgeInfo } from "@/components/ui/supplier-badge";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { SearchModal } from "@/components/SearchModal";
import { CartModal } from "@/components/CartModal";
import { WishlistModal } from "@/components/WishlistModal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Supplier {
  id: string | null;
  shop_name: string | null;
  is_active: boolean | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  description?: string | null;
  product_count?: number;
  review_count?: number;
  avg_rating?: number;
  categories?: string[];
  badge?: SupplierBadgeInfo;
}

const Suppliers = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("suppliers");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const { items: cartItems, totalItems, updateQuantity, removeItem } = useCartContext();
  const { totalFavorites } = useFavoritesContext();

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      setIsLoading(true);
      
      // Fetch suppliers with logo and cover
      const { data: suppliersData, error } = await supabase
        .from('suppliers')
        .select('id, shop_name, is_active, logo_url, cover_image_url, description')
        .eq('is_active', true);
      
      if (error) throw error;
      
      // Get product counts, reviews, and categories for each supplier
      const suppliersWithDetails = await Promise.all(
        (suppliersData || []).map(async (supplier) => {
          // Product count
          const { count } = await supabase
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('supplier_id', supplier.id)
            .eq('in_stock', true);

          // Reviews for this supplier's products
          const { data: productIds } = await supabase
            .from('products')
            .select('id')
            .eq('supplier_id', supplier.id);

          let reviewCount = 0;
          let avgRating = 0;
          if (productIds?.length) {
            const { data: reviews } = await supabase
              .from('reviews')
              .select('rating')
              .in('product_id', productIds.map(p => p.id));
            
            reviewCount = reviews?.length || 0;
            avgRating = reviewCount > 0 
              ? reviews!.reduce((sum, r) => sum + r.rating, 0) / reviewCount 
              : 0;
          }

          // Categories
          const { data: productCats } = await supabase
            .from('products')
            .select('category:categories(name)')
            .eq('supplier_id', supplier.id)
            .eq('in_stock', true)
            .limit(20);

          const categorySet = new Set<string>();
          (productCats || []).forEach((p: any) => {
            if (p.category?.name) categorySet.add(p.category.name);
          });
          
          return {
            ...supplier,
            product_count: count || 0,
            review_count: reviewCount,
            avg_rating: avgRating,
            categories: Array.from(categorySet),
            badge: { tier: null } as SupplierBadgeInfo, // will be assigned after sorting
          };
        })
      );

      // Assign badges based on revenue/product ranking (simulate weekly/monthly/yearly)
      const sorted = [...suppliersWithDetails].sort((a, b) => (b.product_count || 0) - (a.product_count || 0));
      sorted.forEach((s, idx) => {
        const rank = idx + 1;
        // Use rank to determine badge tier
        s.badge = getSupplierBadge(
          rank <= 10 ? rank : null, // yearly rank
          rank <= 10 ? rank : null, // monthly rank  
          rank <= 10 ? rank : null  // weekly rank
        );
      });
      
      setSuppliers(suppliersWithDetails);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      toast.error('Помилка завантаження постачальників');
    } finally {
      setIsLoading(false);
    }
  };

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
    navigate(`/search?q=${encodeURIComponent(query)}`);
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
      
      <main className="px-4 py-4 pb-28">
        <div className="flex items-center gap-2 mb-4">
          <Store className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Постачальники</h1>
        </div>
        
        <p className="text-sm text-muted-foreground mb-6">
          Обирайте товари від перевірених партнерів Taverna Group
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-12">
            <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Постачальників ще немає</p>
            <p className="text-sm text-muted-foreground mt-2">
              Станьте першим партнером Taverna Group!
            </p>
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
                        <img src={supplier.logo_url} alt={supplier.shop_name || ''} className="w-full h-full object-cover" />
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
                      {supplier.shop_name}
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

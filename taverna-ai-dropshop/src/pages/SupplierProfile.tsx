import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { 
  ArrowLeft, Store, Star, Package, Verified, FileText, Loader2, 
  MessageCircle, ThumbsUp, User, Check 
} from "lucide-react";
import { AppRatingModal } from "@/components/AppRatingModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ProductCard } from "@/components/ProductCard";
import { BottomNavigation } from "@/components/BottomNavigation";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Supplier {
  id: string;
  shop_name: string;
  is_active: boolean;
  description?: string;
  logo_url?: string;
  cover_image_url?: string;
  return_policy?: string;
  exchange_policy?: string;
  shipping_schedule?: string;
  shipping_days?: string[];
}

interface Product {
  id: string;
  name: string;
  price: number;
  original_price?: number;
  images: string[];
  in_stock: boolean;
  stock_quantity?: number;
  sizes?: string[];
  colors?: string[];
  category?: { id: string; name: string };
}

interface Review {
  id: string;
  author_name: string;
  rating: number;
  content?: string;
  created_at: string;
  is_verified_purchase: boolean;
  helpful_count: number;
}

interface Category {
  id: string;
  name: string;
  productCount: number;
}

const SupplierProfile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("products");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReviewsLoading, setIsReviewsLoading] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, content: "" });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [isRatingOpen, setIsRatingOpen] = useState(false);
  
  const { addItem } = useCartContext();
  const { isFavorite, toggleFavorite } = useFavoritesContext();

  useEffect(() => {
    if (id) {
      fetchSupplierData();
      checkCanReview();
    }
  }, [id]);

  const fetchSupplierData = async () => {
    if (!id) return;
    
    setIsLoading(true);
    try {
      // Fetch supplier info (try full table first, fallback to public view)
      const { data: supplierData, error: supplierError } = await supabase
        .from("suppliers")
        .select("id, shop_name, is_active, description, logo_url, cover_image_url, return_policy, exchange_policy, shipping_schedule, shipping_days")
        .eq("id", id)
        .single();

      if (supplierError) {
        // Fallback to public view
        const { data: pubData, error: pubError } = await supabase
          .from("suppliers_public")
          .select("*")
          .eq("id", id)
          .single();
        if (pubError) throw pubError;
        setSupplier(pubData as Supplier);
      } else {
        setSupplier(supplierData as any as Supplier);
      }

      // Fetch products for this supplier
      const { data: productsData, error: productsError } = await supabase
        .from("products")
        .select("id, name, price, original_price, images, in_stock, stock_quantity, sizes, colors, category:categories(id, name)")
        .eq("supplier_id", id)
        .eq("in_stock", true)
        .limit(50);

      if (!productsError && productsData) {
        setProducts(productsData as Product[]);
        
        // Build category list from products
        const categoryMap = new Map<string, { name: string; count: number }>();
        productsData.forEach((p: any) => {
          if (p.category?.id) {
            const existing = categoryMap.get(p.category.id);
            if (existing) {
              existing.count++;
            } else {
              categoryMap.set(p.category.id, { name: p.category.name, count: 1 });
            }
          }
        });
        
        setCategories(
          Array.from(categoryMap.entries()).map(([id, { name, count }]) => ({
            id,
            name,
            productCount: count,
          }))
        );
      }

      // Fetch reviews for this supplier's products
      await fetchReviews();
    } catch (err) {
      console.error("Error fetching supplier:", err);
      toast.error("Постачальника не знайдено");
      navigate("/suppliers");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReviews = async () => {
    if (!id) return;
    
    setIsReviewsLoading(true);
    try {
      // Get all product IDs for this supplier
      const { data: productIds } = await supabase
        .from("products")
        .select("id")
        .eq("supplier_id", id);

      if (productIds && productIds.length > 0) {
        const ids = productIds.map(p => p.id);
        
        const { data: reviewsData, error } = await supabase
          .from("reviews")
          .select("*")
          .in("product_id", ids)
          .order("created_at", { ascending: false })
          .limit(50);

        if (!error && reviewsData) {
          setReviews(reviewsData as Review[]);
        }
      }
    } catch (err) {
      console.error("Error fetching reviews:", err);
    } finally {
      setIsReviewsLoading(false);
    }
  };

  const checkCanReview = async () => {
    // Check if user has delivered orders from this supplier
    // For now, allow all reviews (real implementation would check orders)
    setCanReview(true);
  };

  const handleSubmitReview = async () => {
    if (!id || !newReview.content.trim()) {
      toast.error("Напишіть текст відгуку");
      return;
    }
    
    setIsSubmittingReview(true);
    try {
      const sessionToken = localStorage.getItem('taverna_session_token');
      if (!sessionToken) {
        toast.error("Увійдіть, щоб залишити відгук");
        return;
      }

      // Get first product of this supplier for the review
      const { data: firstProduct } = await supabase
        .from("products")
        .select("id")
        .eq("supplier_id", id)
        .limit(1)
        .single();

      if (firstProduct) {
        const { data, error } = await supabase.functions.invoke('telegram-auth', {
          body: {
            action: 'create_review',
            session_token: sessionToken,
            product_id: firstProduct.id,
            rating: newReview.rating,
            content: newReview.content || null,
          },
        });

        if (error || !data?.success) {
          throw new Error(data?.error || 'Failed to create review');
        }

        toast.success("Відгук додано!");
        setNewReview({ rating: 5, content: "" });
        fetchReviews();
      }
    } catch (err: any) {
      console.error("Error submitting review:", err);
      toast.error(err?.message === 'You already reviewed this product' ? 'Ви вже залишали відгук' : "Помилка додавання відгуку");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleAddToCart = async (product: Product) => {
    const success = await addItem(
      product.id,
      product.name,
      product.price,
      product.images?.[0] || "/placeholder.svg"
    );
    if (success) {
      toast.success(`${product.name} додано до кошика`);
    }
  };

  const handleToggleFavorite = async (product: Product) => {
    await toggleFavorite(
      product.id,
      product.name,
      product.price,
      product.images?.[0] || "/placeholder.svg"
    );
  };

  // Calculate stats
  const productCount = products.length;
  const averageRating = reviews.length 
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
    : 0;
  const reviewCount = reviews.length;
  
  const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: reviews.filter((r) => r.rating === rating).length,
    percentage: reviews.length ? (reviews.filter((r) => r.rating === rating).length / reviews.length) * 100 : 0,
  }));

  // Filter products by category
  const filteredProducts = selectedCategory
    ? products.filter(p => p.category?.id === selectedCategory)
    : products;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Постачальника не знайдено</p>
          <Button onClick={() => navigate("/suppliers")} className="mt-4">
            До списку постачальників
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center gap-3 p-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg truncate">{supplier.shop_name}</h1>
              {supplier.is_active && (
                <Verified className="h-4 w-4 text-primary flex-shrink-0" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">Офіційний партнер Taverna</p>
          </div>
        </div>
      </div>

      {/* Supplier Hero */}
      <div className="relative">
        {/* Cover image */}
        <div className="h-24 bg-gradient-to-r from-primary/20 via-primary/10 to-accent/20 overflow-hidden relative">
          {supplier.cover_image_url && (
            <img src={supplier.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
          )}
          {/* Rating button on cover */}
          <button
            onClick={() => setIsRatingOpen(true)}
            className="absolute top-2 right-2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-background/80 backdrop-blur-sm text-xs font-medium text-foreground hover:bg-background/95 transition-all shadow-sm"
          >
            <Star className="h-3.5 w-3.5 text-warning fill-warning" />
            Оцінити
          </button>
        </div>
        
        {/* Profile section */}
        <div className="px-4 -mt-8">
          <div className="flex items-end gap-4 mb-4">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border-4 border-background shadow-lg overflow-hidden">
              {supplier.logo_url ? (
                <img src={supplier.logo_url} alt={supplier.shop_name} className="w-full h-full object-cover" />
              ) : (
                <Store className="h-10 w-10 text-primary" />
              )}
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-3 text-sm mb-1">
                <span className="flex items-center gap-1 text-foreground">
                  <Star className="h-4 w-4 text-warning fill-warning" />
                  <strong>{averageRating.toFixed(1)}</strong>
                </span>
                <span className="text-muted-foreground">
                  ({reviewCount} відгуків)
                </span>
              </div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>{productCount} товарів</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="w-full grid grid-cols-3 mx-4 mt-2" style={{ width: "calc(100% - 2rem)" }}>
          <TabsTrigger value="products" className="flex items-center gap-1.5">
            <Package className="h-4 w-4" />
            Товари
          </TabsTrigger>
          <TabsTrigger value="reviews" className="flex items-center gap-1.5">
            <MessageCircle className="h-4 w-4" />
            Відгуки
          </TabsTrigger>
          <TabsTrigger value="policy" className="flex items-center gap-1.5">
            <FileText className="h-4 w-4" />
            Інфо
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="p-4 pb-28">
          {/* Category Filter */}
          {categories.length > 1 && (
            <div className="mb-4 overflow-x-auto">
              <div className="flex gap-2 pb-2">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                    selectedCategory === null
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  Всі ({productCount})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                      selectedCategory === cat.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {cat.name} ({cat.productCount})
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  id={product.id}
                  name={product.name}
                  price={product.price}
                  originalPrice={product.original_price}
                  image={product.images?.[0] || "/placeholder.svg"}
                  category={product.category?.name}
                  inStock={product.in_stock !== false}
                  stockQuantity={product.stock_quantity}
                  sizes={product.sizes}
                  colors={product.colors}
                  isFavorite={isFavorite(product.id)}
                  onClick={() => navigate(`/product/${product.id}`)}
                  onAddToCart={() => handleAddToCart(product)}
                  onToggleFavorite={() => handleToggleFavorite(product)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Товари не знайдено</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="reviews" className="p-4 pb-28 space-y-6">
          {/* Rating Summary */}
          {reviews.length > 0 && (
            <div className="bg-muted/50 rounded-xl p-4">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-4xl font-bold text-foreground">{averageRating.toFixed(1)}</div>
                  <div className="flex items-center gap-1 mt-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={cn(
                          "h-4 w-4",
                          star <= Math.round(averageRating) ? "text-warning fill-warning" : "text-muted"
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{reviews.length} відгуків</p>
                </div>
                <div className="flex-1 space-y-1">
                  {ratingDistribution.map(({ rating, count, percentage }) => (
                    <div key={rating} className="flex items-center gap-2">
                      <span className="text-xs w-3">{rating}</span>
                      <Star className="h-3 w-3 text-warning fill-warning" />
                      <Progress value={percentage} className="flex-1 h-2" />
                      <span className="text-xs text-muted-foreground w-8">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Add Review Form */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <h4 className="font-semibold">Залишити відгук</h4>
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Оцінка</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setNewReview((prev) => ({ ...prev, rating: star }))}
                    className="p-1"
                  >
                    <Star
                      className={cn(
                        "h-6 w-6 transition-all",
                        star <= newReview.rating ? "text-warning fill-warning" : "text-muted hover:text-warning"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              placeholder="Ваш відгук про магазин..."
              value={newReview.content}
              onChange={(e) => setNewReview((prev) => ({ ...prev, content: e.target.value }))}
              rows={3}
            />
            <Button 
              onClick={handleSubmitReview} 
              disabled={isSubmittingReview || !newReview.content.trim()}
              className="w-full"
            >
              {isSubmittingReview ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <MessageCircle className="h-4 w-4 mr-2" />
              )}
              Відправити відгук
            </Button>
          </div>

          {/* Reviews List */}
          {isReviewsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-8">
              <MessageCircle className="h-12 w-12 mx-auto text-muted mb-3" />
              <p className="text-muted-foreground">Ще немає відгуків</p>
              <p className="text-sm text-muted-foreground">Будьте першим!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{review.author_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(review.created_at).toLocaleDateString("uk-UA")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={cn(
                            "h-3 w-3",
                            star <= review.rating ? "text-warning fill-warning" : "text-muted"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                  {review.content && (
                    <p className="text-sm text-muted-foreground">{review.content}</p>
                  )}
                  {review.is_verified_purchase && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      <Check className="h-3 w-3 mr-1" />
                      Підтверджена покупка
                    </Badge>
                  )}
                  <button className="flex items-center gap-1 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <ThumbsUp className="h-3 w-3" />
                    Корисно ({review.helpful_count || 0})
                  </button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="policy" className="p-4 pb-28 space-y-4">
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Store className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Про магазин</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {supplier.description || `${supplier.shop_name} — офіційний партнер маркетплейсу Taverna Group. Всі товари проходять перевірку якості перед відправкою.`}
            </p>
          </div>

          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Політика повернення</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {supplier.return_policy || "Повернення товару можливе протягом 14 днів з моменту отримання за умови збереження товарного вигляду та упаковки. Для оформлення повернення зверніться до служби підтримки Taverna."}
            </p>
          </div>

          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Обмін товару</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {supplier.exchange_policy || "Обмін товару можливий на аналогічний або інший розмір/колір протягом 14 днів."}
            </p>
          </div>

          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Доставка</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {supplier.shipping_schedule || "Відправка замовлень здійснюється протягом 1-2 робочих днів. Доставка по всій Україні через Нову Пошту, Укрпошту та інші служби."}
            </p>
            {supplier.shipping_days && supplier.shipping_days.length > 0 && (
              <div className="flex gap-1.5 mt-3">
                {["Пн","Вт","Ср","Чт","Пт","Сб","Нд"].map((day, i) => {
                  const dayIds = ["mon","tue","wed","thu","fri","sat","sun"];
                  const isActive = supplier.shipping_days?.includes(dayIds[i]);
                  return (
                    <span key={i} className={cn(
                      "w-8 h-8 rounded-lg text-xs font-medium flex items-center justify-center",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>
                      {day}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AppRatingModal 
        isOpen={isRatingOpen} 
        onClose={() => setIsRatingOpen(false)} 
        type="store" 
        targetId={id} 
        targetName={supplier.shop_name} 
      />

      <BottomNavigation 
        activeTab="suppliers" 
        onTabChange={(tab) => {
          if (tab === "catalog") navigate("/");
          else if (tab === "suppliers") navigate("/suppliers");
          else if (tab === "support") navigate("/support");
          else navigate("/");
        }} 
      />
    </div>
  );
};

export default SupplierProfile;

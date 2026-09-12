import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { 
  ArrowLeft, ShoppingCart, Heart, Share2, Minus, Plus, Check, 
  Star, ChevronLeft, ChevronRight, Package, Truck, Shield, 
  MessageCircle, ThumbsUp, User, Loader2, Home, Flag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProductVariantSelector } from "@/components/product/ProductVariantSelector";
import { ShareButton } from "@/components/product/ShareButton";
import { AIVerdict } from "@/components/product/AIVerdict";
import { LowStockBadge } from "@/components/product/LowStockBadge";
import { ProductSpecs } from "@/components/product/ProductSpecs";
import { ReportProductModal } from "@/components/product/ReportProductModal";
import { WarrantyModal } from "@/components/product/WarrantyModal";
import { ReturnPolicyModal } from "@/components/product/ReturnPolicyModal";
import { DeliveryInfoModal } from "@/components/product/DeliveryInfoModal";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { hapticImpact } from "@/lib/haptics";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface Product {
  id: string;
  name: string;
  description?: string;
  ai_description?: string;
  price: number;
  original_price?: number;
  images?: string[];
  sizes?: string[];
  colors?: string[];
  brand?: string;
  model?: string;
  vendor_code?: string;
  in_stock?: boolean;
  stock_quantity?: number;
  attributes?: Record<string, unknown>;
  warranty_info?: string; // AI-generated warranty info
  supplier_id?: string;
  video_url?: string;
  category?: {
    id: string;
    name: string;
    slug: string;
    parent?: {
      id: string;
      name: string;
      slug: string;
    };
  };
}

interface Review {
  id: string;
  author_name: string;
  rating: number;
  title?: string;
  content?: string;
  images?: string[];
  is_verified_purchase: boolean;
  helpful_count: number;
  created_at: string;
}

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCartContext();
  const { isFavorite, toggleFavorite } = useFavoritesContext();
  
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState("description");
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isWarrantyOpen, setIsWarrantyOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [isDeliveryOpen, setIsDeliveryOpen] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, title: "", content: "" });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  useEffect(() => {
    if (id) {
      fetchProduct();
      fetchReviews();
    }
  }, [id]);

  const fetchProduct = async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select(`
          *,
          category:categories(id, name, slug, parent:parent_id(id, name, slug))
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      
      const productData = data as unknown as Product;
      setProduct(productData);
      
      // Auto-select first color if available
      if (productData.colors?.length) {
        setSelectedColor(productData.colors[0]);
      }
    } catch (err) {
      console.error("Error fetching product:", err);
      toast.error("Товар не знайдено");
      navigate("/");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReviews = async () => {
    try {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("product_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReviews(data || []);
    } catch (err) {
      console.error("Error fetching reviews:", err);
    }
  };

  const handleAddToCart = () => {
    if (!product) return;
    
    hapticImpact("light");
    
    if (product.sizes?.length && !selectedSize) {
      toast.error("Оберіть розмір");
      return;
    }
    if (product.colors?.length && !selectedColor) {
      toast.error("Оберіть колір");
      return;
    }

    addItem(
      product.id,
      product.name,
      product.price,
      product.images?.[0] || "/placeholder.svg",
      selectedSize || undefined,
      selectedColor || undefined
    );

    toast.success(`${product.name} додано до кошика`);
  };

  const handleShare = async () => {
    if (!product) return;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: product.name,
          text: `${product.name} - ${product.price} ₴`,
          url: window.location.href,
        });
      } catch {
        // User cancelled
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Посилання скопійовано");
    }
  };

  const handleSubmitReview = async () => {
    if (!id) return;
    
    setIsSubmittingReview(true);
    try {
      const sessionToken = localStorage.getItem('taverna_session_token');
      if (!sessionToken) {
        toast.error("Увійдіть, щоб залишити відгук");
        return;
      }

      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: {
          action: 'create_review',
          session_token: sessionToken,
          product_id: id,
          rating: newReview.rating,
          title: newReview.title || null,
          content: newReview.content || null,
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to create review');
      }

      toast.success("Відгук додано!");
      setNewReview({ rating: 5, title: "", content: "" });
      fetchReviews();
    } catch (err: any) {
      console.error("Error submitting review:", err);
      toast.error(err?.message === 'You already reviewed this product' ? 'Ви вже залишали відгук' : "Помилка додавання відгуку");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const navigateImage = (direction: "prev" | "next") => {
    if (!product?.images?.length) return;
    
    if (direction === "prev") {
      setSelectedImage((prev) => (prev === 0 ? product.images!.length - 1 : prev - 1));
    } else {
      setSelectedImage((prev) => (prev === product.images!.length - 1 ? 0 : prev + 1));
    }
  };

  // Calculate review stats
  const averageRating = reviews.length 
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
    : 0;
  
  const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: reviews.filter((r) => r.rating === rating).length,
    percentage: reviews.length ? (reviews.filter((r) => r.rating === rating).length / reviews.length) * 100 : 0,
  }));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Товар не знайдено</p>
      </div>
    );
  }

  const discount = product.original_price 
    ? Math.round((1 - product.price / product.original_price) * 100) 
    : 0;

  const productIsFavorite = isFavorite(product.id);

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border">
        <div className="flex items-center justify-between h-14 px-4">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleFavorite(product.id, product.name, product.price, product.images?.[0] || "/placeholder.svg")}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                productIsFavorite 
                  ? "text-live bg-live/10" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Heart className={cn("h-5 w-5", productIsFavorite && "fill-current")} />
            </button>
            <button
              onClick={() => {
                hapticImpact("light");
                setIsReportOpen(true);
              }}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
              title="Поскаржитись"
            >
              <Flag className="h-5 w-5" />
            </button>
            <button
              onClick={handleShare}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Share2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Report Product Modal */}
      {product && (
        <ReportProductModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          productId={product.id}
          productName={product.name}
        />
      )}

      {/* Warranty Modal */}
      {product && (
        <WarrantyModal
          isOpen={isWarrantyOpen}
          onClose={() => setIsWarrantyOpen(false)}
          warrantyInfo={product.warranty_info}
          productName={product.name}
        />
      )}

      {/* Return Policy Modal */}
      <ReturnPolicyModal
        isOpen={isReturnOpen}
        onClose={() => setIsReturnOpen(false)}
      />

      {/* Delivery Info Modal */}
      {product && (
        <DeliveryInfoModal
          isOpen={isDeliveryOpen}
          onClose={() => setIsDeliveryOpen(false)}
          productPrice={product.price}
        />
      )}

      {/* Breadcrumbs Navigation */}
      <div className="px-4 py-2 bg-muted/30 border-b border-border">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/" className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <Home className="h-3.5 w-3.5" />
                  <span>Головна</span>
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            
            {product.category?.parent && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link 
                      to={`/search?category=${product.category.parent.id}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {product.category.parent.name}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            
            {product.category && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link 
                      to={`/search?category=${product.category.id}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {product.category.name}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="line-clamp-1 max-w-[180px]">
                {product.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Image Gallery */}
      <Dialog open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
        <DialogTrigger asChild>
          <div className="relative cursor-pointer">
            <div className="aspect-square bg-muted overflow-hidden">
              <img
                src={product.images?.[selectedImage] || "/placeholder.svg"}
                alt={product.name}
                className="w-full h-full object-cover"
              />
              {discount > 0 && (
                <div className="absolute top-4 left-4 bg-live text-live-foreground text-sm font-bold px-3 py-1 rounded-lg">
                  -{discount}%
                </div>
              )}
              {!product.in_stock && (
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                  <Badge variant="secondary" className="text-lg py-2 px-4">Немає в наявності</Badge>
                </div>
              )}
            </div>
            
            {/* Navigation Arrows */}
            {product.images && product.images.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); navigateImage("prev"); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur flex items-center justify-center"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); navigateImage("next"); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur flex items-center justify-center"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
            
            {/* Thumbnail Dots */}
            {product.images && product.images.length > 1 && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                {product.images.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => { e.stopPropagation(); setSelectedImage(idx); }}
                    className={cn(
                      "w-2 h-2 rounded-full transition-all",
                      idx === selectedImage ? "bg-primary w-6" : "bg-white/50"
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogTrigger>
        
        <DialogContent className="max-w-4xl p-0 bg-black">
          <DialogHeader className="p-4">
            <DialogTitle className="text-white">Галерея</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <img
              src={product.images?.[selectedImage] || "/placeholder.svg"}
              alt={product.name}
              className="w-full max-h-[70vh] object-contain"
            />
            {product.images && product.images.length > 1 && (
              <>
                <button
                  onClick={() => navigateImage("prev")}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  onClick={() => navigateImage("next")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          {/* Thumbnails */}
          {product.images && product.images.length > 1 && (
            <div className="p-4 flex gap-2 overflow-x-auto">
              {product.images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedImage(idx)}
                  className={cn(
                    "w-16 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-all",
                    idx === selectedImage ? "border-primary" : "border-transparent opacity-60"
                  )}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Thumbnail Strip */}
      {product.images && product.images.length > 1 && (
        <div className="p-4 pb-0">
          <ScrollArea className="w-full">
            <div className="flex gap-2">
              {product.images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedImage(idx)}
                  className={cn(
                    "w-16 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-all",
                    idx === selectedImage ? "border-primary" : "border-border"
                  )}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Title & Price */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {product.brand && (
              <Badge variant="secondary" className="text-xs">
                {product.brand}
              </Badge>
            )}
            {product.category && (
              <Badge variant="outline" className="text-xs">
                {product.category.name}
              </Badge>
            )}
            {product.vendor_code && (
              <span className="text-xs text-muted-foreground">
                Арт: {product.vendor_code}
              </span>
            )}
          </div>
          {/* Title with Share Button */}
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-bold text-foreground flex-1">{product.name}</h1>
            <ShareButton productId={product.id} productName={product.name} />
          </div>
          
          {/* Rating Summary */}
          {reviews.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-1">
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
              <span className="text-sm font-medium">{averageRating.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">({reviews.length} відгуків)</span>
            </div>
          )}
          
          <div className="mt-3 space-y-1">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold text-primary">
                {product.price.toLocaleString()} ₴
              </span>
              {product.original_price && (
                <span className="text-base text-muted-foreground line-through">
                  {product.original_price.toLocaleString()} ₴
                </span>
              )}
            </div>
            
            {/* Stock Quantity Info */}
            {product.in_stock && product.stock_quantity !== undefined && product.stock_quantity > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-success">✓ В наявності</span>
                <span className="text-muted-foreground">
                  ({product.stock_quantity > 99 ? "99+" : product.stock_quantity} шт)
                </span>
                {/* Low Stock FOMO Badge */}
                {product.stock_quantity <= 5 && (
                  <LowStockBadge quantity={product.stock_quantity} />
                )}
              </div>
            )}
            {!product.in_stock && (
              <div className="text-sm text-destructive">✗ Немає в наявності</div>
            )}
          </div>
        </div>

        {/* Variant Selectors using new components */}
        {product.sizes && product.sizes.length > 0 && (
          <ProductVariantSelector
            label="Розмір"
            options={product.sizes}
            selected={selectedSize}
            onSelect={setSelectedSize}
            type="button"
          />
        )}

        {product.colors && product.colors.length > 0 && (
          <ProductVariantSelector
            label="Колір"
            options={product.colors}
            selected={selectedColor}
            onSelect={(color) => {
              setSelectedColor(color);
              // Auto-change image based on color index (if multiple images exist)
              if (product.images && product.images.length > 1) {
                const colorIndex = product.colors?.indexOf(color) || 0;
                // Map color to image if we have enough images
                if (colorIndex < product.images.length) {
                  setSelectedImage(colorIndex);
                }
              }
            }}
            type="color"
          />
        )}

        {/* Validation message */}
        {((product.sizes?.length && !selectedSize) || (product.colors?.length && !selectedColor)) && (
          <p className="text-sm text-warning bg-warning/10 rounded-lg px-3 py-2">
            ⚠️ {!selectedSize && product.sizes?.length ? "Оберіть розмір" : ""} 
            {!selectedSize && product.sizes?.length && !selectedColor && product.colors?.length ? " та " : ""}
            {!selectedColor && product.colors?.length ? "Оберіть колір" : ""}
          </p>
        )}

        {/* Quantity */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Кількість</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 disabled:opacity-50 transition-all"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-12 text-center font-semibold text-lg">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 transition-all"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Features - Clickable */}
        <div className="grid grid-cols-3 gap-3">
          <button 
            onClick={() => {
              hapticImpact("light");
              setIsDeliveryOpen(true);
            }}
            className="bg-muted/50 rounded-xl p-3 text-center hover:bg-muted/70 transition-colors active:scale-95"
          >
            <Truck className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="text-xs text-muted-foreground">Доставка</p>
            <p className="text-[10px] text-primary font-medium mt-0.5">
              від {product.price < 500 ? 50 : product.price < 1000 ? 60 : 70} ₴
            </p>
          </button>
          <button 
            onClick={() => {
              hapticImpact("light");
              setIsWarrantyOpen(true);
            }}
            className="bg-muted/50 rounded-xl p-3 text-center hover:bg-muted/70 transition-colors active:scale-95"
          >
            <Shield className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="text-xs text-muted-foreground">Гарантія</p>
            <p className="text-[10px] text-primary font-medium mt-0.5">
              {product.warranty_info ? "є" : "уточнити"}
            </p>
          </button>
          <button 
            onClick={() => {
              hapticImpact("light");
              setIsReturnOpen(true);
            }}
            className="bg-muted/50 rounded-xl p-3 text-center hover:bg-muted/70 transition-colors active:scale-95"
          >
            <Package className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="text-xs text-muted-foreground">Повернення</p>
            <p className="text-[10px] text-primary font-medium mt-0.5">/ Обмін</p>
          </button>
        </div>

        {/* Tabs: Description, Characteristics, Reviews */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="description">Опис</TabsTrigger>
            <TabsTrigger value="specs">Характеристики</TabsTrigger>
            <TabsTrigger value="reviews">
              Відгуки {reviews.length > 0 && `(${reviews.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="description" className="mt-4">
            <div className="space-y-4">
              {/* AI Verdict - Quick Summary */}
              {product.ai_description && (
                <AIVerdict 
                  aiDescription={product.ai_description} 
                  productName={product.name} 
                />
              )}
              
              {/* AI Generated Description if available */}
              {product.ai_description && (
                <div className="bg-gradient-to-r from-primary/5 to-accent/5 rounded-xl p-4 border border-primary/10">
                  <p className="text-sm font-medium text-primary mb-2">✨ Повний опис від AI</p>
                  <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                    {product.ai_description}
                  </p>
                </div>
              )}
              
              {/* Original Description */}
              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                {product.description || "Опис товару відсутній"}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="specs" className="mt-4">
            <ProductSpecs
              attributes={product.attributes}
              categoryName={product.category?.name}
              sizes={product.sizes}
              colors={product.colors}
              brand={product.brand}
              model={product.model}
            />
            
            {/* Vendor code always shown */}
            {product.vendor_code && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex justify-between py-2">
                  <span className="text-sm text-muted-foreground">Артикул</span>
                  <span className="text-sm font-medium font-mono">{product.vendor_code}</span>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="mt-4 space-y-6">
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
                placeholder="Ваш відгук..."
                value={newReview.content}
                onChange={(e) => setNewReview((prev) => ({ ...prev, content: e.target.value }))}
                rows={3}
              />
              <Button 
                onClick={handleSubmitReview} 
                disabled={isSubmittingReview}
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
            {reviews.length === 0 ? (
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
                    {review.title && (
                      <h5 className="font-medium text-sm mb-1">{review.title}</h5>
                    )}
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
                      Корисно ({review.helpful_count})
                    </button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 safe-area-pb z-50">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <span className="text-xs text-muted-foreground">Разом:</span>
            <div className="text-xl font-bold text-foreground">
              {(product.price * quantity).toLocaleString()} ₴
            </div>
          </div>
          <Button
            onClick={handleAddToCart}
            disabled={
              !product.in_stock || 
              (product.sizes?.length && !selectedSize) || 
              (product.colors?.length && !selectedColor)
            }
            className={cn(
              "flex-1 py-6 rounded-xl font-semibold text-base",
              "flex items-center justify-center gap-2"
            )}
          >
            <ShoppingCart className="h-5 w-5" />
            {!product.in_stock 
              ? "Немає в наявності" 
              : (product.sizes?.length && !selectedSize) || (product.colors?.length && !selectedColor)
                ? "Оберіть варіант"
                : "Додати до кошика"
            }
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;

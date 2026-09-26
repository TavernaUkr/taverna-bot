import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { 
  ArrowLeft, ShoppingCart, Heart, Share2, Minus, Plus, Check, 
  Star, ChevronLeft, ChevronRight, Package, Truck, Shield, 
  MessageCircle, ThumbsUp, User, Loader2, Home, Flag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchProductById,
  fetchProductColorVariants,
  BackendApiError,
  type BackendProduct,
  type BackendProductVariant,
  type BackendProductOption,
  type BackendProductColorVariant,
} from "@/lib/backendApi";
import { formatProductDescription } from "@/lib/formatDescription";
import { isVideoUrl, firstPhotoUrl } from "@/lib/media";
import { getColorHex } from "@/lib/colorMap";
import { useCartStore } from "@/store/cartStore";
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
import { AIVerdict } from "@/components/product/AIVerdict";
import { LowStockBadge } from "@/components/product/LowStockBadge";
import { ReportProductModal } from "@/components/product/ReportProductModal";
import { WarrantyModal } from "@/components/product/WarrantyModal";
import { ReturnPolicyModal } from "@/components/product/ReturnPolicyModal";
import { DeliveryInfoModal } from "@/components/product/DeliveryInfoModal";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { hapticImpact } from "@/lib/haptics";
import { vibrate } from "@/hooks/useTelegramUI";
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
  characteristics?: { name: string; value: string }[];
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
  // Оригінальні варіанти/опції з бекенду (потрібні, щоб знайти ТОЧНИЙ
  // variant_id для обраної комбінації розмір+колір — див. `selectedVariant`).
  variants?: BackendProductVariant[];
  options?: BackendProductOption[];
}

const CHARACTERISTIC_META_KEYS = new Set([
  "source",
  "source_url",
  "telegram_message_id",
  "vendor_code",
  "sizes",
  "media_urls",
  "characteristics",
  "search_tags",
  "base_model_name",
  "color",
]);

function mapProductCharacteristics(raw?: Record<string, unknown> | null): { name: string; value: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const pairs: { name: string; value: string }[] = [];
  const fromArray = raw.characteristics;
  if (Array.isArray(fromArray)) {
    for (const entry of fromArray) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as { name?: unknown; value?: unknown };
      const name = String(row.name || "").trim();
      const value = String(row.value ?? "").trim();
      if (name && value) pairs.push({ name, value });
    }
    if (pairs.length) return pairs;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (CHARACTERISTIC_META_KEYS.has(key.toLowerCase())) continue;
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (key && text) pairs.push({ name: key, value: text });
  }
  return pairs;
}
function mapBackendProductToDetail(bp: BackendProduct): Product {
  const variants = bp.variants ?? [];
  const stockedVariants = variants.filter((v) => (v.quantity || 0) > 0);
  const availableVariants = stockedVariants.filter((v) => v.is_available);
  const primaryVariant = availableVariants[0] ?? stockedVariants[0] ?? variants[0];
  const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);

  const options = bp.options ?? [];
  const sizeOption = options.find((o) => /розмір|размер|size/i.test(o.name));
  const colorOption = options.find((o) => /колір|цвет|color/i.test(o.name));

  const categoryTag = bp.category?.trim() || undefined;
  const subCategory = bp.sub_category?.trim() || undefined;

  return {
    id: String(bp.id),
    name: bp.name,
    description: bp.description ?? undefined,
    price: primaryVariant?.final_price ?? 0,
    images: bp.pictures ?? [],
    sizes: sizeOption?.values.map((v) => v.value),
    colors: colorOption?.values.map((v) => v.value),
    vendor_code: bp.sku,
    in_stock: stockedVariants.length > 0,
    stock_quantity: totalStock,
    category: categoryTag
      ? {
          id: subCategory || categoryTag,
          name: subCategory || categoryTag,
          slug: subCategory || categoryTag,
          parent: subCategory
            ? { id: categoryTag, name: categoryTag, slug: categoryTag }
            : undefined,
        }
      : undefined,
    variants,
    options,
    attributes: bp.attributes ?? undefined,
    characteristics: mapProductCharacteristics(bp.attributes as Record<string, unknown> | undefined),
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
  const addItem = useCartStore((s) => s.addItem);
  const { isFavorite, toggleFavorite } = useFavoritesContext();
  
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [relatedColors, setRelatedColors] = useState<BackendProductColorVariant[]>([]);
  // Биті посилання на фото кружечка кольору (404 / формат, який браузер не
  // відкрив) — тримаємо окремо по product_id, щоб одне зіпсоване фото не
  // ламало решту кружечків.
  const [colorThumbErrors, setColorThumbErrors] = useState<Record<number, boolean>>({});
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState("description");
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isWarrantyOpen, setIsWarrantyOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [isDeliveryOpen, setIsDeliveryOpen] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, title: "", content: "" });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  /**
   * Знаходить ТОЧНИЙ варіант товару (з конкретною ціною/залишком) для
   * обраної комбінації розмір+колір. Без цього кошик не знав би, який
   * саме `variant_id` додавати — усі розміри/кольори мали б однакову ціну
   * першого варіанту з каталогу.
   */
  const selectedVariant = useMemo<BackendProductVariant | undefined>(() => {
    if (!product?.variants?.length) return undefined;

    const hasSize = !!product.sizes?.length;
    const hasColor = relatedColors.length <= 1 && !!product.colors?.length;

    // Товар без розмірів/кольорів -> завжди один (перший доступний) варіант.
    if (!hasSize && !hasColor) {
      return product.variants.find((v) => v.is_available && v.quantity > 0) ?? product.variants[0];
    }

    const sizeOption = product.options?.find((o) => /розмір|размер|size/i.test(o.name));
    const colorOption = product.options?.find((o) => /колір|цвет|color/i.test(o.name));

    const sizeValueId = hasSize ? sizeOption?.values.find((v) => v.value === selectedSize)?.id : undefined;
    const colorValueId = hasColor ? colorOption?.values.find((v) => v.value === selectedColor)?.id : undefined;

    // Розмір/колір обрано в UI, але ще не змаплено на option_value_id — чекаємо
    if ((hasSize && selectedSize && sizeValueId === undefined) || (hasColor && selectedColor && colorValueId === undefined)) {
      return undefined;
    }
    if ((hasSize && !selectedSize) || (hasColor && !selectedColor)) return undefined;

    return product.variants.find((v) => {
      const ids = v.option_value_ids ?? [];
      if (hasSize && !ids.includes(sizeValueId as number)) return false;
      if (hasColor && !ids.includes(colorValueId as number)) return false;
      return true;
    });
  }, [product, selectedSize, selectedColor, relatedColors]);

  // Ціна/наявність, що реально відповідають ОБРАНІЙ комбінації розмір+колір
  // (а не просто першому варіанту товару в каталозі).
  const effectivePrice = selectedVariant?.final_price ?? product?.price ?? 0;
  const effectiveStock = selectedVariant?.quantity;
  const isSelectedVariantAvailable = selectedVariant
    ? selectedVariant.is_available && selectedVariant.quantity > 0
    : product?.in_stock ?? false;

  // Показуємо блок кольорів навіть якщо колір лише один — клієнт має бачити,
  // який саме колір у цього товару (а не гадати з назви/фото).
  const showRelatedColors = relatedColors.length >= 1;
  const showInlineColors = !showRelatedColors && !!product?.colors?.length;

  // Якщо переключили варіант і в ньому залишків менше за обрану кількість — коригуємо кількість.
  useEffect(() => {
    if (typeof effectiveStock === "number" && effectiveStock > 0 && quantity > effectiveStock) {
      setQuantity(effectiveStock);
    }
  }, [effectiveStock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (id) {
      fetchProduct();
      fetchReviews();
    }
  }, [id]);

  const fetchProduct = async () => {
    try {
      if (!id) {
        toast.error("Товар не знайдено");
        navigate("/");
        return;
      }

      setRelatedColors([]);

      // GET /api/v1/products/{id} — окремий ендпоінт, не тягне весь каталог.
      const backendProduct = await fetchProductById(id);

      if (!backendProduct) {
        toast.error("Товар не знайдено");
        navigate("/");
        return;
      }

      const productData = mapBackendProductToDetail(backendProduct);
      setProduct(productData);
      setSelectedImage(0);
      setSelectedSize(null);
      setSelectedColor(null);

      // Auto-select first color if available
      if (productData.colors?.length) {
        setSelectedColor(productData.colors[0]);
      }

      try {
        const variants = await fetchProductColorVariants(id);
        setRelatedColors(Array.isArray(variants) ? variants : []);
      } catch (colorErr) {
        console.error("Error fetching product colors:", colorErr);
        setRelatedColors([]);
      }
    } catch (err) {
      const message = err instanceof BackendApiError ? err.message : "Товар не знайдено";
      console.error("Error fetching product:", err);
      toast.error(message);
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
    
    vibrate("light");
    
    if (product.sizes?.length && !selectedSize) {
      toast.error("Оберіть розмір");
      return;
    }
    if (showInlineColors && !selectedColor) {
      toast.error("Оберіть колір");
      return;
    }
    // Розмір/колір обрано, але саме такої комбінації немає серед варіантів товару
    if ((product.sizes?.length || showInlineColors) && !selectedVariant) {
      toast.error("Цієї комбінації розмір/колір немає в наявності");
      return;
    }
    if (!isSelectedVariantAvailable) {
      toast.error("Немає в наявності");
      return;
    }
    if (typeof effectiveStock === "number" && quantity > effectiveStock) {
      toast.error(`В наявності лише ${effectiveStock} шт.`);
      return;
    }

    // Глобальний Zustand-кошик: сторінка /cart, бейдж та чекаут — звідти.
    // effectivePrice враховує обраний варіант (final_price варіанта) —
    // підміняємо price в копії товару, щоб кошиок рахував суму коректно.
    const selectedOptions: Record<string, string> = {};
    if (selectedSize) selectedOptions["Розмір"] = selectedSize;
    if (selectedColor) selectedOptions["Колір"] = selectedColor;
    addItem(
      { ...product, price: effectivePrice },
      quantity,
      selectedOptions,
      selectedVariant ? String(selectedVariant.id) : undefined
    );

    vibrate("success");
    toast.success(`${product.name} додано до кошика`);
  };

  const handleShare = () => {
    if (!product) return;
    const productUrl = `${window.location.origin}/product/${product.id}`;
    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(productUrl)}`;
    const tg = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(telegramUrl);
      return;
    }
    window.open(telegramUrl, "_blank");
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
    <div className="min-h-screen bg-background pb-40">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-md border-b border-border">
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
                      to={`/catalog?category=${encodeURIComponent(product.category.parent.id)}`}
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
                      to={`/catalog?category=${encodeURIComponent(product.category.id)}`}
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
              {isVideoUrl(product.images?.[selectedImage]) ? (
                <video
                  src={product.images?.[selectedImage]}
                  className="w-full h-full object-cover"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={product.images?.[selectedImage] || "/placeholder.svg"}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              )}
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
            {isVideoUrl(product.images?.[selectedImage]) ? (
              <video
                src={product.images?.[selectedImage]}
                className="w-full max-h-[70vh] object-contain"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                src={product.images?.[selectedImage] || "/placeholder.svg"}
                alt={product.name}
                className="w-full max-h-[70vh] object-contain"
              />
            )}
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
                  {isVideoUrl(img) ? (
                    <video src={img} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                  ) : (
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  )}
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
                  {isVideoUrl(img) ? (
                    <video src={img} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                  ) : (
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  )}
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
          <div className="flex flex-row justify-between items-start gap-4">
            <h1 className="whitespace-normal break-words text-xl font-bold w-full pr-2 text-foreground">
              {product.name}
            </h1>
            <button
              type="button"
              onClick={handleShare}
              className="p-2 bg-gray-100 rounded-full shrink-0"
              aria-label="Поділитися"
              title="Поділитися"
            >
              <Share2 className="w-5 h-5 text-gray-500" />
            </button>
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
                {effectivePrice.toLocaleString()} ₴
              </span>
              {product.original_price && (
                <span className="text-base text-muted-foreground line-through">
                  {product.original_price.toLocaleString()} ₴
                </span>
              )}
            </div>
            
            {/* Stock Quantity Info — залишок для ОБРАНОГО варіанту (розмір/колір), якщо він визначений */}
            {isSelectedVariantAvailable && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-success">✓ В наявності</span>
                {typeof effectiveStock === "number" && (
                  <span className="text-muted-foreground">
                    ({effectiveStock > 99 ? "99+" : effectiveStock} шт)
                  </span>
                )}
                {/* Low Stock FOMO Badge */}
                {typeof effectiveStock === "number" && effectiveStock > 0 && effectiveStock <= 5 && (
                  <LowStockBadge quantity={effectiveStock} />
                )}
              </div>
            )}
            {!isSelectedVariantAvailable && (
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

        {showRelatedColors && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Колір{relatedColors.length > 1 ? ` (${relatedColors.length})` : ""}
            </div>
            <div className="flex flex-wrap gap-4">
              {relatedColors.map((variant) => {
                const isActive = String(variant.product_id) === String(product.id);
                const label = variant.color || "колір";
                // Кружечок кольору має показувати ФОТО, а не відео — CSS/img
                // не вміє відрендерити .mp4/.webm як прев'ю. Спершу шукаємо
                // перше НЕ-відео медіа серед усіх фото товару, і лише якщо
                // його нема (напр. у товару взагалі тільки відео) — падаємо
                // на letter-аватар із сірим фоном.
                const rawThumbUrl =
                  firstPhotoUrl(variant.images) ||
                  (variant.image_url && !isVideoUrl(variant.image_url) ? variant.image_url : "");
                // Якщо це саме посилання вже раз впало з onError — більше не
                // пробуємо його рендерити, одразу йдемо на HEX-фолбек.
                const thumbUrl = colorThumbErrors[variant.product_id] ? "" : rawThumbUrl;
                return (
                  <button
                    key={variant.product_id}
                    type="button"
                    onClick={() => {
                      if (isActive) return;
                      hapticImpact("light");
                      navigate(`/product/${variant.product_id}`);
                    }}
                    className="flex flex-col items-center gap-1.5 min-w-[64px] active:scale-95"
                    aria-label={label}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {thumbUrl ? (
                      <span
                        className={cn(
                          "h-16 w-16 rounded-full overflow-hidden border-[3px] bg-muted shadow-sm transition-all",
                          isActive
                            ? "border-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                            : "border-border"
                        )}
                      >
                        <img
                          src={thumbUrl}
                          alt={label}
                          className="h-full w-full object-cover"
                          onError={() =>
                            setColorThumbErrors((prev) => ({ ...prev, [variant.product_id]: true }))
                          }
                        />
                      </span>
                    ) : (
                      // Нема жодного фото (лише відео або взагалі нічого) —
                      // просто суцільний HEX-колір самого товару замість
                      // нейтрального сірого фону, без жодного тексту/літери
                      // всередині.
                      <span
                        className={cn(
                          "h-16 w-16 rounded-full border-[3px] shadow-sm transition-all",
                          isActive
                            ? "border-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                            : "border-border"
                        )}
                        style={{ backgroundColor: getColorHex(variant.color) }}
                      />
                    )}
                    <span
                      className={cn(
                        "text-xs max-w-[80px] truncate",
                        isActive ? "font-semibold text-primary" : "text-muted-foreground"
                      )}
                    >
                      {variant.color || (isActive ? "поточний" : "колір")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showInlineColors && (
          <ProductVariantSelector
            label="Колір"
            options={product.colors ?? []}
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
        {((product.sizes?.length && !selectedSize) || (showInlineColors && !selectedColor)) && (
          <p className="text-sm text-warning bg-warning/10 rounded-lg px-3 py-2">
            ⚠️ {!selectedSize && product.sizes?.length ? "Оберіть розмір" : ""} 
            {!selectedSize && product.sizes?.length && showInlineColors && !selectedColor ? " та " : ""}
            {showInlineColors && !selectedColor ? "Оберіть колір" : ""}
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
              onClick={() =>
                setQuantity((prev) =>
                  typeof effectiveStock === "number" ? Math.min(prev + 1, Math.max(effectiveStock, 1)) : prev + 1
                )
              }
              disabled={typeof effectiveStock === "number" && quantity >= effectiveStock}
              className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 disabled:opacity-50 transition-all"
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
              від {effectivePrice < 500 ? 50 : effectivePrice < 1000 ? 60 : 70} ₴
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
                  <p className="text-left text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                    {formatProductDescription(product.ai_description)}
                  </p>
                </div>
              )}
              
              {/* Опис: HTML-теги прибираємо, \\n лишаємо (whitespace-pre-wrap) */}
              <p className="text-left text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                {formatProductDescription(product.description) || "Опис товару відсутній"}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="specs" className="mt-4">
            {(product.characteristics?.length ?? 0) > 0 ? (
              <div>
                {product.characteristics!.map((char, index) => (
                  <div key={`${char.name}-${index}`} className="flex justify-between py-2 border-b">
                    <span className="text-gray-500">{char.name}</span>
                    <span className="font-medium text-right">{char.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                Характеристики не вказані
              </p>
            )}

            {product.vendor_code && (
              <div className="mt-4 pt-2">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-500">Артикул</span>
                  <span className="font-medium text-right font-mono">{product.vendor_code}</span>
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

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border p-4 safe-area-pb bg-card">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <span className="text-xs text-muted-foreground">Разом:</span>
            <div className="text-xl font-bold text-foreground">
              {(effectivePrice * quantity).toLocaleString()} ₴
            </div>
          </div>
          <Button
            onClick={handleAddToCart}
            disabled={
              !isSelectedVariantAvailable ||
              (!!product.sizes?.length && !selectedSize) ||
              (showInlineColors && !selectedColor)
            }
            className={cn(
              "flex-1 py-6 rounded-xl font-semibold text-base",
              "flex items-center justify-center gap-2"
            )}
          >
            <ShoppingCart className="h-5 w-5" />
            {(product.sizes?.length && !selectedSize) || (showInlineColors && !selectedColor)
              ? "Оберіть варіант"
              : !isSelectedVariantAvailable
                ? "Немає в наявності"
                : "Додати до кошика"
            }
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;

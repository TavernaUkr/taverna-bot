import { ShoppingCart, Heart, Package, Star, TrendingUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { LowStockBadge } from "./product/LowStockBadge";
import { VerifiedBadge } from "./ui/verified-badge";
import { FindSimilarButton } from "./product/FindSimilarButton";
import { VariantSelectionModal } from "./product/VariantSelectionModal";
import { useState } from "react";
import { hapticImpact } from "@/lib/haptics";
import type { BackendProductVariant, BackendProductOption } from "@/lib/backendApi";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  videoUrl?: string;
  category?: string;
  inStock?: boolean;
  stockQuantity?: number;
  sizes?: string[];
  colors?: string[];
  // Оригінальні варіанти/опції товару з бекенду (з `id` = variant_id).
  // Потрібні, щоб зрозуміти, скільки насправді варіантів у товару (>1 =>
  // треба обрати розмір/колір через модалку) і, якщо варіант один — узяти
  // саме його `id` для кошика без модалки.
  variants?: BackendProductVariant[];
  options?: BackendProductOption[];
  rating?: number;
  reviewCount?: number;
  isFavorite?: boolean;
  isBoosted?: boolean;
  viewsCount?: number;
  supplierRating?: number;
  supplierVerified?: boolean;
  aiTags?: string[];
  onClick?: () => void;
  onAddToCart?: (size?: string, color?: string, variantId?: string, quantity?: number) => void;
  onToggleFavorite?: () => void;
}

const colorMap: Record<string, { abbr: string; color: string }> = {
  "чорний": { abbr: "Чрн", color: "#000000" },
  "black": { abbr: "Чрн", color: "#000000" },
  "білий": { abbr: "Біл", color: "#ffffff" },
  "white": { abbr: "Біл", color: "#ffffff" },
  "олива": { abbr: "Олв", color: "#556b2f" },
  "olive": { abbr: "Олв", color: "#556b2f" },
  "хакі": { abbr: "Хкі", color: "#c3b091" },
  "khaki": { abbr: "Хкі", color: "#c3b091" },
  "сірий": { abbr: "Сір", color: "#808080" },
  "gray": { abbr: "Сір", color: "#808080" },
  "зелений": { abbr: "Злн", color: "#228b22" },
  "green": { abbr: "Злн", color: "#228b22" },
  "синій": { abbr: "Снй", color: "#0000cd" },
  "blue": { abbr: "Снй", color: "#0000cd" },
  "коричневий": { abbr: "Крч", color: "#8b4513" },
  "brown": { abbr: "Крч", color: "#8b4513" },
  "бежевий": { abbr: "Бжв", color: "#f5f5dc" },
  "beige": { abbr: "Бжв", color: "#f5f5dc" },
  "червоний": { abbr: "Чрв", color: "#dc143c" },
  "red": { abbr: "Чрв", color: "#dc143c" },
  "мультикам": { abbr: "Мкм", color: "#6b8e23" },
  "multicam": { abbr: "Мкм", color: "#6b8e23" },
  "песочний": { abbr: "Псч", color: "#c2b280" },
  "sand": { abbr: "Псч", color: "#c2b280" },
};

const getColorInfo = (colorName: string) => {
  const normalized = colorName.toLowerCase().trim();
  return colorMap[normalized] || { abbr: colorName.slice(0, 3), color: "#888888" };
};

export const ProductCard = ({
  id,
  name,
  price,
  originalPrice,
  image,
  videoUrl,
  category,
  inStock = true,
  stockQuantity,
  sizes,
  colors,
  variants,
  options,
  rating,
  reviewCount,
  isFavorite = false,
  isBoosted = false,
  viewsCount,
  supplierRating,
  supplierVerified = false,
  aiTags,
  onClick,
  onAddToCart,
  onToggleFavorite,
}: ProductCardProps) => {
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  // Товар "має опції" (розмір/колір), якщо є розміри/кольори АБО просто
  // більше одного варіанту в БД (навіть без розмірів/кольорів — напр. інші
  // типи опцій). У такому разі кошик НЕ повинен вгадувати variant_id.
  const hasOptions = Boolean(
    (sizes && sizes.length > 0) || (colors && colors.length > 0) || (variants && variants.length > 1)
  );
  // Якщо опцій немає — товар має рівно 1 (базовий) варіант. Саме його `id`
  // підставляємо в кошик при швидкому додаванні через "+" на картці.
  const singleVariant = !hasOptions
    ? variants?.find((v) => v.is_available && v.quantity > 0) ?? variants?.[0]
    : undefined;
  const marketingOldPrice = Math.ceil(price * 1.18 / 50) * 50;
  const discount = Math.round((1 - price / marketingOldPrice) * 100);
  const displaySizes = sizes?.slice(0, 4) || [];
  const hasMoreSizes = sizes && sizes.length > 4;
  const displayColors = colors?.slice(0, 4) || [];
  const hasMoreColors = colors && colors.length > 4;
  const isVerifiedSupplier = supplierVerified || (supplierRating !== undefined && supplierRating >= 4.5);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    hapticImpact("medium");
    if (hasOptions) {
      // Товар має розміри/кольори — додавати "навмання" без variant_id
      // небезпечно (замовлення на бекенді його не приймуть). Відкриваємо
      // модалку вибору варіанту прямо над карткою каталогу.
      setIsVariantModalOpen(true);
      return;
    }
    // Опцій немає — одразу додаємо єдиний варіант товару з його variant_id.
    onAddToCart?.(undefined, undefined, singleVariant ? String(singleVariant.id) : undefined, 1);
  };

  const handleVariantAddToCart = (
    selectedSize?: string,
    selectedColor?: string,
    variantId?: string,
    quantity?: number
  ) => {
    onAddToCart?.(selectedSize, selectedColor, variantId, quantity);
  };

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    hapticImpact("light");
    onToggleFavorite?.();
  };

  return (
    <div
      className={cn(
        "group relative bg-card rounded-xl overflow-hidden border border-border active:scale-[0.98] transition-transform duration-150",
        isBoosted && "ring-1.5 ring-primary/40"
      )}
      onClick={onClick}
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-muted">
        {/* Boosted badge */}
        {isBoosted && (
          <div className="absolute top-0 left-0 right-0 z-20 bg-primary text-primary-foreground text-[10px] font-semibold py-1 text-center flex items-center justify-center gap-1">
            <TrendingUp className="h-3 w-3" />
            <span>ТОП</span>
          </div>
        )}

        {videoUrl && (
          <video
            src={videoUrl}
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10"
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
        )}
        <img
          src={image}
          alt={name}
          className="w-full h-full object-cover"
        />

        {/* Low stock */}
        {inStock && stockQuantity !== undefined && stockQuantity > 0 && stockQuantity <= 5 && (
          <div className={cn("absolute left-1/2 -translate-x-1/2 z-15", isBoosted ? "top-9" : "top-2")}>
            <LowStockBadge quantity={stockQuantity} animated={true} />
          </div>
        )}

        {/* Discount badge */}
        {discount > 0 && inStock && (
          <div className={cn("absolute left-2 z-10", isBoosted ? "top-9" : "top-2")}>
            <span className="bg-live text-live-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-md">
              -{discount}%
            </span>
          </div>
        )}

        {/* Favorite button */}
        <button
          onClick={handleToggleFavorite}
          className={cn(
            "absolute right-2 w-8 h-8 rounded-full flex items-center justify-center z-20",
            isBoosted ? "top-9" : "top-2",
            isFavorite
              ? "bg-live text-live-foreground"
              : "bg-card/80 backdrop-blur-sm text-muted-foreground"
          )}
        >
          <Heart className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} />
        </button>

        {/* Verified */}
        {isVerifiedSupplier && (
          <div className={cn("absolute right-11 z-20", isBoosted ? "top-9" : "top-2")}>
            <VerifiedBadge size="sm" showTooltip />
          </div>
        )}

        {/* Category pill */}
        {category && (
          <div className="absolute bottom-2 left-2 bg-foreground/70 text-background text-[10px] font-medium px-2 py-0.5 rounded-full z-10">
            {category}
          </div>
        )}

        {/* Out of stock */}
        {!inStock && (
          <div className="absolute inset-0 bg-background/75 flex items-center justify-center">
            <span className="text-xs font-medium text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
              Немає в наявності
            </span>
          </div>
        )}

        {/* Cart button — якщо товар має опції (розмір/колір), відкриває
            модалку вибору варіанту замість "наосліп" додавання без variant_id */}
        {inStock && (
          <button
            onClick={handleAddToCart}
            aria-label={hasOptions ? "Обрати розмір/колір" : "Додати в кошик"}
            title={hasOptions ? "Обрати розмір/колір" : "Додати в кошик"}
            className="absolute bottom-2 right-2 w-9 h-9 rounded-full z-30 bg-primary text-primary-foreground flex items-center justify-center active:scale-90 transition-transform"
          >
            <ShoppingCart className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-[13px] font-medium text-card-foreground line-clamp-2 min-h-[36px] leading-snug">
          {name}
        </h3>

        {/* Rating */}
        {rating !== undefined && rating > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={cn(
                    "h-3 w-3",
                    star <= Math.round(rating) ? "text-warning fill-warning" : "text-muted/40"
                  )}
                />
              ))}
            </div>
            {reviewCount !== undefined && reviewCount > 0 && (
              <span className="text-[10px] text-muted-foreground">({reviewCount})</span>
            )}
          </div>
        )}

        {/* Price row */}
        <div className="mt-2 flex items-end justify-between gap-1">
          <div>
            <span className="text-lg font-bold text-primary">{price.toLocaleString()} ₴</span>
            {inStock && (
              <span className="block text-[10px] text-muted-foreground line-through">
                {marketingOldPrice.toLocaleString()} ₴
              </span>
            )}
          </div>

          {/* Variants compact */}
          <div className="flex flex-col items-end gap-0.5">
            {inStock && stockQuantity !== undefined && stockQuantity > 0 && (
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Package className="h-2.5 w-2.5" /> {stockQuantity > 99 ? "99+" : stockQuantity}
              </span>
            )}
            {displayColors.length > 0 && (
              <div className="flex items-center gap-0.5">
                {displayColors.map((color, idx) => {
                  const info = getColorInfo(color);
                  return (
                    <span
                      key={idx}
                      className="w-3 h-3 rounded-full border border-border"
                      style={{ backgroundColor: info.color }}
                      title={color}
                    />
                  );
                })}
                {hasMoreColors && <span className="text-[8px] text-muted-foreground">+{colors!.length - 4}</span>}
              </div>
            )}
            {displaySizes.length > 0 && (
              <div className="flex items-center gap-0.5">
                {displaySizes.map((size, idx) => (
                  <span key={idx} className="text-[8px] bg-muted px-1 py-0.5 rounded font-medium">{size}</span>
                ))}
                {hasMoreSizes && <span className="text-[8px] text-muted-foreground">+{sizes!.length - 4}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Find similar */}
        <div className="mt-2 pt-2 border-t border-border/50">
          <FindSimilarButton
            productName={name}
            productCategory={category}
            productTags={aiTags}
            variant="chip"
          />
        </div>
      </div>

      <VariantSelectionModal
        isOpen={isVariantModalOpen}
        onClose={() => setIsVariantModalOpen(false)}
        productId={id}
        productName={name}
        productPrice={price}
        productImage={image}
        options={options}
        variants={variants}
        stockQuantity={stockQuantity}
        onAddToCart={handleVariantAddToCart}
      />
    </div>
  );
};

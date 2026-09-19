import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Heart, ImageOff, ShoppingCart, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { isVideoUrl } from "@/lib/media";
import { hapticImpact } from "@/lib/haptics";
import { vibrate } from "@/hooks/useTelegramUI";
import { VariantSelectionModal } from "@/components/product/VariantSelectionModal";
import type { BackendProductOption, BackendProductVariant } from "@/lib/backendApi";

/** Дані одного товару для картки в стрічці (TikTok-стиль). */
export interface ProductFeedItemData {
  id: string;
  name: string;
  price: number;
  images?: string[];
  supplier_name?: string;
  in_stock?: boolean;
  stock_quantity?: number;
  sizes?: string[];
  colors?: string[];
  // Фіксований колір ЦЬОГО товару (окремий товар-побратим за base_model_name,
  // а не опція вибору всередині товару). Показується пасивним чіпом у
  // модалці швидкого додавання в кошик.
  color?: string;
  variants?: BackendProductVariant[];
  options?: BackendProductOption[];
}

export interface ProductFeedItemProps {
  product: ProductFeedItemData;
  index: number;
  isFavorite: boolean;
  onProductClick: () => void;
  onAddToCart: (
    product: ProductFeedItemData,
    size?: string,
    color?: string,
    variantId?: string,
    quantity?: number
  ) => void;
  onToggleFavorite: () => void;
}

/**
 * Один "слайд" стрічки товарів у стилі TikTok: фото на весь екран,
 * стрілки гортання по центру, плаваючі кнопки (лайк/кошик) знизу справа.
 */
export function ProductFeedItem({
  product,
  index,
  isFavorite,
  onProductClick,
  onAddToCart,
  onToggleFavorite,
}: ProductFeedItemProps) {
  const images = (product.images || []).filter(Boolean);
  const [imageIndex, setImageIndex] = useState(0);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  // КРОК 3: захист від чорного екрану — якщо конкретне фото не завантажилось,
  // ховаємо <img> і показуємо світло-сірий блок "Фото недоступне" замість
  // биту іконку/чорний прямокутник браузера.
  const [imgError, setImgError] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Скидаємо стан помилки/індекс фото, якщо змінився сам товар або список
  // його фото (напр. стрічку перезавантажили з новими даними).
  useEffect(() => {
    setImgError(false);
    setImageIndex(0);
  }, [product.id, product.images]);

  const hasOptions = Boolean(
    (product.sizes && product.sizes.length > 0) ||
      (product.colors && product.colors.length > 0) ||
      (product.variants && product.variants.length > 1)
  );
  const singleVariant = !hasOptions
    ? product.variants?.find((v) => v.is_available && v.quantity > 0) ?? product.variants?.[0]
    : undefined;
  const currentImage = images[imageIndex] || images[0];
  const showPlaceholder = images.length === 0 || imgError;
  const currentIsVideo = isVideoUrl(currentImage);

  const showImage = (next: number) => {
    if (images.length < 2) return;
    setImgError(false);
    setImageIndex((next + images.length) % images.length);
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const delta = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    showImage(imageIndex + (delta < 0 ? 1 : -1));
  };

  const handleAddToCart = (event: React.MouseEvent) => {
    event.stopPropagation();
    vibrate("light");
    if (hasOptions) {
      setIsVariantModalOpen(true);
      return;
    }
    onAddToCart(product, undefined, undefined, singleVariant ? String(singleVariant.id) : undefined, 1);
  };

  const handleFavorite = (event: React.MouseEvent) => {
    event.stopPropagation();
    hapticImpact("light");
    onToggleFavorite();
  };

  return (
    <section
      data-feed-slide
      data-feed-index={index}
      className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-neutral-900"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={onProductClick}
      >
        {!showPlaceholder && currentImage ? (
          <AnimatePresence mode="wait">
            {currentIsVideo ? (
              <motion.video
                key={`${product.id}-${imageIndex}`}
                src={currentImage}
                className="h-[100dvh] w-full object-cover"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.28 }}
                autoPlay
                loop
                muted
                playsInline
                onError={() => setImgError(true)}
              />
            ) : (
              <motion.img
                key={`${product.id}-${imageIndex}`}
                src={currentImage}
                alt={product.name}
                className="h-[100dvh] w-full object-cover"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.28 }}
                onError={() => setImgError(true)}
              />
            )}
          </AnimatePresence>
        ) : (
          // Світло-сіра заглушка замість чорного екрану/битої іконки.
          <div className="h-[100dvh] w-full flex flex-col items-center justify-center gap-2 bg-neutral-200 text-neutral-400">
            <ImageOff className="h-10 w-10" />
            <span className="text-sm font-medium">Фото недоступне</span>
          </div>
        )}
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              showImage(imageIndex - 1);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/35 text-white flex items-center justify-center"
            aria-label="Попереднє фото"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              showImage(imageIndex + 1);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/35 text-white flex items-center justify-center"
            aria-label="Наступне фото"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] left-0 right-0 z-10 flex justify-center gap-1.5">
            {images.map((_, dotIndex) => (
              <span
                key={dotIndex}
                className={cn(
                  "h-1 rounded-full transition-all",
                  dotIndex === imageIndex ? "w-5 bg-white" : "w-1.5 bg-white/40"
                )}
              />
            ))}
          </div>
        </>
      )}

      {/* Плаваючі кнопки — під правою стрілкою, ніколи її не перекривають. */}
      <div className="absolute bottom-32 right-4 flex flex-col gap-6 z-50">
        <motion.button
          type="button"
          onClick={handleFavorite}
          whileTap={{ scale: 0.88 }}
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center shadow-lg",
            isFavorite ? "bg-live text-live-foreground" : "bg-black/45 text-white"
          )}
          aria-label="В обране"
        >
          <motion.span animate={{ scale: isFavorite ? 1.15 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
            <Heart className={cn("h-6 w-6", isFavorite && "fill-current")} />
          </motion.span>
        </motion.button>
        <motion.button
          type="button"
          onClick={handleAddToCart}
          whileTap={{ scale: 0.88 }}
          disabled={product.in_stock === false}
          className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg disabled:opacity-40"
          aria-label="Додати в кошик"
        >
          <ShoppingCart className="h-6 w-6" />
        </motion.button>
      </div>

      <motion.div
        className="pointer-events-none absolute left-0 right-0 bottom-0 z-10 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16 pr-20 bg-gradient-to-t from-black via-black/75 to-transparent"
        initial={{ y: 20, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: false, amount: 0.4 }}
        transition={{ duration: 0.28 }}
      >
        {product.supplier_name && (
          <p className="flex items-center gap-1.5 text-xs text-white/75 mb-1">
            <Store className="h-3.5 w-3.5" />
            <span className="truncate">{product.supplier_name}</span>
          </p>
        )}
        <button type="button" onClick={onProductClick} className="pointer-events-auto text-left max-w-[calc(100%-1rem)]">
          <h3 className="text-white text-lg font-semibold leading-snug line-clamp-2">{product.name}</h3>
        </button>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="text-2xl font-bold text-white">{product.price.toLocaleString()} ₴</p>
          <span
            className={cn(
              "text-[11px] font-semibold px-2 py-1 rounded-full",
              product.in_stock === false ? "bg-white/15 text-white/70" : "bg-emerald-500/90 text-white"
            )}
          >
            {product.in_stock === false ? "Немає" : "В наявності"}
          </span>
        </div>
      </motion.div>

      <VariantSelectionModal
        isOpen={isVariantModalOpen}
        onClose={() => setIsVariantModalOpen(false)}
        productId={product.id}
        productName={product.name}
        productPrice={product.price}
        productImage={currentImage || ""}
        options={product.options}
        variants={product.variants}
        stockQuantity={product.stock_quantity}
        fixedColor={product.color}
        onAddToCart={(size, color, variantId, quantity) =>
          onAddToCart(product, size, color, variantId, quantity)
        }
      />
    </section>
  );
}

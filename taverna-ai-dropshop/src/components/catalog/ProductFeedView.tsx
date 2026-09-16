import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Heart,
  ShoppingCart,
  Store,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticImpact } from "@/lib/haptics";
import { vibrate } from "@/hooks/useTelegramUI";
import { VariantSelectionModal } from "@/components/product/VariantSelectionModal";
import { useFloatingToolsOptional } from "@/components/floating/FloatingToolsContext";
import type { BackendProductOption, BackendProductVariant } from "@/lib/backendApi";

export interface ProductFeedItem {
  id: string;
  name: string;
  price: number;
  images?: string[];
  supplier_name?: string;
  in_stock?: boolean;
  stock_quantity?: number;
  sizes?: string[];
  colors?: string[];
  variants?: BackendProductVariant[];
  options?: BackendProductOption[];
}

interface ProductFeedViewProps {
  isOpen: boolean;
  products: ProductFeedItem[];
  isFavorite: (id: string) => boolean;
  onClose: () => void;
  onProductClick: (id: string) => void;
  onAddToCart: (
    product: ProductFeedItem,
    size?: string,
    color?: string,
    variantId?: string,
    quantity?: number
  ) => void;
  onToggleFavorite: (product: ProductFeedItem) => void;
}

export function ProductFeedView({
  isOpen,
  products,
  isFavorite,
  onClose,
  onProductClick,
  onAddToCart,
  onToggleFavorite,
}: ProductFeedViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const setFeedOpen = useFloatingToolsOptional()?.setFeedOpen;

  useEffect(() => {
    setFeedOpen?.(isOpen);
    return () => setFeedOpen?.(false);
  }, [isOpen, setFeedOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setActiveIndex(0);
    scrollRef.current?.scrollTo({ top: 0 });
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !scrollRef.current) return;
    const root = scrollRef.current;
    const slides = Array.from(root.querySelectorAll<HTMLElement>("[data-feed-slide]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = Number(visible.target.getAttribute("data-feed-index") || 0);
        setActiveIndex(index);
        hapticImpact("light");
      },
      { root, threshold: 0.65 }
    );
    slides.forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [isOpen, products]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[45] bg-black"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-black/70 to-transparent">
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-black/40 text-white flex items-center justify-center"
              aria-label="Закрити стрічку"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="text-center text-white">
              <p className="text-sm font-semibold">Стрічка товарів</p>
              <p className="text-[11px] text-white/70">
                {products.length === 0 ? "Немає товарів" : `${activeIndex + 1} / ${products.length}`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-black/40 text-white flex items-center justify-center"
              aria-label="Закрити"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="h-dvh overflow-y-auto snap-y snap-mandatory scrollbar-hide overscroll-y-contain"
          >
            {products.map((product, index) => (
              <ProductFeedSlide
                key={product.id}
                product={product}
                index={index}
                isFavorite={isFavorite(product.id)}
                onProductClick={() => onProductClick(product.id)}
                onAddToCart={onAddToCart}
                onToggleFavorite={() => onToggleFavorite(product)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ProductFeedSlide({
  product,
  index,
  isFavorite,
  onProductClick,
  onAddToCart,
  onToggleFavorite,
}: {
  product: ProductFeedItem;
  index: number;
  isFavorite: boolean;
  onProductClick: () => void;
  onAddToCart: ProductFeedViewProps["onAddToCart"];
  onToggleFavorite: () => void;
}) {
  const images = (product.images || []).filter(Boolean);
  const [imageIndex, setImageIndex] = useState(0);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const hasOptions = Boolean(
    (product.sizes && product.sizes.length > 0) ||
      (product.colors && product.colors.length > 0) ||
      (product.variants && product.variants.length > 1)
  );
  const singleVariant = !hasOptions
    ? product.variants?.find((v) => v.is_available && v.quantity > 0) ?? product.variants?.[0]
    : undefined;
  const currentImage = images[imageIndex] || images[0];

  const showImage = (next: number) => {
    if (images.length < 2) return;
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
      className="relative h-dvh w-full snap-start snap-always overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-neutral-900"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={onProductClick}
      >
        {currentImage ? (
          <AnimatePresence mode="wait">
            <motion.img
              key={`${product.id}-${imageIndex}`}
              src={currentImage}
              alt={product.name}
              className="absolute inset-0 w-full h-full object-cover"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.28 }}
            />
          </AnimatePresence>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/50">
            Немає фото
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
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/35 text-white flex items-center justify-center"
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
            className="absolute right-16 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/35 text-white flex items-center justify-center"
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

      <div className="absolute right-3 bottom-[13.75rem] z-20 flex flex-col items-center gap-3">
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
        onAddToCart={(size, color, variantId, quantity) =>
          onAddToCart(product, size, color, variantId, quantity)
        }
      />
    </section>
  );
}

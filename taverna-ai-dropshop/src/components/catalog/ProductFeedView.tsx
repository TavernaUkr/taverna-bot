import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import { hapticImpact } from "@/lib/haptics";
import { useFloatingToolsOptional } from "@/components/floating/FloatingToolsContext";
import { ProductFeedItem, type ProductFeedItemData } from "@/components/product/ProductFeedItem";

// Реекспорт під старою назвою — тип даних товару стрічки тепер живе в
// ProductFeedItem.tsx (разом з UI-компонентом одного слайду), щоб не
// плодити дві копії однієї моделі даних.
export type { ProductFeedItemData as ProductFeedItem };

interface ProductFeedViewProps {
  isOpen: boolean;
  products: ProductFeedItemData[];
  isFavorite: (id: string) => boolean;
  onClose: () => void;
  onProductClick: (id: string) => void;
  onAddToCart: (
    product: ProductFeedItemData,
    size?: string,
    color?: string,
    variantId?: string,
    quantity?: number
  ) => void;
  onToggleFavorite: (product: ProductFeedItemData) => void;
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
          className="fixed inset-0 z-[9999] bg-black h-[100dvh] w-full"
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
            className="h-[100dvh] w-full overflow-y-auto snap-y snap-mandatory scrollbar-hide overscroll-y-contain"
          >
            {products.map((product, index) => (
              <ProductFeedItem
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

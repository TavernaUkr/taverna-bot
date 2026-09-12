import { useState, useMemo } from "react";
import { ShoppingCart, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProductVariantSelector } from "./ProductVariantSelector";
import { hapticImpact } from "@/lib/haptics";
import { toast } from "sonner";
import type { BackendProductOption, BackendProductVariant } from "@/lib/backendApi";

interface VariantSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  sizes?: string[];
  colors?: string[];
  // Оригінальні опції/варіанти з бекенду — потрібні, щоб знайти ТОЧНИЙ
  // variant_id для обраної комбінації розмір+колір (як у ProductDetail.tsx).
  options?: BackendProductOption[];
  variants?: BackendProductVariant[];
  onAddToCart: (size?: string, color?: string, variantId?: string) => void;
}

export function VariantSelectionModal({
  isOpen,
  onClose,
  productId,
  productName,
  productPrice,
  productImage,
  sizes,
  colors,
  options,
  variants,
  onAddToCart,
}: VariantSelectionModalProps) {
  const navigate = useNavigate();
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const hasRequiredSizes = Boolean(sizes && sizes.length > 0);
  const hasRequiredColors = Boolean(colors && colors.length > 0);

  /**
   * Той самий пошук ТОЧНОГО variant_id за обраною комбінацією розмір+колір,
   * що і в ProductDetail.tsx (`selectedVariant`). Без цього кошик отримав би
   * лише рядки size/color без прив'язки до конкретної ціни/залишку варіанту.
   */
  const selectedVariant = useMemo<BackendProductVariant | undefined>(() => {
    if (!variants?.length) return undefined;

    // Товар без розмірів/кольорів -> завжди один (перший доступний) варіант.
    if (!hasRequiredSizes && !hasRequiredColors) {
      return variants.find((v) => v.is_available && v.quantity > 0) ?? variants[0];
    }

    const sizeOption = options?.find((o) => /розмір|size/i.test(o.name));
    const colorOption = options?.find((o) => /колір|цвет|color/i.test(o.name));

    const sizeValueId = hasRequiredSizes ? sizeOption?.values.find((v) => v.value === selectedSize)?.id : undefined;
    const colorValueId = hasRequiredColors ? colorOption?.values.find((v) => v.value === selectedColor)?.id : undefined;

    if (hasRequiredSizes && !selectedSize) return undefined;
    if (hasRequiredColors && !selectedColor) return undefined;
    // Розмір/колір обрано в UI, але ще не змаплено на option_value_id — чекаємо.
    if ((hasRequiredSizes && sizeValueId === undefined) || (hasRequiredColors && colorValueId === undefined)) {
      return undefined;
    }

    return variants.find((v) => {
      const ids = v.option_value_ids ?? [];
      if (hasRequiredSizes && !ids.includes(sizeValueId as number)) return false;
      if (hasRequiredColors && !ids.includes(colorValueId as number)) return false;
      return true;
    });
  }, [variants, options, hasRequiredSizes, hasRequiredColors, selectedSize, selectedColor]);

  // Чи взагалі бекенд віддав variants для цього товару. Якщо ні (старі
  // дані без варіантів) — не блокуємо кнопку через відсутність variantId,
  // перевіряємо лише вибір розміру/кольору (як було раніше).
  const variantsProvided = Boolean(variants && variants.length > 0);
  const isVariantResolved = !variantsProvided || Boolean(selectedVariant);
  const isVariantAvailable = !selectedVariant || (selectedVariant.is_available && selectedVariant.quantity > 0);

  const canAddToCart =
    (!hasRequiredSizes || Boolean(selectedSize)) &&
    (!hasRequiredColors || Boolean(selectedColor)) &&
    isVariantResolved &&
    isVariantAvailable;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (hasRequiredSizes && !selectedSize) {
      toast.error("Оберіть розмір");
      return;
    }
    if (hasRequiredColors && !selectedColor) {
      toast.error("Оберіть колір");
      return;
    }
    if (!isVariantResolved) {
      toast.error("Цей варіант тимчасово недоступний");
      return;
    }
    if (!isVariantAvailable) {
      toast.error("Обраної комбінації немає в наявності");
      return;
    }

    hapticImpact("medium");
    // Сам toast "додано до кошика" показує батьківський onAddToCart (той
    // самий handleAddToCart у Index.tsx/SearchResults.tsx, який вже це
    // робить після успішного addItem) — тут його НЕ дублюємо.
    onAddToCart(
      selectedSize || undefined,
      selectedColor || undefined,
      selectedVariant ? String(selectedVariant.id) : undefined
    );

    // Reset selections and close modal
    setSelectedSize(null);
    setSelectedColor(null);
    onClose();
  };

  const handleViewProduct = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    hapticImpact("light");
    onClose();
    navigate(`/product/${productId}`);
  };

  const handleSizeSelect = (size: string) => {
    hapticImpact("light");
    setSelectedSize(size);
  };

  const handleColorSelect = (color: string) => {
    hapticImpact("light");
    setSelectedColor(color);
  };

  const handleModalClose = () => {
    setSelectedSize(null);
    setSelectedColor(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Оберіть параметри
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          {/* Product preview */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-xl">
            <img
              src={productImage}
              alt={productName}
              className="w-16 h-16 object-cover rounded-lg"
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm text-foreground line-clamp-2">
                {productName}
              </h4>
              <p className="text-lg font-bold text-primary mt-1">
                {(selectedVariant?.final_price ?? productPrice).toLocaleString()} ₴
              </p>
            </div>
          </div>

          {/* Size selector */}
          {hasRequiredSizes && (
            <div onClick={(e) => e.stopPropagation()}>
              <ProductVariantSelector
                label="Розмір"
                options={sizes}
                selected={selectedSize}
                onSelect={handleSizeSelect}
                type="button"
              />
            </div>
          )}

          {/* Color selector */}
          {hasRequiredColors && (
            <div onClick={(e) => e.stopPropagation()}>
              <ProductVariantSelector
                label="Колір"
                options={colors}
                selected={selectedColor}
                onSelect={handleColorSelect}
                type="color"
              />
            </div>
          )}

          {/* Validation message */}
          {!canAddToCart && (
            <p className="text-sm text-warning bg-warning/10 rounded-lg px-3 py-2">
              ⚠️ {hasRequiredSizes && !selectedSize ? "Оберіть розмір" : ""}
              {hasRequiredSizes && !selectedSize && hasRequiredColors && !selectedColor ? " та " : ""}
              {hasRequiredColors && !selectedColor ? "Оберіть колір" : ""}
              {(!hasRequiredSizes || selectedSize) && (!hasRequiredColors || selectedColor) && !isVariantAvailable
                ? "Немає в наявності для цієї комбінації"
                : ""}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="button"
              onClick={handleAddToCart}
              disabled={!canAddToCart}
              className="w-full gap-2"
            >
              <ShoppingCart className="h-4 w-4" />
              Додати в кошик
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleViewProduct}
              className="w-full gap-2"
            >
              Детальніше про товар
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

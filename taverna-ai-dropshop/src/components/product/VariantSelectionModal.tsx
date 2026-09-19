import { useState, useMemo, useEffect } from "react";
import { ShoppingCart, ChevronRight, Minus, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProductVariantSelector } from "./ProductVariantSelector";
import { isVideoUrl } from "@/lib/media";
import { hapticImpact } from "@/lib/haptics";
import { vibrate } from "@/hooks/useTelegramUI";
import { useModalHistory } from "@/hooks/useModalHistory";
import { toast } from "sonner";
import type { BackendProductOption, BackendProductVariant } from "@/lib/backendApi";

interface VariantSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  // Опції/варіанти напряму з бекенду (FastAPI) — ЄДИНЕ джерело правди для
  // рендеру кнопок розміру/кольору і для пошуку variant_id. Рядкові масиви
  // sizes/colors тут більше не потрібні, щоб не тримати дві копії тих самих
  // даних, які можуть розійтися.
  options?: BackendProductOption[];
  variants?: BackendProductVariant[];
  // Загальний залишок товару — запасний варіант для лічильника кількості,
  // якщо конкретний variant_id ще не визначено (напр. поки не обрано колір).
  stockQuantity?: number;
  // Фіксований колір ЦЬОГО товару (коли колір — окремий товар-побратим за
  // base_model_name, а не "опція вибору" всередині товару). Вибору кольору
  // тут НЕ показуємо — лише пасивний чіп, щоб клієнт бачив, який колір додає.
  fixedColor?: string;
  onAddToCart: (size?: string, color?: string, variantId?: string, quantity?: number) => void;
}

export function VariantSelectionModal({
  isOpen,
  onClose,
  productId,
  productName,
  productPrice,
  productImage,
  options,
  variants,
  stockQuantity,
  fixedColor,
  onAddToCart,
}: VariantSelectionModalProps) {
  const navigate = useNavigate();
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  useModalHistory(isOpen, onClose);

  // Опції "Розмір" і "Колір" шукаємо в масиві options (той самий підхід,
  // що і в ProductDetail.tsx / useProducts.tsx) — це ЄДИНЕ місце, звідки
  // беруться і кнопки вибору, і id для пошуку variant_id.
  const sizeOption = useMemo(() => options?.find((o) => /розмір|размер|size/i.test(o.name)), [options]);
  const colorOption = useMemo(() => options?.find((o) => /колір|цвет|color/i.test(o.name)), [options]);

  const sizeValues = useMemo(() => sizeOption?.values.map((v) => v.value) ?? [], [sizeOption]);
  const colorValues = useMemo(() => colorOption?.values.map((v) => v.value) ?? [], [colorOption]);

  const hasRequiredSizes = sizeValues.length > 0;
  const hasRequiredColors = colorValues.length > 0;

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
  }, [variants, sizeOption, colorOption, hasRequiredSizes, hasRequiredColors, selectedSize, selectedColor]);

  // Чи взагалі бекенд віддав variants для цього товару. Якщо ні (старі
  // дані без варіантів) — не блокуємо кнопку через відсутність variantId,
  // перевіряємо лише вибір розміру/кольору (як було раніше).
  const variantsProvided = Boolean(variants && variants.length > 0);
  const isVariantResolved = !variantsProvided || Boolean(selectedVariant);
  const isVariantAvailable = !selectedVariant || (selectedVariant.is_available && selectedVariant.quantity > 0);

  // Максимум для лічильника кількості: залишок ОБРАНОГО варіанту, інакше —
  // загальний залишок товару, інакше — 1 (щоб стрілка "+" не була завжди мертва).
  const maxQuantity = Math.max(1, selectedVariant?.quantity ?? stockQuantity ?? 1);

  // Якщо після зміни розміру/кольору залишок обраного варіанту менший за
  // вже введену кількість — підрізаємо кількість автоматично.
  useEffect(() => {
    if (quantity > maxQuantity) {
      setQuantity(maxQuantity);
    }
  }, [maxQuantity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Кількість не може перевищувати залишок КОНКРЕТНОГО обраного варіанту.
  const isQuantityWithinStock = variantsProvided
    ? quantity <= (selectedVariant?.quantity || 0)
    : quantity <= maxQuantity;

  const canAddToCart =
    (!hasRequiredSizes || Boolean(selectedSize)) &&
    (!hasRequiredColors || Boolean(selectedColor)) &&
    isVariantResolved &&
    isVariantAvailable &&
    isQuantityWithinStock;

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
    if (!isQuantityWithinStock) {
      toast.error(`В наявності лише ${selectedVariant?.quantity ?? maxQuantity} шт.`);
      return;
    }

    vibrate("success");
    // Сам toast "додано до кошика" показує батьківський onAddToCart (той
    // самий handleAddToCart у Index.tsx/SearchResults.tsx, який вже це
    // робить після успішного addItem) — тут його НЕ дублюємо.
    onAddToCart(
      selectedSize || undefined,
      // Якщо в товару немає опції "Колір" для вибору — все одно передаємо
      // його фіксований колір (fixedColor), щоб кошик/замовлення показували
      // правильний колір, а не залишали поле порожнім.
      selectedColor || fixedColor || undefined,
      selectedVariant ? String(selectedVariant.id) : undefined,
      quantity
    );

    // Reset selections and close modal
    setSelectedSize(null);
    setSelectedColor(null);
    setQuantity(1);
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
    setQuantity(1);
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
            {isVideoUrl(productImage) ? (
              <video
                src={productImage}
                className="w-16 h-16 object-cover rounded-lg"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                src={productImage}
                alt={productName}
                className="w-16 h-16 object-cover rounded-lg"
              />
            )}
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm text-foreground line-clamp-2">
                {productName}
              </h4>
              <p className="text-lg font-bold text-primary mt-1">
                {(selectedVariant?.final_price ?? productPrice).toLocaleString()} ₴
              </p>
              {/* Пасивний чіп з кольором — показуємо ТІЛЬКИ якщо в товару
                  немає опції "Колір" для вибору (hasRequiredColors), інакше
                  колір і так обирається нижче через ProductVariantSelector. */}
              {!hasRequiredColors && fixedColor && (
                <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  Колір: <span className="text-foreground">{fixedColor}</span>
                </span>
              )}
            </div>
          </div>

          {/* Size selector */}
          {hasRequiredSizes && (
            <div onClick={(e) => e.stopPropagation()}>
              <ProductVariantSelector
                label="Розмір"
                options={sizeValues}
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
                options={colorValues}
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
              {(!hasRequiredSizes || selectedSize) &&
              (!hasRequiredColors || selectedColor) &&
              isVariantAvailable &&
              !isQuantityWithinStock
                ? `В наявності лише ${selectedVariant?.quantity ?? maxQuantity} шт.`
                : ""}
            </p>
          )}

          {/* Quantity */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Кількість</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuantity((prev) => Math.max(1, prev - 1));
                }}
                disabled={quantity <= 1}
                className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 disabled:opacity-50 transition-all"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center font-semibold text-base">{quantity}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuantity((prev) => Math.min(prev + 1, maxQuantity));
                }}
                disabled={quantity >= maxQuantity}
                className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 disabled:opacity-50 transition-all"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

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

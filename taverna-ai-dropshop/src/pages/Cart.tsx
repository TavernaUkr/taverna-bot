import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ShoppingBag, Minus, Plus, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Header } from "@/components/Header";
import { CheckoutModal } from "@/components/CheckoutModal";
import { useRegisterBack } from "@/hooks/useAppBack";
import { toast } from "sonner";
import { useCartStore, cartItemKey, type CartItem } from "@/store/cartStore";

// --- Один рядок кошика --------------------------------------------------------

const CartRow = ({ item }: { item: CartItem }) => {
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);

  const options = item.selectedOptions;
  const optionEntries = Object.entries(options ?? {});
  const image = item.product.images?.[0];

  const handleQuantity = (nextQuantity: number) => {
    if (nextQuantity <= 0) {
      removeItem(item.product.id, options, item.variantId);
      toast.success("Товар видалено з кошика");
      return;
    }
    updateQuantity(item.product.id, nextQuantity, options, item.variantId);
  };

  return (
    <div className="flex gap-3 p-3 bg-card rounded-xl border border-border">
      {/* Мініатюра */}
      <Link to={`/product/${item.product.id}`} className="shrink-0">
        {image ? (
          <img
            src={image}
            alt={item.product.name}
            className="w-20 h-20 rounded-lg object-cover bg-muted"
          />
        ) : (
          <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center">
            <Package className="h-8 w-8 text-muted-foreground/50" />
          </div>
        )}
      </Link>

      {/* Назва + опції + ціна */}
      <div className="flex-1 min-w-0">
        <Link to={`/product/${item.product.id}`}>
          <h3 className="font-medium text-sm text-foreground line-clamp-2 leading-snug">
            {item.product.name}
          </h3>
        </Link>

        {optionEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {optionEntries.map(([optName, optValue]) => (
              <span
                key={optName}
                className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full"
              >
                {optName}: {optValue}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-2">
          <span className="font-bold text-primary whitespace-nowrap">
            {item.product.price.toLocaleString()} ₴
          </span>
          <span className="text-xs text-muted-foreground">
            {(item.product.price * item.quantity).toLocaleString()} ₴ за {item.quantity} шт
          </span>
        </div>

        {/* Контролер кількості */}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => handleQuantity(item.quantity - 1)}
            aria-label="Зменшити кількість"
            className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center active:scale-90 transition-transform"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
          <button
            type="button"
            onClick={() => handleQuantity(item.quantity + 1)}
            aria-label="Збільшити кількість"
            className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center active:scale-90 transition-transform"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleQuantity(0)}
            aria-label="Видалити з кошика"
            className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center text-destructive ml-1 active:scale-90 transition-transform"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Сторінка ------------------------------------------------------------------

const Cart = () => {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const getTotalPrice = useCartStore((s) => s.getTotalPrice);
  const getTotalItems = useCartStore((s) => s.getTotalItems);
  const clearCart = useCartStore((s) => s.clearCart);

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // Кнопка «Назад» у Telegram закриває модалку чекауту, а не виходить з MiniApp
  useRegisterBack(isCheckoutOpen, () => setIsCheckoutOpen(false));

  const totalPrice = getTotalPrice();
  const totalItems = getTotalItems();

  const handleCheckout = () => {
    setIsCheckoutOpen(true);
  };

  const handleOrderComplete = (orderId: string) => {
    // Замовлення створено на бекенді → очищаємо кошик і закриваємо модалку
    setIsCheckoutOpen(false);
    clearCart();
    toast.success("Замовлення успішно оформлено!");
    navigate("/?tab=account");
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        onCartClick={() => navigate("/cart")}
        onSearchClick={() => navigate("/catalog")}
        onNotificationsClick={() => toast.info("Сповіщення")}
        onFavoritesClick={() => navigate("/")}
      />

      <main className="px-4 pt-3 pb-40 max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Кошик</h1>
          {totalItems > 0 && (
            <span className="text-sm text-muted-foreground">
              · {totalItems} {totalItems === 1 ? "товар" : "товарів"}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center">
            <EmptyState
              type="cart"
              title="Кошик порожній"
              description="Додайте товари з каталогу, щоб оформити замовлення"
            />
            <Button onClick={() => navigate("/")} className="w-full max-w-xs -mt-2 mb-8" size="lg">
              До покупок
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <CartRow key={cartItemKey(item.product.id, item.selectedOptions, item.variantId)} item={item} />
            ))}
          </div>
        )}
      </main>

      {/* Sticky Footer: сума + кнопка оформлення */}
      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm safe-area-pb">
          <div className="max-w-md mx-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Загальна сума</span>
              <span className="text-lg font-bold text-foreground">
                {totalPrice.toLocaleString()} ₴
              </span>
            </div>
            <Button onClick={handleCheckout} disabled={items.length === 0} className="w-full" size="lg">
              Оформити замовлення
            </Button>
          </div>
        </div>
      )}

      {/* Чекаут: контактні дані → доставка → оплата → підтвердження */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        items={items}
        onOrderComplete={handleOrderComplete}
      />
    </div>
  );
};

export default Cart;

import { X, Minus, Plus, Trash2, ShoppingBag, Package, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { MultiSupplierWarning } from "./cart/MultiSupplierWarning";
import { CartItemEditor } from "./cart/CartItemEditor";
import { SavedAddressToggle } from "./cart/SavedAddressToggle";
import { useMemo, useState } from "react";
import { hapticImpact } from "@/lib/haptics";
import { toast } from "sonner";
import { EmptyState } from "./ui/empty-state";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export interface CartItem {
  id: string;
  productId?: string;
  name: string;
  price: number;
  image: string;
  size?: string;
  color?: string;
  quantity: number;
  supplierId?: string;
  supplierName?: string;
}

interface CartModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemoveItem: (id: string) => void;
  onCheckout: () => void;
  onPartialCheckout?: (supplierId: string) => void;
  onUpdateVariant?: (id: string, size?: string, color?: string) => void;
}

export const CartModal = ({
  isOpen,
  onClose,
  items,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
  onPartialCheckout,
  onUpdateVariant,
}: CartModalProps) => {
  const [localVariants, setLocalVariants] = useState<Record<string, { size?: string; color?: string }>>({});
  const [savedAddress, setSavedAddress] = useState<any>(null);
  const navigate = useNavigate();

  const handleBrowseCatalog = () => {
    onClose();
    navigate("/");
  };
  
  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  
  // Group items by supplier
  const groupedItems = useMemo(() => {
    const groups: Record<string, { supplierName: string; items: CartItem[] }> = {};
    
    items.forEach(item => {
      const supplierId = item.supplierId || 'unknown';
      const supplierName = item.supplierName || 'Невідомий постачальник';
      
      if (!groups[supplierId]) {
        groups[supplierId] = { supplierName, items: [] };
      }
      groups[supplierId].items.push(item);
    });
    
    return Object.entries(groups);
  }, [items]);
  
  // Count unique suppliers
  const uniqueSuppliers = new Set(items.map(item => item.supplierId).filter(Boolean));
  const supplierCount = uniqueSuppliers.size || 1;

  const handleVariantChange = (itemId: string, productId: string, type: 'size' | 'color', value: string) => {
    setLocalVariants(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [type]: value,
      },
    }));
    
    if (onUpdateVariant) {
      const current = localVariants[itemId] || {};
      const size = type === 'size' ? value : (current.size || items.find(i => i.id === itemId)?.size);
      const color = type === 'color' ? value : (current.color || items.find(i => i.id === itemId)?.color);
      onUpdateVariant(itemId, size, color);
    }
    
    hapticImpact("light");
    toast.success(`${type === 'size' ? 'Розмір' : 'Колір'} змінено`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={onClose}>
      <div 
        className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[85vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <ShoppingBag className="h-6 w-6 text-primary" />
            <div>
              <h2 className="font-bold text-lg text-foreground">Кошик</h2>
              <span className="text-sm text-muted-foreground">
                {totalItems} {totalItems === 1 ? "товар" : "товарів"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
          >
            <X className="h-5 w-5 text-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center">
              <EmptyState
                type="cart"
                title="Кошик порожній"
                description="Додайте товари з каталогу, щоб оформити замовлення"
              />
              <Button
                onClick={handleBrowseCatalog}
                className="w-full max-w-xs -mt-2 mb-8"
                size="lg"
              >
                Додати товари
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Multi-supplier warning */}
              <MultiSupplierWarning 
                supplierCount={supplierCount}
                hasFulfillmentOption={true}
              />

              {/* Saved Address Toggle */}
              <SavedAddressToggle
                onAddressSelected={setSavedAddress}
                selectedAddressId={savedAddress?.id || null}
              />
              
              {/* Grouped by Supplier */}
              {groupedItems.map(([supplierId, group]) => (
                <div key={supplierId} className="space-y-3">
                  {/* Supplier Header */}
                  {groupedItems.length > 1 && (
                    <div className="flex items-center gap-2 px-1">
                      <Package className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">
                        {group.supplierName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({group.items.length} {group.items.length === 1 ? 'товар' : 'товарів'})
                      </span>
                      <div className="flex-1 h-px bg-border ml-2" />
                    </div>
                  )}
                  
                  {/* Supplier Items */}
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex gap-3 p-3 bg-card rounded-xl border border-border"
                    >
                      {/* Image */}
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-20 h-20 rounded-lg object-cover bg-muted"
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-foreground line-clamp-2">
                          {item.name}
                        </h4>
                        {/* Editable Variant Selectors */}
                        {item.productId && (
                          <CartItemEditor
                            productId={item.productId}
                            currentSize={localVariants[item.id]?.size || item.size}
                            currentColor={localVariants[item.id]?.color || item.color}
                            onSizeChange={(size) => handleVariantChange(item.id, item.productId!, 'size', size)}
                            onColorChange={(color) => handleVariantChange(item.id, item.productId!, 'color', color)}
                          />
                        )}
                        {/* Fallback for items without productId */}
                        {!item.productId && (item.size || item.color) && (
                          <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                            {item.size && <span>Розмір: {item.size}</span>}
                            {item.color && <span>Колір: {item.color}</span>}
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="font-bold text-primary">
                            {(item.price * item.quantity).toLocaleString()} ₴
                          </span>

                          {/* Quantity Controls */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
                              className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-8 text-center text-sm font-medium">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                              className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => onRemoveItem(item.id)}
                              className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center text-destructive hover:bg-destructive/20 ml-2"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {/* Supplier Subtotal & Partial Checkout (if multiple suppliers) */}
                  {groupedItems.length > 1 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Truck className="h-4 w-4" />
                          <span>Окрема доставка</span>
                        </div>
                        <span className="font-medium">
                          {group.items.reduce((sum, item) => sum + item.price * item.quantity, 0).toLocaleString()} ₴
                        </span>
                      </div>
                      {/* Partial Checkout Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPartialCheckout?.(supplierId);
                        }}
                        className="w-full py-2.5 px-3 rounded-lg text-sm font-medium text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors flex items-center justify-center gap-2"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        Оформити лише від {group.supplierName}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-4 border-t border-border bg-card">
            <div className="flex items-center justify-between mb-4">
              <span className="text-muted-foreground">Сума замовлення:</span>
              <span className="text-xl font-bold text-foreground">
                {totalPrice.toLocaleString()} ₴
              </span>
            </div>
            <button
              onClick={onCheckout}
              className={cn(
                "w-full py-4 rounded-xl font-semibold text-base",
                "bg-primary text-primary-foreground",
                "hover:bg-primary/90 active:scale-[0.98]",
                "transition-all shadow-lg"
              )}
            >
              Оформити замовлення
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

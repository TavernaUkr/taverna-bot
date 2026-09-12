import { useState, useEffect } from 'react';
import { X, Heart, ShoppingCart, Trash2, Package, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFavoritesContext } from './FavoritesContext';
import { useCartContext } from '@/contexts/CartContext';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { hapticImpact, hapticNotification } from '@/lib/haptics';
import { EmptyState } from './ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProductVariants {
  sizes: string[];
  colors: string[];
}

interface WishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProductClick?: (productId: string) => void;
}

export function WishlistModal({ isOpen, onClose, onProductClick }: WishlistModalProps) {
  const { favorites, removeFavorite } = useFavoritesContext();
  const { addItem } = useCartContext();
  const [selectedVariants, setSelectedVariants] = useState<Record<string, { size?: string; color?: string }>>({});
  const [productVariants, setProductVariants] = useState<Record<string, ProductVariants>>({});

  // Fetch variants for all favorite products
  useEffect(() => {
    const fetchVariants = async () => {
      if (favorites.length === 0) return;
      
      const productIds = favorites.map(f => f.productId);
      const { data, error } = await supabase
        .from('products')
        .select('id, sizes, colors')
        .in('id', productIds);

      if (error) {
        console.error('Error fetching variants:', error);
        return;
      }

      const variants: Record<string, ProductVariants> = {};
      data?.forEach(product => {
        variants[product.id] = {
          sizes: product.sizes || [],
          colors: product.colors || [],
        };
      });
      setProductVariants(variants);
    };

    if (isOpen) {
      fetchVariants();
    }
  }, [favorites, isOpen]);

  if (!isOpen) return null;

  const handleAddToCart = async (item: typeof favorites[0]) => {
    const selected = selectedVariants[item.productId] || {};
    const variants = productVariants[item.productId] || { sizes: [], colors: [] };
    
    // Check if variants are required
    if (variants.sizes.length > 0 && !selected.size) {
      toast.error('Оберіть розмір');
      hapticNotification('error');
      return;
    }
    if (variants.colors.length > 0 && !selected.color) {
      toast.error('Оберіть колір');
      hapticNotification('error');
      return;
    }
    
    const success = await addItem(
      item.productId, 
      item.name, 
      item.price, 
      item.image,
      selected.size,
      selected.color
    );
    
    if (success) {
      hapticNotification('success');
      toast.success(`${item.name} додано до кошика`);
    }
  };

  const handleRemove = async (productId: string) => {
    hapticImpact('light');
    await removeFavorite(productId);
    toast.success('Видалено з обраного');
  };

  const handleVariantSelect = (productId: string, type: 'size' | 'color', value: string) => {
    hapticImpact('light');
    setSelectedVariants(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [type]: value,
      },
    }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={onClose}>
      <div 
        className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[85vh] flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-live fill-live" />
            <h2 className="font-bold text-lg text-foreground">Обране</h2>
            <span className="text-sm text-muted-foreground">({favorites.length})</span>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {favorites.length === 0 ? (
            <EmptyState
              type="favorites"
              title="Список обраного порожній"
              description="Додайте товари до обраного, щоб не втратити їх"
            />
          ) : (
            <div className="space-y-3">
              {favorites.map((item) => (
                <div 
                  key={item.id} 
                  className="flex gap-3 bg-card rounded-xl p-3 border border-border"
                >
                  <button
                    onClick={() => onProductClick?.(item.productId)}
                    className="w-20 h-20 rounded-lg bg-muted overflow-hidden flex-shrink-0"
                  >
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                  </button>
                  
                  <div className="flex-1 min-w-0">
                    <button 
                      onClick={() => onProductClick?.(item.productId)}
                      className="text-left"
                    >
                      <p className="font-medium text-sm text-foreground line-clamp-2">
                        {item.name}
                      </p>
                    </button>
                    <p className="font-bold text-primary mt-1">
                      {item.price.toLocaleString()} ₴
                    </p>
                    
                    {/* Variant Selectors */}
                    {productVariants[item.productId] && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {productVariants[item.productId].sizes.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors">
                                <span className="text-muted-foreground">Розмір:</span>
                                <span className="font-medium">
                                  {selectedVariants[item.productId]?.size || "Обрати"}
                                </span>
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {productVariants[item.productId].sizes.map(size => (
                                <DropdownMenuItem
                                  key={size}
                                  onClick={() => handleVariantSelect(item.productId, 'size', size)}
                                  className={cn(
                                    selectedVariants[item.productId]?.size === size && "bg-primary/10"
                                  )}
                                >
                                  {size}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        
                        {productVariants[item.productId].colors.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors">
                                <span className="text-muted-foreground">Колір:</span>
                                <span className="font-medium">
                                  {selectedVariants[item.productId]?.color || "Обрати"}
                                </span>
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {productVariants[item.productId].colors.map(color => (
                                <DropdownMenuItem
                                  key={color}
                                  onClick={() => handleVariantSelect(item.productId, 'color', color)}
                                  className={cn(
                                    selectedVariants[item.productId]?.color === color && "bg-primary/10"
                                  )}
                                >
                                  {color}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={() => handleAddToCart(item)}
                        className="flex-1 h-9 text-xs"
                      >
                        <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                        До кошика
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(item.productId)}
                        className="h-9 w-9 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

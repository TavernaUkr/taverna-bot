import { useState } from "react";
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

interface VariantSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  sizes?: string[];
  colors?: string[];
  onAddToCart: (size?: string, color?: string) => void;
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
  onAddToCart,
}: VariantSelectionModalProps) {
  const navigate = useNavigate();
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const hasRequiredSizes = sizes && sizes.length > 0;
  const hasRequiredColors = colors && colors.length > 0;
  
  const canAddToCart = 
    (!hasRequiredSizes || selectedSize) && 
    (!hasRequiredColors || selectedColor);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!canAddToCart) {
      if (hasRequiredSizes && !selectedSize) {
        toast.error("Оберіть розмір");
        return;
      }
      if (hasRequiredColors && !selectedColor) {
        toast.error("Оберіть колір");
        return;
      }
    }
    
    hapticImpact("medium");
    onAddToCart(selectedSize || undefined, selectedColor || undefined);
    
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
                {productPrice.toLocaleString()} ₴
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

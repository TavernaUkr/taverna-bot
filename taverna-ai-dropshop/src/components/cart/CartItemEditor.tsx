import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { hapticImpact } from "@/lib/haptics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CartItemEditorProps {
  productId: string;
  currentSize?: string;
  currentColor?: string;
  onSizeChange: (size: string) => void;
  onColorChange: (color: string) => void;
}

export function CartItemEditor({
  productId,
  currentSize,
  currentColor,
  onSizeChange,
  onColorChange,
}: CartItemEditorProps) {
  const [availableSizes, setAvailableSizes] = useState<string[]>([]);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProductVariants = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("products")
          .select("sizes, colors")
          .eq("id", productId)
          .single();

        if (error) throw error;

        setAvailableSizes(data?.sizes || []);
        setAvailableColors(data?.colors || []);
      } catch (err) {
        console.error("Error fetching product variants:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (productId) {
      fetchProductVariants();
    }
  }, [productId]);

  const handleSizeSelect = (size: string) => {
    hapticImpact("light");
    onSizeChange(size);
  };

  const handleColorSelect = (color: string) => {
    hapticImpact("light");
    onColorChange(color);
  };

  if (isLoading) {
    return (
      <div className="flex gap-2 text-xs text-muted-foreground animate-pulse">
        <span className="h-4 w-16 bg-muted rounded" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {/* Size Selector */}
      {availableSizes.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors">
              <span className="text-muted-foreground">Розмір:</span>
              <span className="font-medium">{currentSize || "—"}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[100px]">
            {availableSizes.map((size) => (
              <DropdownMenuItem
                key={size}
                onClick={() => handleSizeSelect(size)}
                className={cn(
                  "cursor-pointer",
                  currentSize === size && "bg-primary/10 text-primary"
                )}
              >
                {size}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Color Selector */}
      {availableColors.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors">
              <span className="text-muted-foreground">Колір:</span>
              <span className="font-medium">{currentColor || "—"}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            {availableColors.map((color) => (
              <DropdownMenuItem
                key={color}
                onClick={() => handleColorSelect(color)}
                className={cn(
                  "cursor-pointer",
                  currentColor === color && "bg-primary/10 text-primary"
                )}
              >
                {color}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

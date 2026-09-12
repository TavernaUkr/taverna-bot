import { useState } from "react";
import { Search, Loader2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hapticImpact } from "@/lib/haptics";

interface FindSimilarButtonProps {
  productName: string;
  productCategory?: string;
  productBrand?: string;
  productTags?: string[];
  variant?: "button" | "icon" | "chip";
  className?: string;
}

export const FindSimilarButton = ({
  productName,
  productCategory,
  productBrand,
  productTags,
  variant = "chip",
  className,
}: FindSimilarButtonProps) => {
  const navigate = useNavigate();
  const [isSearching, setIsSearching] = useState(false);

  const handleFindSimilar = async () => {
    hapticImpact("light");
    setIsSearching(true);

    // Build search query from product attributes
    const searchTerms: string[] = [];
    
    // Add category as primary search term
    if (productCategory) {
      searchTerms.push(productCategory);
    }
    
    // Add brand if available
    if (productBrand) {
      searchTerms.push(productBrand);
    }
    
    // Add first 2 tags if available
    if (productTags && productTags.length > 0) {
      searchTerms.push(...productTags.slice(0, 2));
    }
    
    // Fallback to extracting key words from product name
    if (searchTerms.length === 0) {
      const words = productName.split(" ").filter(w => w.length > 3).slice(0, 2);
      searchTerms.push(...words);
    }

    const query = searchTerms.join(" ");
    
    // Simulate brief loading for UX
    setTimeout(() => {
      setIsSearching(false);
      navigate(`/search?q=${encodeURIComponent(query)}&similar=true`);
    }, 300);
  };

  if (variant === "icon") {
    return (
      <button
        onClick={handleFindSimilar}
        disabled={isSearching}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center",
          "bg-muted/80 backdrop-blur-sm hover:bg-muted",
          "text-muted-foreground hover:text-foreground",
          "transition-all",
          className
        )}
        title="Знайти схожі товари"
      >
        {isSearching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </button>
    );
  }

  if (variant === "button") {
    return (
      <Button
        variant="outline"
        onClick={handleFindSimilar}
        disabled={isSearching}
        className={cn("gap-2", className)}
      >
        {isSearching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        Знайти схожі
      </Button>
    );
  }

  // Chip variant (default)
  return (
    <button
      onClick={handleFindSimilar}
      disabled={isSearching}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5",
        "bg-accent/10 hover:bg-accent/20 rounded-full",
        "text-xs text-accent-foreground font-medium",
        "transition-colors",
        className
      )}
    >
      {isSearching ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      Схожі товари
    </button>
  );
};

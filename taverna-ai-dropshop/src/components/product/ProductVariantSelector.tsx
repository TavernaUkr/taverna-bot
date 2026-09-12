import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface VariantSelectorProps {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
  type?: "button" | "color";
}

export const ProductVariantSelector = ({
  label,
  options,
  selected,
  onSelect,
  type = "button",
}: VariantSelectorProps) => {
  if (!options || options.length === 0) return null;

  // Color mapping for common colors
  const colorMap: Record<string, string> = {
    "чорний": "#000000",
    "чорний (black)": "#000000",
    "black": "#000000",
    "білий": "#ffffff",
    "white": "#ffffff",
    "олива": "#556b2f",
    "olive": "#556b2f",
    "хакі": "#c3b091",
    "khaki": "#c3b091",
    "сірий": "#808080",
    "gray": "#808080",
    "grey": "#808080",
    "зелений": "#228b22",
    "green": "#228b22",
    "синій": "#0000cd",
    "blue": "#0000cd",
    "коричневий": "#8b4513",
    "brown": "#8b4513",
    "бежевий": "#f5f5dc",
    "beige": "#f5f5dc",
    "камуфляж": "#4b5320",
    "camo": "#4b5320",
    "мультикам": "#6b8e23",
    "multicam": "#6b8e23",
    "песочний": "#c2b280",
    "sand": "#c2b280",
    "червоний": "#dc143c",
    "red": "#dc143c",
  };

  const getColor = (colorName: string): string | null => {
    const normalized = colorName.toLowerCase().trim();
    return colorMap[normalized] || null;
  };

  if (type === "color") {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          {label}: <span className="text-muted-foreground">{selected || "не обрано"}</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isSelected = selected === option;
            const bgColor = getColor(option);

            return (
              <button
                key={option}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(option);
                }}
                className={cn(
                  "relative w-10 h-10 rounded-full border-2 transition-all",
                  isSelected
                    ? "border-primary ring-2 ring-primary ring-offset-2"
                    : "border-border hover:border-primary/50"
                )}
                style={bgColor ? { backgroundColor: bgColor } : undefined}
                title={option}
              >
                {!bgColor && (
                  <span className="text-xs font-medium">{option.slice(0, 2).toUpperCase()}</span>
                )}
                {bgColor === "#ffffff" && (
                  <div className="absolute inset-0 rounded-full border border-gray-300" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        {label}: <span className="text-muted-foreground">{selected || "не обрано"}</span>
      </Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected === option;

          return (
            <button
              key={option}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(option);
              }}
              className={cn(
                "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/50"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
};

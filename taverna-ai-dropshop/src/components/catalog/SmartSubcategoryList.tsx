import type { ReactNode, MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, LayoutGrid, Shirt, Layers, HardHat, Backpack, Footprints, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartGroupIcon, SmartSubcategoryGroup } from "@/utils/categoryParser";

const ICONS: Record<SmartGroupIcon, ReactNode> = {
  all: <LayoutGrid className="h-5 w-5" />,
  jacket: <Shirt className="h-5 w-5" />,
  sweater: <Shirt className="h-5 w-5" />,
  pants: <Layers className="h-5 w-5" />,
  headwear: <HardHat className="h-5 w-5" />,
  bag: <Backpack className="h-5 w-5" />,
  shoes: <Footprints className="h-5 w-5" />,
  other: <Tag className="h-5 w-5" />,
};

function countLabel(count: number): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${count} товарів`;
  if (last === 1) return `${count} товар`;
  if (last >= 2 && last <= 4) return `${count} товари`;
  return `${count} товарів`;
}

interface SmartSubcategoryListProps {
  groups: SmartSubcategoryGroup[];
  totalCount: number;
  isLoading?: boolean;
  parentCategory?: string;
  onSelectAll: () => void;
  onSelectGroup: (group: SmartSubcategoryGroup) => void;
  onCloseModal?: () => void;
  allIcon?: ReactNode;
}

export function SmartSubcategoryList({
  groups,
  totalCount,
  isLoading = false,
  parentCategory,
  onSelectAll,
  onSelectGroup,
  onCloseModal,
  allIcon,
}: SmartSubcategoryListProps) {
  const navigate = useNavigate();

  const handleSelectAll = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (parentCategory) {
      navigate(`/search?category=${encodeURIComponent(parentCategory)}`);
    } else {
      onSelectAll();
    }
    onCloseModal?.();
  };

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={handleSelectAll}
        className={cn(
          "relative z-10 w-full p-3.5 rounded-2xl flex items-center justify-between gap-3 transition-all touch-manipulation",
          "bg-primary/10 border border-primary/25 hover:border-primary/50 hover:bg-primary/15"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            {allIcon || ICONS.all}
          </div>
          <div className="text-left min-w-0">
            <span className="font-semibold text-foreground">Всі товари</span>
            <p className="text-xs text-muted-foreground">
              {isLoading ? "Оновлюю кількість..." : countLabel(totalCount)}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-primary/70 shrink-0" />
      </button>

      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onSelectGroup(group)}
          className={cn(
            "w-full p-3.5 rounded-2xl flex items-center justify-between gap-3 transition-all",
            "bg-muted/50 border border-border/70 hover:border-primary/40 hover:bg-muted"
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-background text-foreground/80 flex items-center justify-center shrink-0 border border-border/60">
              {ICONS[group.icon] || ICONS.other}
            </div>
            <div className="text-left min-w-0">
              <span className="font-medium text-foreground truncate block">{group.name}</span>
              <p className="text-xs text-muted-foreground">{countLabel(group.count)}</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </button>
      ))}
    </div>
  );
}

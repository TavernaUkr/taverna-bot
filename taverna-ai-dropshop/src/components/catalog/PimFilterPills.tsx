import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BackendCategorySub } from "@/lib/backendApi";
import { groupSubcategories, isGroupSelected, type SmartSubcategoryGroup } from "@/utils/categoryParser";

export const FALLBACK_SEASONS = ["Літо", "Зима", "Демісезон"];
export const FALLBACK_NICHES = [
  "Мілітарі",
  "Повсякденний",
  "Туризм",
  "Спорт",
  "Домашній",
];

export function mergeUniqueLabels(primary: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of [...primary, ...fallback]) {
    const value = item.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

interface PimFilterPillsProps {
  seasons: string[];
  niches: string[];
  selectedSeasons: string[];
  selectedNiches: string[];
  onToggleSeason: (value: string) => void;
  onToggleNiche: (value: string) => void;
  subcategories?: BackendCategorySub[];
  selectedSubcategories?: string[];
  onToggleSubcategory?: (name: string) => void;
  onToggleSubcategoryGroup?: (group: SmartSubcategoryGroup) => void;
}

function Pill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-muted/70 text-foreground border-border hover:border-primary/60"
      )}
    >
      {label}
      {typeof count === "number" && (
        <span className={cn("ml-1", active ? "opacity-80" : "text-muted-foreground")}>
          ({count})
        </span>
      )}
    </button>
  );
}

export const PimFilterPills = ({
  seasons,
  niches,
  selectedSeasons,
  selectedNiches,
  onToggleSeason,
  onToggleNiche,
  subcategories = [],
  selectedSubcategories = [],
  onToggleSubcategory,
  onToggleSubcategoryGroup,
}: PimFilterPillsProps) => {
  const groupedSubs = useMemo(
    () => groupSubcategories(subcategories),
    [subcategories]
  );

  return (
    <div className="space-y-2 w-full min-w-0">
      {seasons.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 px-0.5">Сезон</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide w-full min-w-0">
            {seasons.map((season) => (
              <Pill
                key={season}
                label={season}
                active={selectedSeasons.includes(season)}
                onClick={() => onToggleSeason(season)}
              />
            ))}
          </div>
        </div>
      )}

      {niches.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 px-0.5">Ніша</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide w-full min-w-0">
            {niches.map((niche) => (
              <Pill
                key={niche}
                label={niche}
                active={selectedNiches.includes(niche)}
                onClick={() => onToggleNiche(niche)}
              />
            ))}
          </div>
        </div>
      )}

      {groupedSubs.length > 0 && (onToggleSubcategoryGroup || onToggleSubcategory) && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 px-0.5">
            Підкатегорії
          </p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide w-full min-w-0">
            {groupedSubs.map((group) => (
              <Pill
                key={group.id}
                label={group.name}
                count={group.count}
                active={isGroupSelected(group, selectedSubcategories)}
                onClick={() => {
                  if (onToggleSubcategoryGroup) {
                    onToggleSubcategoryGroup(group);
                    return;
                  }
                  group.originals.forEach((name) => onToggleSubcategory?.(name));
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

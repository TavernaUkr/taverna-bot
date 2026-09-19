import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface DynamicFilterOption {
  name: string;
  options: string[];
}

interface FilterSidebarProps {
  filters: DynamicFilterOption[];
  selected: Record<string, string[]>;
  onToggle: (name: string, value: string) => void;
  className?: string;
}

/** Чекбокси динамічних характеристик (Виробник, Матеріал, Пам'ять...). */
export function FilterSidebar({
  filters,
  selected,
  onToggle,
  className,
}: FilterSidebarProps) {
  if (!filters.length) return null;

  return (
    <div className={cn("space-y-4", className)}>
      <h4 className="font-medium text-foreground">Характеристики</h4>
      {filters.map((filter) => (
        <section key={filter.name} className="space-y-2">
          <p className="text-sm font-medium text-foreground">{filter.name}</p>
          <ScrollArea className={filter.options.length > 6 ? "h-40" : undefined}>
            <div className="space-y-2 pr-3">
              {filter.options.map((option) => {
                const checked = (selected[filter.name] || []).includes(option);
                return (
                  <label
                    key={`${filter.name}:${option}`}
                    className="flex items-center gap-2 cursor-pointer py-0.5"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(filter.name, option)}
                    />
                    <span className="text-sm">{option}</span>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </section>
      ))}
    </div>
  );
}

/** Горизонтальні чіпи на сторінці каталогу — видно без відкриття панелі фільтрів. */
export function DynamicFilterBar({
  filters,
  selected,
  onToggle,
}: FilterSidebarProps) {
  if (!filters.length) return null;

  return (
    <div className="space-y-2 w-full min-w-0 mb-3">
      {filters.map((filter) => (
        <div key={filter.name}>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 px-0.5">
            {filter.name}
          </p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide w-full min-w-0">
            {filter.options.map((option) => {
              const active = (selected[filter.name] || []).includes(option);
              return (
                <button
                  key={`${filter.name}:${option}`}
                  type="button"
                  onClick={() => onToggle(filter.name, option)}
                  className={cn(
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/70 text-foreground border-border hover:border-primary/60"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

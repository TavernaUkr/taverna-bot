import { useState } from "react";
import { Search, X, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
}

export const SearchModal = ({ isOpen, onClose, onSearch }: SearchModalProps) => {
  const [query, setQuery] = useState("");
  const [recentSearches] = useState([
    "Тактичні рукавички",
    "Берці Gore-Tex",
    "Рюкзак мультикам",
    "Футболка олива"
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleQuickSearch = (term: string) => {
    setQuery(term);
    onSearch(term);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук товарів, артикул..."
              autoFocus
              className={cn(
                "w-full h-12 pl-10 pr-10 rounded-xl",
                "bg-muted/50 border border-border",
                "text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary",
                "transition-all"
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Recent Searches */}
        {!query && recentSearches.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3">Нещодавні пошуки</h3>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((term, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickSearch(term)}
                  className="px-4 py-2 rounded-full bg-muted hover:bg-muted/80 text-sm text-foreground transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Popular Categories */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">Популярні категорії</h3>
          <div className="grid grid-cols-2 gap-2">
            {["Мілітарі", "Одяг", "Взуття", "Аксесуари"].map((cat) => (
              <button
                key={cat}
                onClick={() => handleQuickSearch(cat)}
                className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 text-left transition-all"
              >
                <span className="text-sm font-medium text-foreground">{cat}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Search Tips */}
        <section className="bg-muted/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">💡 Поради пошуку</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Використовуйте артикул для точного пошуку</li>
            <li>• Введіть назву бренду для фільтрації</li>
            <li>• Вкажіть розмір у пошуку (напр. "футболка M")</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

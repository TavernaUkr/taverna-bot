import { useEffect, useState } from "react";

/**
 * useDebouncedValue — патерн "Debounce" для пошукового вводу.
 *
 * Повертає копію value, яка оновлюється лише після `delay` мс "тиші"
 * (користувач перестав друкувати). Це дозволяє не спамити бекенд
 * запитом на кожне натискання клавіші.
 *
 * Приклад (SearchResults.tsx):
 *   const [searchInput, setSearchInput] = useState("");
 *   const debouncedSearch = useDebouncedValue(searchInput, 500);
 *   useEffect(() => { loadCatalog(); }, [debouncedSearch]);
 */
export function useDebouncedValue<T>(value: T, delay: number = 500): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // Таймер скидається на кожне зміну value — саме це і є debounce.
    const timer = setTimeout(() => setDebounced(value), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebouncedValue;

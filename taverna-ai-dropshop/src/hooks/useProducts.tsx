import { useState, useEffect, useCallback } from 'react';
import {
  fetchBackendProducts,
  BackendApiError,
  type BackendProduct,
} from '@/lib/backendApi';

interface Product {
  id: string;
  external_id?: string;
  group_id?: string;
  supplier_id?: string;
  category_id?: string;
  name: string;
  description?: string;
  price: number;
  original_price?: number;
  currency: string;
  brand?: string;
  model?: string;
  vendor_code?: string;
  sizes?: string[];
  colors?: string[];
  images?: string[];
  in_stock: boolean;
  stock_quantity?: number;
  attributes?: any;
  ai_category?: string;
  ai_tags?: string[];
  source_url?: string;
  video_url?: string;
  views_count?: number;
  is_boosted?: boolean;
  created_at?: string;
  updated_at?: string;
  category?: {
    id: string;
    name: string;
    slug: string;
    parent_id?: string | null;
  } | null;
}

interface Category {
  id: string;
  external_id?: string;
  name: string;
  slug: string;
  parent_id?: string;
  image_url?: string;
  product_count: number;
  is_active: boolean;
  subcategories?: Category[];
}

/**
 * Мапить товар у форматі нашого FastAPI-бекенду (api/products.py)
 * у формат, який очікує UI каталогу (ProductCard, Index.tsx і т.д.).
 *
 * Розбіжності полів між Python-бекендом і React-фронтендом:
 *  - pictures (Python)         -> images (React)
 *  - category: string (тег)   -> category: { id, name, slug } (об'єкт для UI)
 *  - price відсутній на товарі -> беремо final_price першого доступного варіанту
 *  - in_stock відсутній        -> true, якщо є хоча б один доступний варіант
 *  - sizes/colors відсутні     -> витягуємо зі values опцій "Розмір"/"Колір"
 */
function mapBackendProductToUi(bp: BackendProduct): Product {
  const variants = bp.variants ?? [];
  const availableVariants = variants.filter((v) => v.is_available && v.quantity > 0);
  const primaryVariant = availableVariants[0] ?? variants[0];

  const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);

  const options = bp.options ?? [];
  const sizeOption = options.find((o) => /розмір|size/i.test(o.name));
  const colorOption = options.find((o) => /колір|цвет|color/i.test(o.name));

  const categoryTag = bp.category?.trim() || undefined;

  return {
    id: String(bp.id),
    external_id: bp.sku,
    vendor_code: bp.sku,
    name: bp.name,
    description: bp.description ?? undefined,
    price: primaryVariant?.final_price ?? 0,
    currency: 'UAH',
    images: bp.pictures ?? [],
    in_stock: availableVariants.length > 0,
    stock_quantity: totalStock,
    sizes: sizeOption?.values.map((v) => v.value),
    colors: colorOption?.values.map((v) => v.value),
    category: categoryTag
      ? { id: categoryTag, name: categoryTag, slug: categoryTag, parent_id: null }
      : null,
  };
}

/** Будує список категорій (з кількістю товарів) на основі товарів бекенду. */
function buildCategoriesFromProducts(products: Product[]): Category[] {
  const counts = new Map<string, number>();

  for (const p of products) {
    if (p.category?.name) {
      counts.set(p.category.name, (counts.get(p.category.name) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, product_count]) => ({
      id: name,
      name,
      slug: name,
      product_count,
      is_active: true,
      subcategories: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async (filters?: {
    categoryId?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    inStock?: boolean;
    limit?: number;
    sortBy?: 'newest' | 'trending' | 'price_asc' | 'price_desc';
  }) => {
    try {
      setIsLoading(true);

      const backendProducts = await fetchBackendProducts();
      let mapped = backendProducts.map(mapBackendProductToUi);

      // --- Клієнтська фільтрація (наш бекенд ще не приймає query-параметри) ---
      if (filters?.inStock !== false) {
        // За замовчуванням каталог показує лише товари в наявності,
        // так само як робив попередній запит до Supabase (.eq('in_stock', true)).
        mapped = mapped.filter((p) => p.in_stock);
      }

      if (filters?.categoryId) {
        mapped = mapped.filter((p) => p.category?.id === filters.categoryId);
      }

      if (filters?.search) {
        const q = filters.search.toLowerCase();
        mapped = mapped.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description?.toLowerCase().includes(q) ?? false)
        );
      }

      if (filters?.minPrice !== undefined) {
        mapped = mapped.filter((p) => p.price >= filters.minPrice!);
      }

      if (filters?.maxPrice !== undefined) {
        mapped = mapped.filter((p) => p.price <= filters.maxPrice!);
      }

      // --- Сортування (is_boosted завжди першими, як і було раніше) ---
      const byBoostedThen =
        (cmp: (a: Product, b: Product) => number) =>
        (a: Product, b: Product): number => {
          const boostDiff = Number(!!b.is_boosted) - Number(!!a.is_boosted);
          return boostDiff !== 0 ? boostDiff : cmp(a, b);
        };

      if (filters?.sortBy === 'trending') {
        mapped.sort(byBoostedThen((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0)));
      } else if (filters?.sortBy === 'price_asc') {
        mapped.sort(byBoostedThen((a, b) => a.price - b.price));
      } else if (filters?.sortBy === 'price_desc') {
        mapped.sort(byBoostedThen((a, b) => b.price - a.price));
      }
      // 'newest' — бекенд не повертає created_at на товарі, тож лишаємо порядок id (за замовчуванням).

      if (filters?.limit) {
        mapped = mapped.slice(0, filters.limit);
      }

      setProducts(mapped);
      setError(null);
    } catch (err: unknown) {
      const message =
        err instanceof BackendApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Failed to fetch products';
      setError(message);
      console.error('Fetch products error:', err);
      // При помилці мережі/CORS не чистимо вже показані товари —
      // UI (Index.tsx) сам підставить fallbackProducts, якщо products порожній.
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const backendProducts = await fetchBackendProducts();
      const mapped = backendProducts.map(mapBackendProductToUi);
      setCategories(buildCategoriesFromProducts(mapped));
    } catch (err) {
      console.error('Fetch categories error:', err);
    }
  }, []);

  const getProductById = useCallback(async (id: string): Promise<Product | null> => {
    try {
      // Наш бекенд поки не має окремого /products/{id} ендпоінту,
      // тож шукаємо серед повного списку.
      const backendProducts = await fetchBackendProducts();
      const found = backendProducts.find((p) => String(p.id) === id);
      return found ? mapBackendProductToUi(found) : null;
    } catch (err) {
      console.error('Get product error:', err);
      return null;
    }
  }, []);

  const searchProducts = useCallback(async (query: string) => {
    return fetchProducts({ search: query, limit: 20 });
  }, [fetchProducts]);

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, [fetchProducts, fetchCategories]);

  return {
    products,
    categories,
    isLoading,
    error,
    fetchProducts,
    fetchCategories,
    getProductById,
    searchProducts,
  };
}

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import {
  BackendApiError,
  getSupplierProduct,
  createSupplierProduct,
  updateSupplierProduct,
} from "@/lib/backendApi";

/**
 * Універсальна форма товару (Створення / Редагування) — B2B «Мої Товари».
 *
 * Маршрут: /supplier/:id/products/:productId/edit
 * productId === 'new' → режим створення (POST), інакше — редагування (PATCH).
 *
 * Поля: назва, опис, категорія, ціна (ГРН), залишок, статус (Активний/Чернетка),
 * фото — масив URL-інпутів (завантаження файлів — наступний етап).
 */

interface FormState {
  name: string;
  description: string;
  category: string;
  price: string;
  stock: string;
  status: "active" | "inactive";
  pictures: string[];
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  category: "",
  price: "",
  stock: "0",
  status: "inactive",
  pictures: [""],
};

export default function StoreProductEdit() {
  const navigate = useNavigate();
  const { id, productId } = useParams<{ id: string; productId: string }>();
  const supplierId = Number(id);
  const isNew = productId === "new";
  const numericProductId = isNew ? null : Number(productId);
  const isValidSupplier = Number.isInteger(supplierId) && supplierId > 0;
  const isValidProduct = isNew || (Number.isInteger(numericProductId) && numericProductId! > 0);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // --- Завантаження картки товару (тільки режим редагування) ---
  const loadProduct = useCallback(async () => {
    if (isNew || numericProductId == null) {
      setIsLoading(false);
      return;
    }
    try {
      const product = await getSupplierProduct(supplierId, numericProductId);
      setForm({
        name: product.name ?? "",
        description: product.description ?? "",
        category: product.category ?? "",
        price: product.price != null ? String(product.price) : "",
        stock: String(product.stock ?? 0),
        status: product.status === "active" ? "active" : "inactive",
        pictures: product.pictures?.length ? product.pictures : [""],
      });
      setLoadError(null);
    } catch (err) {
      console.error("Error loading product:", err);
      setLoadError(
        err instanceof Error ? err.message : "Не вдалося завантажити товар"
      );
    } finally {
      setIsLoading(false);
    }
  }, [isNew, numericProductId, supplierId]);

  useEffect(() => {
    if (!isValidSupplier || !isValidProduct) return;
    void loadProduct();
  }, [loadProduct, isValidSupplier, isValidProduct]);

  // --- Збереження ---
  const handleSave = async () => {
    const name = form.name.trim();
    if (name.length < 2) {
      toast.error("Назва товару — мінімум 2 символи");
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Вкажіть коректну ціну у гривнях");
      return;
    }
    const stock = Number(form.stock || 0);
    if (!Number.isFinite(stock) || stock < 0) {
      toast.error("Залишок не може бути від'ємним");
      return;
    }
    const pictures = form.pictures.map((p) => p.trim()).filter(Boolean);

    setIsSaving(true);
    try {
      if (isNew) {
        await createSupplierProduct(supplierId, {
          name,
          description: form.description.trim(),
          price: Math.round(price),
          stock: Math.round(stock),
          category: form.category.trim(),
          pictures,
          status: form.status,
        });
        hapticNotification("success");
        toast.success("Товар створено");
      } else {
        await updateSupplierProduct(supplierId, numericProductId!, {
          name,
          description: form.description.trim(),
          price: Math.round(price),
          stock: Math.round(stock),
          category: form.category.trim(),
          pictures,
          status: form.status,
        });
        hapticNotification("success");
        toast.success("Зміни збережено");
      }
      navigate(-1);
    } catch (err) {
      console.error("Error saving product:", err);
      hapticNotification("error");
      toast.error(
        err instanceof BackendApiError
          ? err.message
          : isNew
            ? "Не вдалося створити товар"
            : "Не вдалося зберегти зміни"
      );
    } finally {
      setIsSaving(false);
    }
  };

  // --- Фото-URL ---
  const setPicture = (index: number, value: string) =>
    setForm((prev) => {
      const next = [...prev.pictures];
      next[index] = value;
      return { ...prev, pictures: next };
    });

  const addPicture = () =>
    setForm((prev) => ({ ...prev, pictures: [...prev.pictures, ""] }));

  const removePicture = (index: number) =>
    setForm((prev) => {
      const next = prev.pictures.filter((_, i) => i !== index);
      return { ...prev, pictures: next.length ? next : [""] };
    });

  // --- Невалідні параметри роуту ---
  if (!isValidSupplier || !isValidProduct) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Редагування товару" isNew={isNew} onBack={() => navigate(-1)} />
        <EmptyState
          type="default"
          title="Товар не знайдено"
          description="Некоректне посилання (магазин або товар)"
          action={{ label: "До списку товарів", onClick: () => navigate("/my-shops") }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <PageHeader
        title={isNew ? "Новий товар" : "Редагування товару"}
        isNew={isNew}
        onBack={() => navigate(-1)}
      />

      <div className="p-4 space-y-4 max-w-md mx-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="p-4 space-y-3 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-warning" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadProduct()}>
              Спробувати ще
            </Button>
          </div>
        ) : (
          <>
            {/* Назва */}
            <div className="space-y-1.5">
              <Label htmlFor="product-name">Назва товару *</Label>
              <Input
                id="product-name"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Наприклад: Тактичні рукавиці"
                maxLength={512}
              />
            </div>

            {/* Опис */}
            <div className="space-y-1.5">
              <Label htmlFor="product-description">Опис</Label>
              <Textarea
                id="product-description"
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="Опис товару, матеріал, розміри..."
                rows={4}
                maxLength={4000}
              />
            </div>

            {/* Категорія */}
            <div className="space-y-1.5">
              <Label htmlFor="product-category">Категорія</Label>
              <Input
                id="product-category"
                value={form.category}
                onChange={(e) => setField("category", e.target.value)}
                placeholder="Наприклад: Одяг"
                maxLength={100}
              />
              <p className="text-[11px] text-muted-foreground">
                Вільний текст; AI-категорії товару не переписуємо
              </p>
            </div>

            {/* Ціна + залишок */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="product-price">Ціна, грн *</Label>
                <Input
                  id="product-price"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={form.price}
                  onChange={(e) => setField("price", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-stock">Залишок</Label>
                <Input
                  id="product-stock"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={form.stock}
                  onChange={(e) => setField("stock", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Статус */}
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select
                value={form.status}
                onValueChange={(v) => {
                  hapticSelection();
                  setField("status", v as "active" | "inactive");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активний (у каталозі)</SelectItem>
                  <SelectItem value="inactive">Чернетка (прихований)</SelectItem>
                </SelectContent>
              </Select>
              {isNew && (
                <p className="text-[11px] text-muted-foreground">
                  Новий товар за замовчуванням — чернетка; опублікуйте, коли готові
                </p>
              )}
            </div>

            {/* Фото (URL) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Фотографії (URL)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={addPicture}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Додати URL
                </Button>
              </div>
              <div className="space-y-2">
                {form.pictures.map((url, index) => (
                  <div key={index} className="flex gap-2">
                    <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0 border border-border">
                      {url.trim() ? (
                        <img
                          src={url}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <ImageOff className="h-5 w-5 text-muted-foreground/40" />
                      )}
                    </div>
                    <Input
                      value={url}
                      onChange={(e) => setPicture(index, e.target.value)}
                      placeholder="https://..."
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive shrink-0"
                      onClick={() => removePicture(index)}
                      aria-label="Видалити фото"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Вставте прямі посилання на зображення; завантаження файлів — наступний етап
              </p>
            </div>

            {/* Попередній перегляд */}
            {form.pictures.some((p) => p.trim()) && (
              <Card>
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    Перший кадр (прев'ю картки)
                  </p>
                  {(() => {
                    const first = form.pictures.find((p) => p.trim());
                    if (!first) return null;
                    return (
                      <img
                        src={first}
                        alt="Прев'ю"
                        className="w-full h-40 object-contain rounded-lg bg-muted"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Sticky Footer: Зберегти */}
      {!isLoading && !loadError && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm safe-area-pb">
          <div className="max-w-md mx-auto p-4">
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={() => {
                hapticSelection();
                void handleSave();
              }}
              disabled={isSaving || form.name.trim().length < 2}
            >
              {isSaving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" />
              )}
              {isSaving ? "Збереження..." : isNew ? "Створити товар" : "Зберегти зміни"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Шапка форми: назад + заголовок (режим створення/редагування). */
function PageHeader({
  title,
  isNew,
  onBack,
}: {
  title: string;
  isNew: boolean;
  onBack: () => void;
}) {
  return (
    <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
      <div className="flex items-center gap-3 max-w-md mx-auto">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            hapticSelection();
            onBack();
          }}
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-lg text-foreground truncate">{title}</h1>
          <p className="text-xs text-muted-foreground">
            {isNew ? "Новий товар магазину" : "Керування асортиментом магазину"}
          </p>
        </div>
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            isNew ? "bg-primary/10" : "bg-muted"
          )}
        >
          {isNew ? (
            <Plus className="h-5 w-5 text-primary" />
          ) : (
            <Pencil className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </div>
    </div>
  );
}

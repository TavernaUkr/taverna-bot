import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Trash2, GripVertical, Send, Megaphone, Shuffle, ListOrdered, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface ShopOption {
  id: string;
  shop_name: string;
}

export interface AutoQueueData {
  id?: string;
  name: string;
  type: "posting" | "advertising";
  mode: "random" | "manual";
  supplier_ids: string[];
  product_ids: string[];
  interval_minutes: number;
  platforms: string[];
  budget: number;
  active_hours_start: number | null;
  active_hours_end: number | null;
  start_date: string | null;
  end_date: string | null;
}

interface AutoQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Partial<AutoQueueData>;
  availableShops: ShopOption[];
  defaultShopIds: string[];
  onSave: (data: AutoQueueData) => Promise<void>;
}

const PLATFORMS = [
  { id: "telegram", name: "Telegram", icon: "📱" },
  { id: "instagram", name: "Instagram", icon: "📸" },
  { id: "facebook", name: "Facebook", icon: "👥" },
  { id: "tiktok", name: "TikTok", icon: "🎵" },
  { id: "youtube", name: "YouTube", icon: "▶️" },
  { id: "viber", name: "Viber", icon: "💬" },
  { id: "whatsapp", name: "WhatsApp", icon: "📞" },
  { id: "twitter", name: "X (Twitter)", icon: "🐦" },
  { id: "olx", name: "OLX", icon: "🛒" },
  { id: "prom", name: "Prom.ua", icon: "🏪" },
  { id: "rozetka", name: "Rozetka", icon: "🟢" },
  { id: "google", name: "Google Ads", icon: "🔍" },
];

const INTERVAL_PRESETS = [
  { label: "5 хв", value: 5 },
  { label: "15 хв", value: 15 },
  { label: "30 хв", value: 30 },
  { label: "1 год", value: 60 },
  { label: "3 год", value: 180 },
  { label: "6 год", value: 360 },
  { label: "12 год", value: 720 },
  { label: "24 год", value: 1440 },
];

interface ProductRow {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  supplier_id: string;
}

function SortableProductItem({ product, onRemove, shopName }: { product: ProductRow; onRemove: () => void; shopName?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: product.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 bg-muted/40 rounded-md border"
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      {product.images?.[0] && (
        <img src={product.images[0]} alt="" className="w-8 h-8 rounded object-cover" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{product.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {product.price} ₴{shopName && ` · ${shopName}`}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function AutoQueueDialog({
  open,
  onOpenChange,
  initialData,
  availableShops,
  defaultShopIds,
  onSave,
}: AutoQueueDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"posting" | "advertising">("posting");
  const [mode, setMode] = useState<"random" | "manual">("random");
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [platforms, setPlatforms] = useState<string[]>(["telegram"]);
  const [budget, setBudget] = useState(0);
  const [activeAround, setActiveAround] = useState<"all" | "work">("all");
  const [activeStart, setActiveStart] = useState(9);
  const [activeEnd, setActiveEnd] = useState(21);
  const [productSearch, setProductSearch] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [productResults, setProductResults] = useState<ProductRow[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Init / reset on open
  useEffect(() => {
    if (!open) return;
    setName(initialData?.name || "Авто-черга");
    setType(initialData?.type || "posting");
    setMode(initialData?.mode || "random");
    setSupplierIds(initialData?.supplier_ids?.length ? initialData.supplier_ids : defaultShopIds);
    setProductIds(initialData?.product_ids || []);
    setIntervalMinutes(initialData?.interval_minutes || 60);
    setPlatforms(initialData?.platforms?.length ? initialData.platforms : ["telegram"]);
    setBudget(initialData?.budget || 0);
    if (initialData?.active_hours_start != null && initialData?.active_hours_end != null) {
      setActiveAround("work");
      setActiveStart(initialData.active_hours_start);
      setActiveEnd(initialData.active_hours_end);
    } else {
      setActiveAround("all");
    }
  }, [open, initialData, defaultShopIds]);

  // Load product details for manual mode
  useEffect(() => {
    if (mode !== "manual" || productIds.length === 0) {
      setProducts([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, price, images, supplier_id")
        .in("id", productIds);
      if (data) {
        // Preserve order of productIds
        const ordered = productIds
          .map(id => data.find(p => p.id === id))
          .filter((p): p is ProductRow => !!p);
        setProducts(ordered);
      }
    })();
  }, [mode, productIds.join(",")]);

  // Search products
  useEffect(() => {
    if (mode !== "manual") return;
    if (productSearch.trim().length < 2) {
      setProductResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchingProducts(true);
      try {
        let q = supabase
          .from("products")
          .select("id, name, price, images, supplier_id")
          .ilike("name", `%${productSearch.trim()}%`)
          .eq("in_stock", true)
          .limit(15);
        if (supplierIds.length > 0) {
          q = q.in("supplier_id", supplierIds);
        }
        const { data } = await q;
        setProductResults((data || []) as ProductRow[]);
      } finally {
        setSearchingProducts(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch, mode, supplierIds.join(",")]);

  const toggleShop = (id: string) => {
    setSupplierIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const togglePlatform = (id: string) => {
    setPlatforms(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const addProduct = (p: ProductRow) => {
    if (productIds.includes(p.id)) return;
    setProductIds(prev => [...prev, p.id]);
    setProducts(prev => [...prev, p]);
  };
  const removeProduct = (id: string) => {
    setProductIds(prev => prev.filter(x => x !== id));
    setProducts(prev => prev.filter(p => p.id !== id));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = products.findIndex(p => p.id === active.id);
    const newIdx = products.findIndex(p => p.id === over.id);
    const newOrder = arrayMove(products, oldIdx, newIdx);
    setProducts(newOrder);
    setProductIds(newOrder.map(p => p.id));
  };

  const handleSave = async () => {
    // Validations
    if (supplierIds.length === 0) {
      toast.error("Оберіть хоча б один магазин");
      return;
    }
    if (mode === "manual" && productIds.length === 0) {
      toast.error("Додайте хоча б один товар у чергу");
      return;
    }
    if (platforms.length === 0) {
      toast.error("Оберіть хоча б одну платформу");
      return;
    }
    if (type === "advertising" && budget < 50) {
      toast.error("Мінімальний бюджет для реклами — 50 ₴/день");
      return;
    }
    if (intervalMinutes < 5) {
      toast.error("Мінімальний інтервал — 5 хв");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: initialData?.id,
        name: name.trim() || "Авто-черга",
        type,
        mode,
        supplier_ids: supplierIds,
        product_ids: mode === "manual" ? productIds : [],
        interval_minutes: intervalMinutes,
        platforms,
        budget: type === "advertising" ? budget : 0,
        active_hours_start: activeAround === "work" ? activeStart : null,
        active_hours_end: activeAround === "work" ? activeEnd : null,
        start_date: null,
        end_date: null,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Помилка збереження");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setEntitySearch("");
      setProductSearch("");
    }
  }, [open]);

  const shopName = (id: string) => availableShops.find(s => s.id === id)?.shop_name || "";


  const filteredShops = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    if (!q) return availableShops;
    return availableShops.filter((s) => s.shop_name.toLowerCase().includes(q));
  }, [availableShops, entitySearch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{initialData?.id ? "Редагувати авто-чергу" : "Нова авто-черга"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-5 py-2">
            {/* Universal search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={entitySearch}
                onChange={(e) => {
                  setEntitySearch(e.target.value);
                  setProductSearch(e.target.value);
                }}
                placeholder="Пошук магазину чи товару..."
                className="pl-8"
              />
            </div>
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="queue-name">Назва черги</Label>
              <Input id="queue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр. «Ранкові товари»" />
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <Label>Тип</Label>
              <RadioGroup value={type} onValueChange={(v) => setType(v as any)} className="grid grid-cols-2 gap-2">
                <Label className={cn("flex items-center gap-2 border rounded-md p-3 cursor-pointer", type === "posting" && "border-primary bg-primary/5")}>
                  <RadioGroupItem value="posting" />
                  <Send className="h-4 w-4" />
                  <span className="text-sm">Постинг</span>
                </Label>
                <Label className={cn("flex items-center gap-2 border rounded-md p-3 cursor-pointer", type === "advertising" && "border-primary bg-primary/5")}>
                  <RadioGroupItem value="advertising" />
                  <Megaphone className="h-4 w-4" />
                  <span className="text-sm">Реклама</span>
                </Label>
              </RadioGroup>
            </div>

            {/* Mode */}
            <div className="space-y-1.5">
              <Label>Режим вибору товарів</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="grid grid-cols-2 gap-2">
                <Label className={cn("flex items-center gap-2 border rounded-md p-3 cursor-pointer", mode === "random" && "border-primary bg-primary/5")}>
                  <RadioGroupItem value="random" />
                  <Shuffle className="h-4 w-4" />
                  <span className="text-sm">Рандом</span>
                </Label>
                <Label className={cn("flex items-center gap-2 border rounded-md p-3 cursor-pointer", mode === "manual" && "border-primary bg-primary/5")}>
                  <RadioGroupItem value="manual" />
                  <ListOrdered className="h-4 w-4" />
                  <span className="text-sm">Власна черга</span>
                </Label>
              </RadioGroup>
            </div>

            {/* Shops */}
            <div className="space-y-1.5">
              <Label>Магазини ({supplierIds.length})</Label>
              <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                {filteredShops.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">
                    {availableShops.length === 0 ? "Немає доступних магазинів" : "Нічого не знайдено"}
                  </p>
                ) : filteredShops.map(shop => (
                  <label key={shop.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                    <Checkbox checked={supplierIds.includes(shop.id)} onCheckedChange={() => toggleShop(shop.id)} />
                    <span className="text-sm">{shop.shop_name}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSupplierIds(availableShops.map(s => s.id))}>Усі</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSupplierIds([])}>Скинути</Button>
              </div>
            </div>

            {/* Manual mode: products picker */}
            {mode === "manual" && (
              <div className="space-y-2">
                <Label>Товари у черзі ({products.length})</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Пошук товарів..."
                    className="pl-8"
                  />
                </div>
                {productResults.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {productResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        disabled={productIds.includes(p.id)}
                        className="w-full flex items-center gap-2 p-2 hover:bg-muted disabled:opacity-50 text-left"
                      >
                        {p.images?.[0] && <img src={p.images[0]} alt="" className="w-7 h-7 rounded object-cover" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground">{p.price} ₴ · {shopName(p.supplier_id)}</p>
                        </div>
                        {productIds.includes(p.id) ? <Badge variant="secondary" className="text-[10px]">У черзі</Badge> : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>
                )}
                {products.length > 0 && (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={products.map(p => p.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-1">
                        {products.map(p => (
                          <SortableProductItem
                            key={p.id}
                            product={p}
                            shopName={shopName(p.supplier_id)}
                            onRemove={() => removeProduct(p.id)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
                {products.length === 0 && (
                  <p className="text-xs text-muted-foreground">Знайдіть та додайте товари. Перетягуйте, щоб змінити порядок публікації.</p>
                )}
              </div>
            )}

            {/* Interval */}
            <div className="space-y-1.5">
              <Label>Інтервал між публікаціями</Label>
              <div className="flex flex-wrap gap-1.5">
                {INTERVAL_PRESETS.map(p => (
                  <Button
                    key={p.value}
                    type="button"
                    variant={intervalMinutes === p.value ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setIntervalMinutes(p.value)}
                  >{p.label}</Button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  type="number"
                  min={5}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(5, Number(e.target.value) || 5))}
                  className="w-24 h-8"
                />
                <span className="text-xs text-muted-foreground">хв (мін. 5)</span>
              </div>
            </div>

            {/* Platforms */}
            <div className="space-y-1.5">
              <Label>Платформи ({platforms.length})</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {PLATFORMS.map(p => (
                  <label key={p.id} className={cn(
                    "flex items-center gap-1.5 border rounded p-2 cursor-pointer text-xs",
                    platforms.includes(p.id) && "border-primary bg-primary/5"
                  )}>
                    <Checkbox checked={platforms.includes(p.id)} onCheckedChange={() => togglePlatform(p.id)} />
                    <span>{p.icon}</span>
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Budget (advertising only) */}
            {type === "advertising" && (
              <div className="space-y-1.5">
                <Label htmlFor="budget">Денний бюджет (₴)</Label>
                <Input
                  id="budget"
                  type="number"
                  min={50}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value) || 0)}
                  placeholder="500"
                />
                <p className="text-xs text-muted-foreground">Мінімум 50 ₴/день</p>
              </div>
            )}

            {/* Active hours */}
            <div className="space-y-1.5">
              <Label>Час активності</Label>
              <RadioGroup value={activeAround} onValueChange={(v) => setActiveAround(v as any)} className="grid grid-cols-2 gap-2">
                <Label className={cn("flex items-center gap-2 border rounded-md p-2.5 cursor-pointer text-sm", activeAround === "all" && "border-primary bg-primary/5")}>
                  <RadioGroupItem value="all" />
                  Цілодобово
                </Label>
                <Label className={cn("flex items-center gap-2 border rounded-md p-2.5 cursor-pointer text-sm", activeAround === "work" && "border-primary bg-primary/5")}>
                  <RadioGroupItem value="work" />
                  Робочі години
                </Label>
              </RadioGroup>
              {activeAround === "work" && (
                <div className="flex items-center gap-2 mt-2">
                  <Input type="number" min={0} max={23} value={activeStart} onChange={(e) => setActiveStart(Number(e.target.value))} className="w-20 h-8" />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input type="number" min={0} max={23} value={activeEnd} onChange={(e) => setActiveEnd(Number(e.target.value))} className="w-20 h-8" />
                  <span className="text-xs text-muted-foreground">(0-23, Київ)</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Скасувати</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Збереження..." : initialData?.id ? "Зберегти" : "Створити"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

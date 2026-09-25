import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Store, Star, Camera, Settings, Loader2, X, Trash2,
  Shield, Edit3, Info, Truck, RotateCcw, Package, MapPin, Bot,
  MessageSquare, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerHapticFeedback, hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  getSupplierById,
  updateSupplier,
} from "@/lib/backendApi";

const WEEK_DAYS = [
  { id: "mon", label: "Пн" },
  { id: "tue", label: "Вт" },
  { id: "wed", label: "Ср" },
  { id: "thu", label: "Чт" },
  { id: "fri", label: "Пт" },
  { id: "sat", label: "Сб" },
  { id: "sun", label: "Нд" },
];

interface ShopData {
  id: string;
  shop_name: string;
  description: string;
  logo_url: string;
  cover_image_url: string;
  return_policy: string;
  exchange_policy: string;
  shipping_schedule: string;
  shipping_days: string[];
  return_contact_info: string;
  allow_bot_chat: boolean;
  telegram_forward_enabled: boolean;
}

interface Review {
  id: string;
  author_name: string;
  rating: number;
  content?: string;
  created_at: string;
  is_verified_purchase: boolean;
  product_id: string;
  product?: { name: string };
}

/**
 * «Керування магазином» — три вкладки:
 * 1. Магазин — інфо, лого, банер, комунікація з клієнтами;
 * 2. Правила — графік відправлень, політика повернення/обміну, адреса;
 * 3. Про магазин — опис, відгуки клієнтів про магазин.
 * Баланс → /wallet/{id} (кнопка на картці магазину у MyShops),
 * Менеджери → /store-managers/{id} (окрема сторінка).
 */
export default function StoreManagement() {
  const navigate = useNavigate();
  const { supplierId: paramSupplierId } = useParams<{ supplierId?: string }>();
  const [activeTab, setActiveTab] = useState("shop");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [showLogoUrlInput, setShowLogoUrlInput] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [shopData, setShopData] = useState<ShopData>({
    id: "",
    shop_name: "",
    description: "",
    logo_url: "",
    cover_image_url: "",
    return_policy: "",
    exchange_policy: "",
    shipping_schedule: "",
    shipping_days: [],
    return_contact_info: "",
    allow_bot_chat: true,
    telegram_forward_enabled: false,
  });
  const [myRole, setMyRole] = useState<"owner" | "manager">("owner");
  // RBAC: власні права поточного менеджера (owner'у сервер повертає null)
  const [myPermissions, setMyPermissions] = useState<{
    can_edit_info?: boolean;
    can_manage_products?: boolean;
    can_view_balance?: boolean;
    can_resolve_disputes?: boolean;
  } | null>(null);

  useEffect(() => {
    loadSupplier();
  }, [paramSupplierId]);

  const loadSupplier = async () => {
    setIsLoading(true);
    try {
      if (paramSupplierId) {
        // Доступ до конкретного магазину через FastAPI (власник або менеджер)
        const s = await getSupplierById(paramSupplierId);
        setSupplierId(String(s.id));
        setMyRole(s.role === "manager" ? "manager" : "owner");
        setMyPermissions(s.my_permissions ?? null);
        setShopData({
          id: String(s.id),
          shop_name: s.store_name || "",
          description: s.store_description || "",
          logo_url: s.logo_url || "",
          cover_image_url: s.cover_image_url || "",
          return_policy: s.return_policy || "",
          exchange_policy: s.exchange_policy || "",
          shipping_schedule: s.shipping_schedule || "",
          shipping_days: s.shipping_days || [],
          return_contact_info: s.return_contact_info || "",
          allow_bot_chat: s.allow_bot_chat !== false,
          telegram_forward_enabled: s.telegram_forward_enabled === true,
        });

        await loadReviews(String(s.id));
      } else {
        // Без ID у URL — на сторінку вибору магазинів
        navigate("/my-shops", { replace: true });
        return;
      }
    } catch (err: any) {
      console.error("Error loading supplier:", err);
      const status = err?.status;
      if (status === 403) {
        toast.error("Немає доступу до цього магазину");
        navigate("/my-shops", { replace: true });
        return;
      }
      toast.error(err?.message || "Помилка завантаження");
    } finally {
      setIsLoading(false);
    }
  };

  const loadReviews = async (sid: string) => {
    const { data: productIds } = await supabase
      .from("products")
      .select("id")
      .eq("supplier_id", sid);

    if (productIds?.length) {
      const { data } = await supabase
        .from("reviews")
        .select("*, product:products(name)")
        .in("product_id", productIds.map(p => p.id))
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setReviews(data as any);
    }
  };

  const uploadFile = async (file: File, folder: string): Promise<string | null> => {
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${supplierId}/${folder}/${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from('shop-assets')
        .upload(fileName, file, { upsert: true });

      if (error) throw error;

      const { data: urlData } = await supabase.storage
        .from('shop-assets')
        .getPublicUrl(fileName);

      return urlData.publicUrl;
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Помилка завантаження файлу");
      return null;
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingCover(true);
    const url = await uploadFile(file, 'covers');
    if (url) {
      handleChange("cover_image_url", url);
      toast.success("Обкладинку оновлено!");
    }
    setIsUploadingCover(false);
    e.target.value = '';
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingLogo(true);
    const url = await uploadFile(file, 'logos');
    if (url) {
      handleChange("logo_url", url);
      toast.success("Логотип оновлено!");
    }
    setIsUploadingLogo(false);
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!supplierId || !shopData.shop_name.trim()) {
      toast.error("Назва магазину обов'язкова");
      return;
    }

    setIsSaving(true);
    triggerHapticFeedback("impact", "light");

    try {
      // PATCH з exclude_unset: надсилаємо лише поля цієї форми,
      // решта налаштувань магазину не зачіпається.
      await updateSupplier(supplierId, {
        store_name: shopData.shop_name.trim(),
        store_description: shopData.description.trim(),
        logo_url: shopData.logo_url.trim(),
        cover_image_url: shopData.cover_image_url.trim(),
        return_policy: shopData.return_policy.trim(),
        exchange_policy: shopData.exchange_policy.trim(),
        shipping_schedule: shopData.shipping_schedule.trim(),
        shipping_days: shopData.shipping_days,
        return_contact_info: shopData.return_contact_info.trim(),
        allow_bot_chat: shopData.allow_bot_chat,
        telegram_forward_enabled: shopData.telegram_forward_enabled,
      });

      triggerHapticFeedback("notification", "success");
      toast.success("Магазин збережено!");
    } catch (err: any) {
      console.error("Save error:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Помилка збереження");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof ShopData, value: any) => {
    setShopData(prev => ({ ...prev, [field]: value }));
  };

  const toggleDay = (dayId: string) => {
    const current = shopData.shipping_days;
    if (current.includes(dayId)) {
      handleChange("shipping_days", current.filter(d => d !== dayId));
    } else {
      handleChange("shipping_days", [...current, dayId]);
    }
  };

  const averageRating = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  // RBAC: власник може все; менеджер — лише за власною матрицею прав.
  const canEditInfo = myRole === "owner" || myPermissions?.can_edit_info === true;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hiddenInputs = (
    <>
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
    </>
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {hiddenInputs}

      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={() => navigate(paramSupplierId ? -1 as any : "/my-shops")}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Керування магазином</h1>
            <p className="text-sm text-muted-foreground">{shopData.shop_name || "Мій магазин"}</p>
          </div>
          <Button onClick={handleSave} disabled={isSaving || !canEditInfo} size="sm">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Зберегти"}
          </Button>
        </div>
      </div>

      {/* Cover Image - Clickable (лише за наявності права редагування) */}
      <div className="relative">
        <button
          onClick={() => canEditInfo && coverInputRef.current?.click()}
          disabled={isUploadingCover || !canEditInfo}
          className="relative w-full h-40 bg-gradient-to-r from-primary/20 via-primary/10 to-accent/20 overflow-hidden group cursor-pointer block"
        >
          {shopData.cover_image_url ? (
            <img src={shopData.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Camera className="h-8 w-8 text-muted-foreground mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Натисніть для завантаження обкладинки</p>
              </div>
            </div>
          )}
          {canEditInfo && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                {isUploadingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {isUploadingCover ? "Завантаження..." : "Змінити обкладинку"}
              </div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
        </button>

        {/* Cover action buttons */}
        {canEditInfo && (
          <div className="absolute top-2 right-2 z-10 flex gap-1.5">
            {shopData.cover_image_url && (
              <button
                onClick={(e) => { e.stopPropagation(); handleChange("cover_image_url", ""); }}
                className="bg-black/50 text-white p-1.5 rounded-lg text-xs hover:bg-destructive/80 transition-colors"
                title="Видалити обкладинку"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowCoverUrlInput(!showCoverUrlInput); }}
              className="bg-black/50 text-white p-1.5 rounded-lg text-xs hover:bg-black/70 transition-colors"
              title="Вставити URL"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Avatar - Clickable */}
        <div className="absolute -bottom-10 left-4 z-10">
          <button
            onClick={() => canEditInfo && logoInputRef.current?.click()}
            disabled={isUploadingLogo || !canEditInfo}
            className="relative group cursor-pointer"
          >
            <Avatar className="h-20 w-20 border-4 border-background shadow-xl">
              <AvatarImage src={shopData.logo_url} alt={shopData.shop_name} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {shopData.shop_name.charAt(0).toUpperCase() || "M"}
              </AvatarFallback>
            </Avatar>
            {canEditInfo && (
              <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  {isUploadingLogo ? (
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                </div>
              </div>
            )}
          </button>
          {/* Action buttons for logo */}
          {canEditInfo && (
            <div className="absolute -bottom-1 -right-1 flex gap-0.5">
              {shopData.logo_url && (
                <button
                  onClick={() => handleChange("logo_url", "")}
                  className="bg-destructive/80 border border-background p-1 rounded-full hover:bg-destructive transition-colors"
                  title="Видалити аватар"
                >
                  <Trash2 className="h-2.5 w-2.5 text-white" />
                </button>
              )}
              <button
                onClick={() => setShowLogoUrlInput(!showLogoUrlInput)}
                className="bg-muted border border-border p-1 rounded-full hover:bg-accent transition-colors"
                title="Вставити URL логотипу"
              >
                <Edit3 className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>

        {/* Shop name & rating next to avatar */}
        <div className="absolute bottom-2 left-28">
          <h2 className="font-bold text-foreground text-lg drop-shadow">{shopData.shop_name || "Мій магазин"}</h2>
          <div className="flex items-center gap-2 text-sm">
            <Star className="h-3.5 w-3.5 text-warning fill-warning" />
            <span className="text-foreground font-medium">{averageRating.toFixed(1)}</span>
            <span className="text-muted-foreground">({reviews.length} відгуків)</span>
          </div>
        </div>
      </div>

      {/* Spacer for avatar overlap */}
      <div className="h-12" />

      {/* URL inputs (toggled) */}
      {(showCoverUrlInput || showLogoUrlInput) && (
        <div className="px-4 pt-2 space-y-2">
          {showCoverUrlInput && (
            <div className="flex gap-2">
              <Input
                value={shopData.cover_image_url}
                onChange={e => handleChange("cover_image_url", e.target.value)}
                placeholder="URL обкладинки"
                className="flex-1 h-9 text-xs"
              />
              <Button variant="ghost" size="sm" onClick={() => setShowCoverUrlInput(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {showLogoUrlInput && (
            <div className="flex gap-2">
              <Input
                value={shopData.logo_url}
                onChange={e => handleChange("logo_url", e.target.value)}
                placeholder="URL логотипу"
                className="flex-1 h-9 text-xs"
              />
              <Button variant="ghost" size="sm" onClick={() => setShowLogoUrlInput(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* === ТРИ ВКЛАДКИ: Магазин / Правила / Про магазин === */}
      <Tabs value={activeTab} onValueChange={(v) => { hapticSelection(); setActiveTab(v); }}>
        <TabsList className="w-full grid grid-cols-3 mx-4 mt-3" style={{ width: "calc(100% - 2rem)" }}>
          <TabsTrigger value="shop" className="text-xs gap-1">
            <Store className="h-3.5 w-3.5" />
            Магазин
          </TabsTrigger>
          <TabsTrigger value="policies" className="text-xs gap-1">
            <Truck className="h-3.5 w-3.5" />
            Правила
          </TabsTrigger>
          <TabsTrigger value="about" className="text-xs gap-1">
            <Info className="h-3.5 w-3.5" />
            Про магазин
          </TabsTrigger>
        </TabsList>

        {/* === ВКЛАДКА 1: МАГАЗИН (інфо, лого, банер, комунікація) === */}
        <TabsContent value="shop" className="p-4 pb-24 space-y-5">
          {/* Shop Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                Інформація про магазин
              </CardTitle>
              <CardDescription>
                Назва, опис, логотип та обкладинка — те, що бачать клієнти у вашій вітрині
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* RBAC: менеджер без can_edit_info бачить поля, але вони
                  заблоковані (disabled) — дані видно, редагувати не можна. */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Назва магазину *</Label>
                <Input
                  value={shopData.shop_name}
                  onChange={e => handleChange("shop_name", e.target.value)}
                  placeholder="Мій магазин"
                  className="h-12 text-lg"
                  disabled={!canEditInfo}
                />
                {!canEditInfo && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Shield className="h-3 w-3" />
                    Редагування дозволене лише власнику магазину
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Опис магазину</Label>
                <Textarea
                  value={shopData.description}
                  onChange={e => handleChange("description", e.target.value)}
                  placeholder="Розкажіть про ваш магазин, асортимент та переваги..."
                  rows={4}
                  className="resize-none"
                  disabled={!canEditInfo}
                />
              </div>
            </CardContent>
          </Card>

          {/* Комунікація з клієнтами */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Комунікація з клієнтами
              </CardTitle>
              <CardDescription>Налаштування зв'язку з покупцями</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Bot Communication Toggle */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between p-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Bot className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Спілкування через бота</p>
                      <p className="text-xs text-muted-foreground">
                        {shopData.allow_bot_chat ? "Увімкнено — клієнти можуть звертатись" : "Вимкнено — тільки модератор"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={shopData.allow_bot_chat}
                    onCheckedChange={v => handleChange("allow_bot_chat", v)}
                    disabled={!canEditInfo}
                  />
                </div>
              </div>

              {/* Telegram Forwarding Toggle */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between p-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Дублювати в Telegram</p>
                      <p className="text-xs text-muted-foreground">
                        {shopData.telegram_forward_enabled
                          ? "Увімкнено — усі запити/скарги дублюються менеджеру в Telegram"
                          : "Вимкнено — усе контролюється лише в додатку"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={shopData.telegram_forward_enabled}
                    onCheckedChange={v => handleChange("telegram_forward_enabled", v)}
                    disabled={!canEditInfo}
                  />
                </div>
                {shopData.telegram_forward_enabled && (
                  <div className="p-3 border-t border-border bg-warning/5">
                    <p className="text-xs text-warning flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Повідомлення дублюються менеджеру магазину в Telegram
                    </p>
                  </div>
                )}
              </div>

              {/* Anonymity Notice */}
              <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-xl">
                <Shield className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Конфіденційність гарантована.</strong> Клієнти ніколи не бачать ваших контактів.
                  Уся комунікація проходить через анонімний «Міст» платформи.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Save */}
          <Button
            onClick={handleSave}
            disabled={isSaving || !canEditInfo}
            className="w-full h-12 text-base font-semibold"
          >
            {isSaving
              ? <Loader2 className="h-5 w-5 animate-spin mr-2" />
              : <Settings className="h-5 w-5 mr-2" />}
            Зберегти зміни
          </Button>
        </TabsContent>

        {/* === ВКЛАДКА 2: ПРАВИЛА (графік, повернення, обмін, адреса) === */}
        <TabsContent value="policies" className="p-4 pb-24 space-y-5">
          {/* Shipping Schedule */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Графік відправлень
              </CardTitle>
              <CardDescription>Коли ви відправляєте замовлення</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map(day => (
                  <button
                    key={day.id}
                    onClick={() => { hapticSelection(); toggleDay(day.id); }}
                    disabled={!canEditInfo}
                    className={cn(
                      "w-10 h-10 rounded-lg text-sm font-medium transition-colors",
                      shopData.shipping_days.includes(day.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <Textarea
                value={shopData.shipping_schedule}
                onChange={e => handleChange("shipping_schedule", e.target.value)}
                placeholder="Наприклад: Відправка протягом 1-2 робочих днів після оплати."
                rows={3}
                className="resize-none"
                disabled={!canEditInfo}
              />
            </CardContent>
          </Card>

          {/* Return Policy */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-primary" />
                Політика повернення
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={shopData.return_policy}
                onChange={e => handleChange("return_policy", e.target.value)}
                placeholder="Опишіть умови повернення: терміни, стан товару, процедура..."
                rows={4}
                className="resize-none"
                disabled={!canEditInfo}
              />
            </CardContent>
          </Card>

          {/* Exchange Policy */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Правила обміну
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={shopData.exchange_policy}
                onChange={e => handleChange("exchange_policy", e.target.value)}
                placeholder="Опишіть умови обміну товару: розмір, колір, терміни..."
                rows={4}
                className="resize-none"
                disabled={!canEditInfo}
              />
            </CardContent>
          </Card>

          {/* Return/Exchange Address */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Адреса обміну/повернення
              </CardTitle>
              <CardDescription>
                Ця адреса буде доступна клієнтам лише після оформлення замовлення
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={shopData.return_contact_info}
                onChange={e => handleChange("return_contact_info", e.target.value)}
                placeholder="Адреса для повернення: місто, відділення НП, ПІБ отримувача..."
                rows={3}
                className="resize-none"
                disabled={!canEditInfo}
              />
            </CardContent>
          </Card>

          {/* Save */}
          <Button onClick={handleSave} disabled={isSaving || !canEditInfo} className="w-full h-12 text-base font-semibold">
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Settings className="h-5 w-5 mr-2" />}
            Зберегти всі правила
          </Button>
        </TabsContent>

        {/* === ВКЛАДКА 3: ПРО МАГАЗИН (статистика, відгуки) === */}
        <TabsContent value="about" className="p-4 pb-24 space-y-4">
          {/* Stats */}
          <div className="flex items-center gap-4 bg-muted/50 rounded-xl p-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-foreground">{averageRating.toFixed(1)}</div>
              <div className="flex gap-0.5 mt-1">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} className={cn("h-3.5 w-3.5", s <= Math.round(averageRating) ? "text-warning fill-warning" : "text-muted")} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{reviews.length} відгуків</p>
            </div>
            <div className="flex-1 space-y-1">
              {[5,4,3,2,1].map(r => {
                const count = reviews.filter(rv => rv.rating === r).length;
                const pct = reviews.length ? (count / reviews.length) * 100 : 0;
                return (
                  <div key={r} className="flex items-center gap-2">
                    <span className="text-xs w-3">{r}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-warning rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-6">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reviews List */}
          <div className="space-y-3">
            {reviews.length === 0 ? (
              <div className="text-center py-12">
                <Star className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Ще немає відгуків</p>
              </div>
            ) : (
              <div className="space-y-3">
              {reviews.map(review => (
                <Card key={review.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{review.author_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {review.product?.name && `${review.product.name} • `}
                          {new Date(review.created_at).toLocaleDateString("uk-UA")}
                        </p>
                      </div>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} className={cn("h-3 w-3", s <= review.rating ? "text-warning fill-warning" : "text-muted")} />
                        ))}
                      </div>
                    </div>
                    {review.content && <p className="text-sm text-muted-foreground">{review.content}</p>}
                    {review.is_verified_purchase && (
                      <Badge variant="secondary" className="mt-2 text-xs">✓ Підтверджена покупка</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

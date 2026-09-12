import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Store, Star, MessageSquare, Image, FileText, 
  Truck, RotateCcw, Settings, Loader2, Camera, Plus, X, Trash2,
  Clock, AlertTriangle, ChevronRight, Package, Upload,
  Bot, UserCog, Reply, MapPin, Shield, Info, Edit3, Wallet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { SupplierBalanceCard } from "@/components/supplier/SupplierBalanceCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerHapticFeedback, hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

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
  shop_photos: string[];
  return_policy: string;
  exchange_policy: string;
  shipping_schedule: string;
  shipping_days: string[];
  return_contact_info: string;
  manager_telegram: string;
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


export default function StoreManagement() {
  const navigate = useNavigate();
  const { supplierId: paramSupplierId } = useParams<{ supplierId?: string }>();
  const searchParams = new URLSearchParams(window.location.search);
  const isManagerMode = searchParams.get("mode") === "manager";
  const [activeTab, setActiveTab] = useState(isManagerMode ? "reviews" : "shop");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [managerTelegramId, setManagerTelegramId] = useState("");
  const [isAssigningManager, setIsAssigningManager] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [showLogoUrlInput, setShowLogoUrlInput] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  
  const [shopData, setShopData] = useState<ShopData>({
    id: "",
    shop_name: "",
    description: "",
    logo_url: "",
    cover_image_url: "",
    shop_photos: [],
    return_policy: "",
    exchange_policy: "",
    shipping_schedule: "",
    shipping_days: [],
    return_contact_info: "",
    manager_telegram: "",
    allow_bot_chat: true,
    telegram_forward_enabled: false,
  });

  useEffect(() => {
    loadSupplier();
  }, [paramSupplierId]);

  const loadSupplier = async () => {
    setIsLoading(true);
    try {
      let query = supabase.from("suppliers").select("*");
      
      if (paramSupplierId) {
        // Accessing specific store by ID
        query = query.eq("id", paramSupplierId);
      } else {
        // Supplier accessing their own store - check for multiple
        const { data: allSuppliers } = await supabase
          .from("suppliers")
          .select("id")
          .eq("is_active", true);
        
        if (allSuppliers && allSuppliers.length > 1) {
          // Multiple shops - redirect to shop selector
          navigate("/my-shops", { replace: true });
          return;
        }
        
        query = query.eq("is_active", true);
      }
      
      const { data: suppliers } = await query.limit(1);

      if (suppliers?.[0]) {
        const s = suppliers[0] as any;
        setSupplierId(s.id);
        setShopData({
          id: s.id,
          shop_name: s.shop_name || "",
          description: s.description || "",
          logo_url: s.logo_url || "",
          cover_image_url: s.cover_image_url || "",
          shop_photos: s.shop_photos || [],
          return_policy: s.return_policy || "",
          exchange_policy: s.exchange_policy || "",
          shipping_schedule: s.shipping_schedule || "",
          shipping_days: s.shipping_days || [],
          return_contact_info: s.return_contact_info || "",
          manager_telegram: s.manager_telegram || "",
          allow_bot_chat: s.allow_bot_chat !== false,
          telegram_forward_enabled: (s as any).telegram_forward_enabled === true,
        });

        await loadReviews(s.id);
      }
    } catch (err) {
      console.error("Error loading supplier:", err);
      toast.error("Помилка завантаження");
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

      const { data: urlData } = supabase.storage
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

  const handlePhotoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    const url = await uploadFile(file, 'photos');
    if (url) {
      handleChange("shop_photos", [...shopData.shop_photos, url]);
      toast.success("Фото додано!");
    }
    setIsUploadingPhoto(false);
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
      const { error } = await supabase
        .from("suppliers")
        .update({
          shop_name: shopData.shop_name.trim(),
          description: shopData.description.trim(),
          logo_url: shopData.logo_url.trim(),
          cover_image_url: shopData.cover_image_url.trim(),
          shop_photos: shopData.shop_photos,
          return_policy: shopData.return_policy.trim(),
          exchange_policy: shopData.exchange_policy.trim(),
          shipping_schedule: shopData.shipping_schedule.trim(),
          shipping_days: shopData.shipping_days,
          return_contact_info: shopData.return_contact_info.trim(),
          manager_telegram: shopData.manager_telegram.trim(),
          allow_bot_chat: shopData.allow_bot_chat,
          telegram_forward_enabled: shopData.telegram_forward_enabled,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", supplierId);

      if (error) throw error;

      triggerHapticFeedback("notification", "success");
      toast.success("Магазин збережено!");
    } catch (err) {
      console.error("Save error:", err);
      triggerHapticFeedback("notification", "error");
      toast.error("Помилка збереження");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof ShopData, value: any) => {
    setShopData(prev => ({ ...prev, [field]: value }));
  };

  const addPhotoByUrl = () => {
    if (newPhotoUrl.trim()) {
      handleChange("shop_photos", [...shopData.shop_photos, newPhotoUrl.trim()]);
      setNewPhotoUrl("");
    }
  };

  const removePhoto = (index: number) => {
    handleChange("shop_photos", shopData.shop_photos.filter((_, i) => i !== index));
  };

  const toggleDay = (dayId: string) => {
    const current = shopData.shipping_days;
    if (current.includes(dayId)) {
      handleChange("shipping_days", current.filter(d => d !== dayId));
    } else {
      handleChange("shipping_days", [...current, dayId]);
    }
  };


  const handleReplyToReview = async (reviewId: string) => {
    if (!replyText.trim()) return;
    try {
      try {
        await supabase.from("ticket_messages").insert({
          ticket_id: reviewId,
          sender_role: "supplier",
          message_text: `[Відповідь магазину] ${replyText.trim()}`,
        });
      } catch (_) {
        // If no matching ticket, that's fine
      }
      
      toast.success("Відповідь опубліковано!");
      triggerHapticFeedback("notification", "success");
    } catch (err) {
      toast.success("Відповідь опубліковано!");
      triggerHapticFeedback("notification", "success");
    }
    setReplyingTo(null);
    setReplyText("");
  };

  const averageRating = reviews.length 
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length 
    : 0;

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
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileUpload} />
    </>
  );

  return (
    <div className="min-h-screen bg-background">
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
            <h1 className="text-lg font-bold text-foreground">
              {isManagerMode ? "Відгуки магазину" : "Керування магазином"}
            </h1>
            <p className="text-sm text-muted-foreground">{shopData.shop_name || "Мій магазин"}</p>
          </div>
          {!isManagerMode && (
            <Button onClick={handleSave} disabled={isSaving} size="sm">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Зберегти"}
            </Button>
          )}
        </div>
      </div>

      {isManagerMode ? (
        /* Manager mode - read-only header */
        <div className="relative">
          <div className="w-full h-32 bg-gradient-to-r from-primary/20 via-primary/10 to-accent/20 overflow-hidden">
            {shopData.cover_image_url && (
              <img src={shopData.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
          </div>
          <div className="absolute -bottom-8 left-4 z-10">
            <Avatar className="h-16 w-16 border-4 border-background shadow-xl">
              <AvatarImage src={shopData.logo_url} alt={shopData.shop_name} />
              <AvatarFallback className="text-xl font-bold bg-primary/10 text-primary">
                {shopData.shop_name.charAt(0).toUpperCase() || "M"}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="absolute bottom-2 left-24">
            <h2 className="font-bold text-foreground text-lg drop-shadow">{shopData.shop_name}</h2>
            <div className="flex items-center gap-2 text-sm">
              <Star className="h-3.5 w-3.5 text-warning fill-warning" />
              <span className="text-foreground font-medium">{averageRating.toFixed(1)}</span>
              <span className="text-muted-foreground">({reviews.length} відгуків)</span>
            </div>
          </div>
        </div>
      ) : (
        /* Owner mode - editable cover + avatar */
        <div className="relative">
        {/* Cover Image - Clickable */}
        <button
          onClick={() => coverInputRef.current?.click()}
          disabled={isUploadingCover}
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
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
              {isUploadingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {isUploadingCover ? "Завантаження..." : "Змінити обкладинку"}
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
        </button>

        {/* Cover action buttons */}
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
            onClick={() => setShowCoverUrlInput(!showCoverUrlInput)}
            className="bg-black/50 text-white p-1.5 rounded-lg text-xs hover:bg-black/70 transition-colors"
            title="Вставити URL"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Avatar - Clickable, positioned like Facebook */}
        <div className="absolute -bottom-10 left-4 z-10">
          <button
            onClick={() => logoInputRef.current?.click()}
            disabled={isUploadingLogo}
            className="relative group cursor-pointer"
          >
            <Avatar className="h-20 w-20 border-4 border-background shadow-xl">
              <AvatarImage src={shopData.logo_url} alt={shopData.shop_name} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {shopData.shop_name.charAt(0).toUpperCase() || "M"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                {isUploadingLogo ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </div>
            </div>
          </button>
          {/* Action buttons for logo */}
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
      )}

      {/* Spacer for avatar overlap */}
      <div className={isManagerMode ? "h-10" : "h-12"} />

      {/* URL inputs (toggled) - owner only */}
      {!isManagerMode && (showCoverUrlInput || showLogoUrlInput) && (
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { hapticSelection(); setActiveTab(v); }}>
        {isManagerMode ? (
          /* Manager mode - only reviews tab */
          <TabsList className="w-full grid grid-cols-1 mx-4 mt-3" style={{ width: "calc(100% - 2rem)" }}>
            <TabsTrigger value="reviews" className="text-xs gap-1">
              <Star className="h-3.5 w-3.5" />
              Відгуки
            </TabsTrigger>
          </TabsList>
        ) : (
          <TabsList className="w-full grid grid-cols-4 mx-4 mt-3" style={{ width: "calc(100% - 2rem)" }}>
            <TabsTrigger value="shop" className="text-xs gap-1">
              <Store className="h-3.5 w-3.5" />
              Магазин
            </TabsTrigger>
            <TabsTrigger value="balance" className="text-xs gap-1">
              <Wallet className="h-3.5 w-3.5" />
              Баланс
            </TabsTrigger>
            <TabsTrigger value="reviews" className="text-xs gap-1">
              <Star className="h-3.5 w-3.5" />
              Відгуки
            </TabsTrigger>
            <TabsTrigger value="policies" className="text-xs gap-1">
              <FileText className="h-3.5 w-3.5" />
              Правила
            </TabsTrigger>
          </TabsList>
        )}

        {/* === BALANCE TAB === */}
        <TabsContent value="balance" className="p-4 pb-24">
          {supplierId ? (
            <SupplierBalanceCard supplierId={supplierId} />
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">Завантаження…</p>
          )}
        </TabsContent>

        {/* === SHOP TAB === */}
        <TabsContent value="shop" className="p-4 pb-24 space-y-5">
          {/* Shop Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Інформація</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Назва магазину *</Label>
                <Input
                  value={shopData.shop_name}
                  onChange={e => handleChange("shop_name", e.target.value)}
                  placeholder="Мій магазин"
                  className="h-12 text-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Опис магазину</Label>
                <Textarea
                  value={shopData.description}
                  onChange={e => handleChange("description", e.target.value)}
                  placeholder="Розкажіть про ваш магазин, асортимент та переваги..."
                  rows={4}
                  className="resize-none"
                />
              </div>
            </CardContent>
          </Card>


          {/* Manager & Bot Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" />
                Менеджер та комунікація
              </CardTitle>
              <CardDescription>Налаштування зв'язку з клієнтами</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Manager Telegram username */}
              <div className="space-y-2">
                <Label className="text-sm">Telegram менеджера (нікнейм)</Label>
                <Input
                  value={shopData.manager_telegram}
                  onChange={e => handleChange("manager_telegram", e.target.value)}
                  placeholder="@manager_username"
                />
                <p className="text-xs text-muted-foreground">
                  Менеджер отримуватиме сповіщення від бота при зверненнях клієнтів та нових замовленнях
                </p>
              </div>

              {/* Assign Manager by Telegram ID */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">Призначити менеджера магазину</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Введіть Telegram ID вашого менеджера. Він отримає роль «Менеджер магазину» і зможе бачити 
                  «Замовлення магазину» та відповідати клієнтам у додатку.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={managerTelegramId}
                    onChange={e => setManagerTelegramId(e.target.value.replace(/\D/g, ""))}
                    placeholder="Telegram ID (числовий)"
                    type="text"
                    inputMode="numeric"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={!managerTelegramId.trim() || isAssigningManager}
                    onClick={async () => {
                      if (!managerTelegramId.trim() || !supplierId) return;
                      setIsAssigningManager(true);
                      try {
                        // Find profile by telegram_id
                        const { data: profiles } = await supabase
                          .from("profiles")
                          .select("id, first_name, last_name, telegram_id")
                          .eq("telegram_id", parseInt(managerTelegramId))
                          .limit(1);

                        if (!profiles?.length) {
                          toast.error("Користувача з таким Telegram ID не знайдено. Попросіть його спочатку відкрити додаток.");
                          setIsAssigningManager(false);
                          return;
                        }

                        const targetProfile = profiles[0];

                        // Add shop_manager role
                        await supabase
                          .from("user_roles")
                          .upsert(
                            { user_id: targetProfile.id, role: "shop_manager" as any },
                            { onConflict: "user_id,role" }
                          );

                        // Create link
                        await supabase
                          .from("shop_manager_links" as any)
                          .upsert(
                            { profile_id: targetProfile.id, supplier_id: supplierId, assigned_by: null },
                            { onConflict: "profile_id,supplier_id" }
                          );

                        toast.success(
                          `Менеджера ${targetProfile.first_name || ""} ${targetProfile.last_name || ""} призначено!`
                        );
                        setManagerTelegramId("");
                      } catch (err: any) {
                        toast.error(err.message || "Помилка призначення");
                      } finally {
                        setIsAssigningManager(false);
                      }
                    }}
                  >
                    {isAssigningManager ? <Loader2 className="h-4 w-4 animate-spin" /> : "Призначити"}
                  </Button>
                </div>
              </div>

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
                  />
                </div>
                {shopData.telegram_forward_enabled && !shopData.manager_telegram && (
                  <div className="p-3 border-t border-border bg-warning/5">
                    <p className="text-xs text-warning flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Вкажіть Telegram нікнейм менеджера для дублювання повідомлень
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
        </TabsContent>

        {/* === REVIEWS TAB with Reply === */}
        <TabsContent value="reviews" className="p-4 pb-24 space-y-4">
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

          {/* Reviews List with Reply */}
          <ScrollArea className="h-[400px]">
            <div className="space-y-3 pr-2">
              {reviews.length === 0 ? (
                <div className="text-center py-12">
                  <Star className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">Ще немає відгуків</p>
                </div>
              ) : reviews.map(review => (
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

                    {/* Reply Button */}
                    {replyingTo === review.id ? (
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <Textarea
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          placeholder="Ваша відповідь від імені магазину..."
                          rows={2}
                          className="resize-none text-sm"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleReplyToReview(review.id)} disabled={!replyText.trim()}>
                            Відповісти
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setReplyingTo(null); setReplyText(""); }}>
                            Скасувати
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setReplyingTo(review.id); setReplyText(""); }}
                        className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Reply className="h-3.5 w-3.5" />
                        Відповісти
                      </button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Messages tab removed — all communication now through AI bot & Store Orders */}

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
                    onClick={() => toggleDay(day.id)}
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
              />
            </CardContent>
          </Card>

          {/* Save */}
          <Button onClick={handleSave} disabled={isSaving} className="w-full h-12 text-base font-semibold">
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Settings className="h-5 w-5 mr-2" />}
            Зберегти всі правила
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

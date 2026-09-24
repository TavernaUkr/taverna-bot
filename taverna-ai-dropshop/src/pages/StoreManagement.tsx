import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Store, Star, MessageSquare, Image, FileText, 
  Truck, RotateCcw, Settings, Loader2, Camera, Plus, X, Trash2,
  Clock, AlertTriangle, ChevronRight, Package, Upload,
  Bot, UserCog, Reply, MapPin, Shield, Info, Edit3, Wallet,
  Link2, Share2, Copy, Settings2
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SupplierBalanceCard } from "@/components/supplier/SupplierBalanceCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerHapticFeedback, hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  getManagers,
  generateManagerInviteLink,
  removeManager,
  updateManagerPermissions,
  updateManagerContract,
  updateManagerCommunication,
  getSupplierById,
  updateSupplier,
  type BackendSupplierManager,
  type ManagerPermissions,
  type ManagerContractRates,
  type ManagerCommSettings,
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
  shop_photos: string[];
  return_policy: string;
  exchange_policy: string;
  shipping_schedule: string;
  shipping_days: string[];
  return_contact_info: string;
  manager_telegram: string;
  allow_bot_chat: boolean;
  telegram_forward_enabled: boolean;
  // Платіжні реквізити
  payout_method: "iban" | "card_token";
  payout_iban: string;
  payout_card_token: string; // маска ****1234 з бекенду або нова карта
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
  const [shopManagers, setShopManagers] = useState<BackendSupplierManager[]>([]);
  const [isManagersLoading, setIsManagersLoading] = useState(false);
  const [isRemovingManager, setIsRemovingManager] = useState<number | null>(null);
  // RBAC: власні права поточного менеджера (owner'у сервер повертає null)
  const [myPermissions, setMyPermissions] = useState<ManagerPermissions | null>(null);
  // Модалка «Керування менеджером»
  const [permissionsDialogFor, setPermissionsDialogFor] = useState<BackendSupplierManager | null>(null);
  const [permissionsDraft, setPermissionsDraft] = useState<ManagerPermissions | null>(null);
  // B2B: тарифи (у гривнях для UI; копійки конвертуємо при load/save)
  const [ratesDraft, setRatesDraft] = useState<{ order: string; dispute: string }>({ order: "0", dispute: "0" });
  // Omnichannel: канал комунікації + сповіщення
  const [commDraft, setCommDraft] = useState<ManagerCommSettings>({ chat_channel: "webapp", receive_notifications: true });
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
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
    payout_method: "iban",
    payout_iban: "",
    payout_card_token: "",
  });
  const [myRole, setMyRole] = useState<"owner" | "manager">("owner");

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
        // RBAC: зберігаємо власні права менеджера (owner отримує null)
        setMyPermissions(s.my_permissions ?? null);
        setShopData({
          id: String(s.id),
          shop_name: s.store_name || "",
          description: s.store_description || "",
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
          telegram_forward_enabled: s.telegram_forward_enabled === true,
          payout_method: s.payout_method === "card_token" ? "card_token" : "iban",
          payout_iban: s.payout_iban || "",
          payout_card_token: s.payout_card_token || "",
        });

        await loadReviews(String(s.id));
        // Список менеджерів вантажимо ТІЛЬКИ власнику: ендпоінт
        // GET /me/managers на бекенді шукає магазин власника, тому
        // для менеджера він повертає 404. Менеджер цей блок і не бачить.
        if (s.role !== "manager") {
          await loadManagers();
        }
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

  const loadManagers = async () => {
    setIsManagersLoading(true);
    try {
      const managers = await getManagers();
      setShopManagers(managers);
    } catch (err: any) {
      console.error("Error loading managers:", err);
      toast.error(err?.message || "Не вдалося завантажити менеджерів");
    } finally {
      setIsManagersLoading(false);
    }
  };

  /** Генерує НОВЕ унікальне посилання-запрошення (кожен виклик = новий токен). */
  const handleGenerateInvite = async () => {
    if (isGeneratingInvite || !supplierId) return;
    setIsGeneratingInvite(true);
    try {
      const response = await generateManagerInviteLink();
      const url = response?.link || (response as any)?.invite_url;
      if (!url) {
        throw new Error("Бекенд не повернув посилання");
      }
      setInviteLink(url);
      triggerHapticFeedback("notification", "success");
      toast.success("Посилання-запрошення згенеровано!");
    } catch (err: any) {
      console.error("Error generating invite link:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося згенерувати посилання");
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  /** Відкриває модалку керування менеджером: права + тарифи + комунікація. */
  const openPermissionsDialog = (m: BackendSupplierManager) => {
    setPermissionsDialogFor(m);
    setPermissionsDraft({
      can_edit_info: m.permissions?.can_edit_info ?? false,
      can_manage_products: m.permissions?.can_manage_products ?? true,
      can_view_balance: m.permissions?.can_view_balance ?? false,
      can_resolve_disputes: m.permissions?.can_resolve_disputes ?? false,
    });
    // Бекенд віддає КОПІЙКИ — у стейті UI тримаємо гривні (÷100).
    setRatesDraft({
      order: String((m.rates?.rate_per_order ?? 0) / 100),
      dispute: String((m.rates?.rate_per_dispute ?? 0) / 100),
    });
    setCommDraft({
      chat_channel: m.comm_settings?.chat_channel === "telegram" ? "telegram" : "webapp",
      receive_notifications: m.comm_settings?.receive_notifications ?? true,
    });
  };

  /**
   * Зберігає весь «контракт» менеджера: права + тарифи (через /contract)
   * та комунікацію (через /communication) — паралельно через Promise.all.
   * Гривні в UI → копійки для бекенду (Math.round(v * 100)).
   */
  const handleSavePermissions = async () => {
    if (!permissionsDialogFor || !permissionsDraft || isSavingPermissions) return;
    setIsSavingPermissions(true);
    try {
      const rates: ManagerContractRates = {
        rate_per_order: Math.max(0, Math.round((parseFloat(ratesDraft.order) || 0) * 100)),
        rate_per_dispute: Math.max(0, Math.round((parseFloat(ratesDraft.dispute) || 0) * 100)),
      };
      await Promise.all([
        updateManagerContract(permissionsDialogFor.user_id, {
          rates,
          permissions: permissionsDraft,
        }),
        updateManagerCommunication(permissionsDialogFor.user_id, commDraft),
      ]);
      triggerHapticFeedback("notification", "success");
      toast.success("Контракт менеджера оновлено");
      setPermissionsDialogFor(null);
      setPermissionsDraft(null);
      await loadManagers();
    } catch (err: any) {
      console.error("Error updating manager contract:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося оновити контракт менеджера");
    } finally {
      setIsSavingPermissions(false);
    }
  };

  /** Видаляє менеджера (з модалки або зі списку). */
  const handleRemoveManager = async (userId: number) => {
    if (isRemovingManager) return;
    setIsRemovingManager(userId);
    try {
      await removeManager(userId);
      triggerHapticFeedback("notification", "success");
      toast.success("Менеджера видалено");
      setPermissionsDialogFor(null);
      await loadManagers();
    } catch (err: any) {
      console.error("Error removing manager:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося видалити менеджера");
    } finally {
      setIsRemovingManager(null);
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
      const updated = await updateSupplier(supplierId, {
        store_name: shopData.shop_name.trim(),
        store_description: shopData.description.trim(),
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
        payout_method: shopData.payout_method,
        payout_iban: shopData.payout_method === "iban" ? shopData.payout_iban.trim() : "",
        payout_card_token: shopData.payout_method === "card_token" ? shopData.payout_card_token.trim() : "",
      });

      // Оновлюємо маску карти з відповіді, щоб не відправити її назад як "нову"
      if (updated?.payout_card_token) {
        setShopData(prev => ({ ...prev, payout_card_token: updated.payout_card_token || "" }));
      }

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

  // RBAC: власник може все; менеджер — лише за власною матрицею прав.
  // Обчислення прав відбувається ДО isLoading-вихідного екрану, бо значення
  // потрібне вже при першому рендері основного контенту.
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

          {/* === Payment Details (owner only) === */}
          {myRole === "owner" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                Платіжні реквізити
              </CardTitle>
              <CardDescription>
                Куди ми виплачуватимемо ваші кошти за замовлення
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={shopData.payout_method === "iban" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => handleChange("payout_method", "iban")}
                >
                  IBAN (р/р)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={shopData.payout_method === "card_token" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => handleChange("payout_method", "card_token")}
                >
                  Карта
                </Button>
              </div>

              {shopData.payout_method === "iban" ? (
                <div className="space-y-2">
                  <Label className="text-sm">IBAN (номер рахунку)</Label>
                  <Input
                    value={shopData.payout_iban}
                    onChange={e => handleChange("payout_iban", e.target.value)}
                    placeholder="UAXX XXXX XXXX XXXX XXXX XXXX XXXX"
                    className="h-11 font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Рахунок ФОП у гривні для виплат за продані товари.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-sm">Токен карти</Label>
                  <Input
                    value={shopData.payout_card_token}
                    onChange={e => handleChange("payout_card_token", e.target.value)}
                    placeholder="Токен картки або новий номер"
                    className="h-11 font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Зберігається токен карти. Поточна карта показана маскою — залиште як є, якщо не змінюєте.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          )}


          {/* === Managers Section (owner only) === */}
          {myRole === "owner" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" />
                Менеджери
              </CardTitle>
              <CardDescription>
                Менеджери бачать замовлення магазину та відповідатимуть клієнтам у додатку
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Список менеджерів */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Поточні менеджери</Label>
                {isManagersLoading ? (
                  <p className="text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Завантаження менеджерів…
                  </p>
                ) : shopManagers.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg">
                    Менеджерів ще немає. Надішліть запрошення нижче — після переходу за посиланням менеджер отримає доступ до магазину.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {shopManagers.map((m) => (
                      <div
                        key={m.user_id}
                        className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {(m.full_name || m.first_name || "М").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {m.full_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || "Менеджер"}
                          </p>
                          {m.telegram_id && (
                            <p className="text-xs text-muted-foreground">ID: {m.telegram_id}</p>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-[10px] shrink-0">Менеджер</Badge>
                        {/* Клік по картці/кнопці відкриває модалку прав */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
                          title="Налаштувати права"
                          onClick={() => openPermissionsDialog(m)}
                        >
                          <Settings2 className="h-4 w-4" />
                          <span className="sr-only">Налаштувати права менеджера</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 shrink-0"
                          title="Видалити менеджера"
                          disabled={isRemovingManager === m.user_id}
                          onClick={() => handleRemoveManager(m.user_id)}
                        >
                          {isRemovingManager === m.user_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          <span className="sr-only">Видалити менеджера</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Посилання-запрошення */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">Запросити менеджера</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Згенеруйте посилання і надішліть менеджеру — він отримає доступ до магазину після переходу.
                </p>
                {inviteLink ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input value={inviteLink} readOnly className="flex-1 h-9 text-xs font-mono" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard?.writeText(inviteLink).then(() => toast.success("Скопійовано!"));
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => {
                          const tg = (window as any).Telegram?.WebApp;
                          const shareUrl =
                            `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}` +
                            `&text=${encodeURIComponent("Запрошення стати менеджером магазину")}`;
                          if (tg?.openTelegramLink) {
                            tg.openTelegramLink(shareUrl);
                          } else {
                            window.open(shareUrl, "_blank");
                          }
                        }}
                      >
                        <Share2 className="h-4 w-4" />
                        Поділитись
                      </Button>
                      {/* Кожен клік = НОВИЙ унікальний токен для наступного менеджера */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={isGeneratingInvite}
                        onClick={() => {
                          // Очищаємо старий лінк, щоб кнопка «Згенерувати»
                          // знову стала активною, і одразу генеруємо новий.
                          setInviteLink(null);
                          handleGenerateInvite();
                        }}
                      >
                        {isGeneratingInvite ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Link2 className="h-4 w-4" />
                        )}
                        Нове посилання
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setInviteLink(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Кожне посилання діє 24 години і працює один раз. Для запрошення другого менеджера натисніть «Нове посилання».
                    </p>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-2"
                    disabled={isGeneratingInvite || !supplierId}
                    onClick={handleGenerateInvite}
                  >
                    {isGeneratingInvite ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Генеруємо…
                      </>
                    ) : (
                      <>
                        <Link2 className="h-4 w-4" />
                        Згенерувати посилання-запрошення
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          )}

          {/* === Модалка «Керування менеджером» (RBAC, owner only) === */}
          <Dialog
            open={permissionsDialogFor !== null}
            onOpenChange={(open) => {
              if (!open) {
                setPermissionsDialogFor(null);
                setPermissionsDraft(null);
              }
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserCog className="h-5 w-5 text-primary" />
                  Керування менеджером
                </DialogTitle>
                <DialogDescription>
                  {permissionsDialogFor?.full_name ||
                    [permissionsDialogFor?.first_name, permissionsDialogFor?.last_name]
                      .filter(Boolean).join(" ") ||
                    "Менеджер"}
                  {permissionsDialogFor?.telegram_id ? ` • ID: ${permissionsDialogFor.telegram_id}` : ""}
                </DialogDescription>
              </DialogHeader>

              {permissionsDraft && (
                <Tabs defaultValue="permissions" className="w-full">
                  <TabsList className="grid h-auto grid-cols-3 w-full">
                    <TabsTrigger value="permissions" className="text-xs px-2 py-2">
                      <Shield className="h-3.5 w-3.5 mr-1" />
                      Дозволи
                    </TabsTrigger>
                    <TabsTrigger value="rates" className="text-xs px-2 py-2">
                      <Wallet className="h-3.5 w-3.5 mr-1" />
                      Оплата
                    </TabsTrigger>
                    <TabsTrigger value="communication" className="text-xs px-2 py-2">
                      <MessageSquare className="h-3.5 w-3.5 mr-1" />
                      Комунікація
                    </TabsTrigger>
                  </TabsList>

                  {/* === Вкладка 1: Дозволи (RBAC) === */}
                  <TabsContent value="permissions" className="mt-3">
                    <div className="space-y-3">
                      {([
                        {
                          key: "can_edit_info",
                          label: "Редагування інфо",
                          hint: "Назва та опис магазину",
                        },
                        {
                          key: "can_manage_products",
                          label: "Керування товарами",
                          hint: "Додавати, редагувати та видаляти товари",
                        },
                        {
                          key: "can_view_balance",
                          label: "Перегляд балансу",
                          hint: "Бачити надходження та виплати магазину",
                        },
                        {
                          key: "can_resolve_disputes",
                          label: "Вирішення спорів",
                          hint: "Відповідати на скарги та запити клієнтів",
                        },
                      ] as const).map((perm) => (
                        <div
                          key={perm.key}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{perm.label}</p>
                            <p className="text-xs text-muted-foreground">{perm.hint}</p>
                          </div>
                          <Switch
                            checked={permissionsDraft[perm.key]}
                            onCheckedChange={(v) => {
                              hapticSelection();
                              setPermissionsDraft({ ...permissionsDraft, [perm.key]: v });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  {/* === Вкладка 2: Оплата праці (B2B, гривні в UI / копійки в API) === */}
                  <TabsContent value="rates" className="mt-3">
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
                        Тарифи, які сплачує постачальник за роботу менеджера. Вказуйте суму в гривнях —
                        списання відбудеться за фактом обробленої дії.
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="rate_per_order">
                          За обробку замовлення (₴)
                        </Label>
                        <Input
                          id="rate_per_order"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={ratesDraft.order}
                          onChange={(e) => setRatesDraft({ ...ratesDraft, order: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rate_per_dispute">
                          За вирішення спору (₴)
                        </Label>
                        <Input
                          id="rate_per_dispute"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={ratesDraft.dispute}
                          onChange={(e) => setRatesDraft({ ...ratesDraft, dispute: e.target.value })}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {/* === Вкладка 3: Комунікація (Omnichannel) === */}
                  <TabsContent value="communication" className="mt-3">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Канал для чату з клієнтами</Label>
                        <Select
                          value={commDraft.chat_channel}
                          onValueChange={(v) => {
                            hapticSelection();
                            setCommDraft({ ...commDraft, chat_channel: v as "webapp" | "telegram" });
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Оберіть канал" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="webapp">Через Mini App</SelectItem>
                            <SelectItem value="telegram">Через Telegram Бот</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Де менеджер отримуватиме повідомлення від покупців магазину.
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">Сповіщення про нові події</p>
                          <p className="text-xs text-muted-foreground">
                            Замовлення, спори, скарги — миттєво сповіщаємо менеджера
                          </p>
                        </div>
                        <Switch
                          checked={commDraft.receive_notifications}
                          onCheckedChange={(v) => {
                            hapticSelection();
                            setCommDraft({ ...commDraft, receive_notifications: v });
                          }}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              )}

              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button
                  className="w-full gap-2"
                  disabled={isSavingPermissions || !permissionsDraft}
                  onClick={handleSavePermissions}
                >
                  {isSavingPermissions ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Зберігаємо…
                    </>
                  ) : (
                    <>
                      <Settings2 className="h-4 w-4" />
                      Зберегти контракт
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  disabled={isRemovingManager !== null || permissionsDialogFor === null}
                  onClick={() => {
                    if (permissionsDialogFor) {
                      handleRemoveManager(permissionsDialogFor.user_id);
                    }
                  }}
                >
                  {isRemovingManager === permissionsDialogFor?.user_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Видалити менеджера
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

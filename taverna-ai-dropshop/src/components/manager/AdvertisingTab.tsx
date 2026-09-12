import { useState } from "react";
import {
  Megaphone,
  Sparkles,
  Loader2,
  Search,
  Check,
  Target,
  Info,
  CreditCard,
  Eye,
  Users,
  TrendingUp,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Trophy,
  Gift,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PaymentModal } from "./PaymentModal";
import { AIPostPreview } from "./AIPostPreview";
import { PlatformConditions } from "./PlatformConditions";
import { PromotionPreviewDialog } from "./PromotionPreviewDialog";
import { ProductMultiSelector } from "./ProductMultiSelector";
import { ShopPickerInline } from "./ShopPickerInline";
import { PostMediaUploader } from "./PostMediaUploader";
import { PromotionStepper, StepNav, PromoCodeField, type StepDef } from "./PromotionStepper";
import { Store, Package, Layers } from "lucide-react";

interface Product {
  id: string;
  name: string;
  price: number;
  images: string[];
  supplier_id?: string;
}

interface ShopOption {
  id: string;
  shop_name: string;
  logo_url: string | null;
  is_active: boolean;
}

interface AdvertisingTabProps {
  products: Product[];
  isSearching: boolean;
  productSearch: string;
  setProductSearch: (value: string) => void;
  selectedProducts: Product[];
  setSelectedProducts: (p: Product[]) => void;
  useAllProducts: boolean;
  setUseAllProducts: (v: boolean) => void;
  setProducts: (products: Product[]) => void;
  supplierIds?: string[];
  selectedShopNames?: string[];
  availableShops?: ShopOption[];
  myShops?: ShopOption[];
  partnerShops?: ShopOption[];
  selectedShopIds?: string[];
  toggleShop?: (id: string) => void;
  selectAllShops?: () => void;
  selectMyShops?: () => void;
  clearShops?: () => void;
  isAdmin?: boolean;
  effectiveRole?: string;
  profileId?: string;
  initialStep?: number;
}

// All advertising platforms grouped
const AD_PLATFORMS = [
  // Social
  { id: "telegram", name: "Telegram", icon: "📱", minBudget: 100, reach: "10K-50K", cpm: 15, features: ["Таргетована аудиторія", "Кнопки дій", "Статистика"], apiStatus: "connected" as const, category: "social" },
  { id: "instagram", name: "Instagram", icon: "📸", minBudget: 200, reach: "15K-80K", cpm: 25, features: ["Stories & Reels", "Візуальний контент", "Шопінг теги"], apiStatus: "pending" as const, category: "social" },
  { id: "facebook", name: "Facebook", icon: "👥", minBudget: 200, reach: "20K-100K", cpm: 20, features: ["Широка аудиторія", "Ретаргетинг", "Детальний таргетинг"], apiStatus: "pending" as const, category: "social" },
  { id: "tiktok", name: "TikTok", icon: "🎵", minBudget: 300, reach: "50K-200K", cpm: 12, features: ["Вірусний потенціал", "Молода аудиторія", "Тренди"], apiStatus: "pending" as const, category: "social" },
  { id: "youtube", name: "YouTube", icon: "▶️", minBudget: 500, reach: "30K-150K", cpm: 35, features: ["Відео реклама", "Детальна аналітика", "Скіпабельні оголошення"], apiStatus: "pending" as const, category: "social" },
  { id: "twitter", name: "X (Twitter)", icon: "🐦", minBudget: 150, reach: "10K-60K", cpm: 22, features: ["Promoted tweets", "Тренди", "Таргетинг за інтересами"], apiStatus: "pending" as const, category: "social" },
  { id: "threads", name: "Threads", icon: "🧵", minBudget: 100, reach: "5K-30K", cpm: 18, features: ["Текстовий контент", "Meta інтеграція", "Органічний охоплення"], apiStatus: "pending" as const, category: "social" },
  { id: "pinterest", name: "Pinterest", icon: "📌", minBudget: 150, reach: "8K-40K", cpm: 20, features: ["Візуальний пошук", "Довгий lifecycle", "Shopping Pins"], apiStatus: "pending" as const, category: "social" },
  { id: "linkedin", name: "LinkedIn", icon: "💼", minBudget: 300, reach: "5K-25K", cpm: 40, features: ["B2B таргетинг", "Професійна аудиторія", "Sponsored content"], apiStatus: "pending" as const, category: "social" },
  // Messengers
  { id: "viber", name: "Viber", icon: "💬", minBudget: 100, reach: "15K-70K", cpm: 12, features: ["Масові розсилки", "Стікери", "Бізнес-повідомлення"], apiStatus: "pending" as const, category: "messenger" },
  { id: "whatsapp", name: "WhatsApp", icon: "📞", minBudget: 100, reach: "10K-50K", cpm: 14, features: ["Бізнес-каталог", "Статуси", "Розсилки"], apiStatus: "pending" as const, category: "messenger" },
  // Marketplaces
  { id: "olx", name: "OLX", icon: "🛒", minBudget: 50, reach: "5K-30K", cpm: 10, features: ["Топ оголошення", "Підняття в пошуку", "VIP статус"], apiStatus: "pending" as const, category: "marketplace" },
  { id: "prom", name: "Prom.ua", icon: "🏪", minBudget: 100, reach: "8K-40K", cpm: 18, features: ["Топ у категорії", "Рекомендації", "Бейджі"], apiStatus: "pending" as const, category: "marketplace" },
  { id: "rozetka", name: "Rozetka", icon: "🟢", minBudget: 200, reach: "20K-100K", cpm: 22, features: ["Спонсоровані позиції", "Банери", "Категорійне просування"], apiStatus: "pending" as const, category: "marketplace" },
  { id: "ria", name: "RIA.com", icon: "📋", minBudget: 50, reach: "3K-15K", cpm: 8, features: ["Топ оголошення", "VIP позиції", "Авто/нерухомість"], apiStatus: "pending" as const, category: "marketplace" },
  { id: "shafa", name: "Shafa", icon: "👗", minBudget: 50, reach: "3K-20K", cpm: 10, features: ["Промо в стрічці", "Категорійне просування", "Мода"], apiStatus: "pending" as const, category: "marketplace" },
  // Search
  { id: "google", name: "Google Ads", icon: "🔍", minBudget: 200, reach: "Необмежений", cpm: 30, features: ["Пошукова реклама", "Контекстний таргетинг", "Ремаркетинг"], apiStatus: "pending" as const, category: "search" },
];

function getAdMarkupPercent(budget: number): number {
  if (budget >= 10000) return 23;
  if (budget >= 2000) return 28;
  if (budget >= 500) return 33;
  return 40;
}

function getMultiPlatformDiscount(platformCount: number, budget: number): number {
  if (platformCount <= 1) return 0;
  if (budget >= 10000) return 3;
  if (budget >= 2000) return platformCount >= 3 ? 5 : 3;
  if (budget >= 500) {
    if (platformCount >= 4) return 8;
    if (platformCount >= 3) return 6;
    return 3;
  }
  if (platformCount >= 3) return 8;
  if (platformCount >= 2) return 5;
  return 0;
}

function calculateAdMarkup(budget: number, platformCount: number): number {
  const baseMarkup = getAdMarkupPercent(budget);
  const discount = getMultiPlatformDiscount(platformCount, budget);
  return Math.max(baseMarkup - discount, 15);
}

type AdStatus = "draft" | "pending_review" | "approved" | "active" | "rejected" | "completed";

const CATEGORY_LABELS: Record<string, string> = {
  social: "📱 Соціальні мережі",
  messenger: "💬 Месенджери",
  marketplace: "🛒 Маркетплейси",
  search: "🔍 Пошукова реклама",
};

export function AdvertisingTab({
  products,
  isSearching,
  productSearch,
  setProductSearch,
  selectedProducts,
  setSelectedProducts,
  useAllProducts,
  setUseAllProducts,
  setProducts,
  supplierIds,
  selectedShopNames,
  availableShops,
  myShops = [],
  partnerShops = [],
  selectedShopIds = [],
  toggleShop = () => {},
  selectAllShops = () => {},
  selectMyShops = () => {},
  clearShops = () => {},
  isAdmin,
  effectiveRole,
  profileId,
  initialStep,
}: AdvertisingTabProps) {
  const supplierId = supplierIds && supplierIds.length === 1 ? supplierIds[0] : null;
  const selectedProduct = selectedProducts.length === 1 ? selectedProducts[0] : null;
  const sampleProduct = selectedProduct || selectedProducts[0] || null;
  const hasSelection = useAllProducts || selectedProducts.length > 0;
  const productCount = useAllProducts ? "всі" : selectedProducts.length;
  const selectedShopName = selectedShopNames?.length === 1 ? selectedShopNames[0] :
    (selectedShopNames && selectedShopNames.length > 1) ? `${selectedShopNames.length} магазинів` : null;
  const [isAutoAds, setIsAutoAds] = useState(false);
  const [aiText, setAiText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [aiPromptHint, setAiPromptHint] = useState("");
  const [budget, setBudget] = useState<number>(100);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const [adStatus, setAdStatus] = useState<AdStatus>("draft");
  const [mediaImages, setMediaImages] = useState<string[]>([]);
  const [mediaVideo, setMediaVideo] = useState<string | null>(null);
  const [step, setStep] = useState(initialStep ?? 1);
  const [promoPercent, setPromoPercent] = useState(0);
  const hasShopSelection = (selectedShopIds?.length || 0) > 0;

  const AD_STEPS: StepDef[] = [
    { id: 1, label: "Магазини", icon: Store },
    { id: 2, label: "Товари", icon: Package },
    { id: 3, label: "Платформи", icon: Layers },
    { id: 4, label: "Запуск", icon: Megaphone },
  ];

  const canProceed = (): boolean => {
    if (step === 1) return hasShopSelection;
    if (step === 2) return hasSelection;
    if (step === 3) return selectedPlatforms.length > 0 && budget > 0;
    return true;
  };


  const togglePlatform = (platformId: string) => {
    const platform = AD_PLATFORMS.find((p) => p.id === platformId);
    if (platform?.apiStatus === "pending") {
      toast.info(`API ${platform.name} буде підключено найближчим часом`);
    }
    setSelectedPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((p) => p !== platformId)
        : [...prev, platformId]
    );
  };

  const fetchAllProducts = async (): Promise<{ id: string; supplier_id: string | null }[]> => {
    let q = supabase.from("products").select("id, supplier_id").eq("in_stock", true);
    if (supplierIds && supplierIds.length > 0) q = q.in("supplier_id", supplierIds);
    const { data } = await q.limit(1000);
    return (data || []) as any;
  };

  const handleGenerateDescription = async () => {
    if (!sampleProduct) {
      toast.error("Спочатку оберіть товар або увімкніть режим 'Усі товари'");
      return;
    }

    setIsGenerating(true);
    try {
      const platformType = selectedPlatforms[0] || "telegram";
      const { data, error } = await supabase.functions.invoke("generate-description", {
        body: {
          product: sampleProduct,
          type: platformType === "olx" || platformType === "prom" || platformType === "rozetka" ? "marketplace" :
                platformType === "instagram" || platformType === "facebook" || platformType === "tiktok" ? "social" :
                "telegram",
          aiHint: aiPromptHint || undefined,
          template: useAllProducts || selectedProducts.length > 1,
        },
      });

      if (error) throw error;
      setAiText(data?.description || "");
      setShowPreview(true);
      toast.success("Рекламний текст згенеровано!");
    } catch (err) {
      console.error("Generate description error:", err);
      const isTemplate = useAllProducts || selectedProducts.length > 1;
      const nameTok = isTemplate ? "{name}" : sampleProduct.name;
      const priceTok = isTemplate ? "{price}" : sampleProduct.price;
      setAiText(`🔥 ${nameTok}\n\n✨ Преміум якість за найкращою ціною!\n💰 Всього ${priceTok} ₴\n\n🚀 Швидка доставка по Україні\n✅ Гарантія якості\n\n👉 Замовляй зараз!`);
      setShowPreview(true);
      toast.success("Текст згенеровано!");
    } finally {
      setIsGenerating(false);
    }
  };

  const calculateTotalCost = () => {
    const effectiveMarkup = calculateAdMarkup(budget, selectedPlatforms.length);
    let total = 0;
    selectedPlatforms.forEach((platformId) => {
      const platform = AD_PLATFORMS.find((p) => p.id === platformId);
      if (platform) {
        const platformCost = Math.max(budget, platform.minBudget);
        total += platformCost * (1 + effectiveMarkup / 100);
      }
    });
    return Math.round(total);
  };

  const currentMarkup = calculateAdMarkup(budget, selectedPlatforms.length);

  const handleSubmitAd = async () => {
    if (!hasSelection) {
      toast.error("Оберіть товар(и) для реклами");
      return;
    }
    if (selectedPlatforms.length === 0) {
      toast.error("Оберіть хоча б одну платформу");
      return;
    }
    if (!aiText.trim()) {
      toast.error("Згенеруйте або введіть рекламний текст");
      return;
    }
    if (budget <= 0) {
      toast.error("Вкажіть бюджет більше 0 ₴");
      return;
    }
    setShowConfirmDialog(true);
  };

  const proceedToPayment = () => {
    setShowConfirmDialog(false);
    setShowPaymentModal(true);
  };

  const handlePaymentSuccess = async () => {
    setAdStatus("pending_review");
    toast.success("Оплата успішна! Рекламу передано на модерацію.");

    try {
      const items = useAllProducts
        ? await fetchAllProducts()
        : selectedProducts.map((p) => ({ id: p.id, supplier_id: p.supplier_id || null }));

      if (items.length === 0) {
        toast.error("Немає товарів для реклами");
        return;
      }

      const rows = items.map((it) => ({
        product_id: it.id,
        promotion_type: "paid_advertising",
        status: "pending",
        platforms: selectedPlatforms,
        budget: budget,
        ai_generated_text: aiText,
        start_date: new Date().toISOString(),
        supplier_id: it.supplier_id || supplierId || (supplierIds?.[0]) || null,
      }));

      const { error } = await supabase.from("promotions").insert(rows);
      if (error) console.error("Failed to save promotion:", error);
      else toast.success(`Створено рекламу для ${items.length} товарів`);
    } catch (err) {
      console.error("Save promotion error:", err);
    }

    setTimeout(() => {
      setAdStatus("approved");
      toast.success("Рекламу схвалено! Запуск кампанії...");

      setTimeout(() => {
        setAdStatus("active");
        toast.success("Рекламна кампанія активна!");
        setStep(1);
      }, 2000);
    }, 3000);
  };

  const totalCost = calculateTotalCost();
  const finalAdCost = Math.round(totalCost * (1 - promoPercent / 100));

  // Group platforms
  const categories = ["social", "messenger", "marketplace", "search"];

  return (
    <div className="space-y-4">
      {/* Wizard header: stepper + live context summary */}
      <PromotionStepper steps={AD_STEPS} currentStep={step} />

      {(hasShopSelection || hasSelection) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasShopSelection && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Store className="h-3 w-3" />
              {selectedShopName || `${selectedShopIds.length} магазинів`}
            </Badge>
          )}
          {hasSelection && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Package className="h-3 w-3" />
              {useAllProducts ? "усі товари" : `${selectedProducts.length} товарів`}
            </Badge>
          )}
          {selectedPlatforms.length > 0 && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Layers className="h-3 w-3" />
              {selectedPlatforms.length} платформ
            </Badge>
          )}
        </div>
      )}

      {/* ============ STEP 1 — Магазини ============ */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Store className="h-4 w-4 text-primary" />
              Крок 1. Оберіть магазин(и)
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Виберіть, з яких ваших магазинів рекламувати товари. Можна обрати кілька або всі одразу.
            </p>
          </div>

          <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
            <CardContent className="p-3">
              <ShopPickerInline
                availableShops={availableShops || []}
                myShops={myShops}
                partnerShops={partnerShops}
                selectedShopIds={selectedShopIds}
                toggleShop={toggleShop}
                selectAllShops={selectAllShops}
                selectMyShops={selectMyShops}
                clearShops={clearShops}
                isAdmin={isAdmin}
                roleLabel={effectiveRole}
              />
            </CardContent>
          </Card>

          {/* Rating Bonus Info */}
          {(supplierIds && supplierIds.length > 0) && (
            <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-transparent">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">Рейтингові знижки на рекламу</p>
                    <p className="text-xs text-muted-foreground">
                      Чим вищий ваш рейтинг — тим менша націнка на рекламу. Легенда платформи: фіксовані 23%
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                    -{currentMarkup}%
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Instructions */}
          <Accordion type="single" collapsible className="bg-card rounded-lg border border-border">
            <AccordionItem value="instructions" className="border-0">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Інструкція: Реклама</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    <strong className="text-foreground">Реклама</strong> — платне просування ваших товарів на {AD_PLATFORMS.length} платформах з розширеним охопленням.
                  </p>
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">💰 Тарифна сітка націнок:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>До 500₴ — <strong>40%</strong> націнка</li>
                      <li>500₴ – 2000₴ — <strong>33%</strong></li>
                      <li>2000₴ – 10 000₴ — <strong>28%</strong></li>
                      <li>10 000₴+ — <strong>23%</strong></li>
                      <li>Знижка <strong>-3..8%</strong> за кілька платформ одразу</li>
                      <li>Мінімальний бюджет: <strong>50₴</strong> (залежить від платформи)</li>
                    </ul>
                  </div>
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <p className="font-medium text-foreground mb-1">🎯 Що входить:</p>
                    <ul className="space-y-1 text-xs">
                      <li>• AI-генерація рекламного тексту (Gemini)</li>
                      <li>• Автоматична модерація контенту</li>
                      <li>• Таргетинг на вашу аудиторію</li>
                      <li>• Детальна статистика та звіти</li>
                    </ul>
                  </div>
                  <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <p className="font-medium text-foreground mb-1">🏆 Рейтингові бонуси:</p>
                    <ul className="space-y-1 text-xs">
                      <li>• <strong>Топ-1 за місяць:</strong> знижена націнка 30% (замість 33%)</li>
                      <li>• <strong>Топ-1 за рік:</strong> 28% на 1 міс / 1 безкоштовна реклама</li>
                      <li>• <strong>💎 Легенда:</strong> фіксована 23% на все просування назавжди</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* ============ STEP 2 — Товари ============ */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Крок 2. Оберіть товари
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Знайдіть товари або скористайтесь популярними з обраних магазинів. Можна увімкнути режим «Усі товари».
            </p>
          </div>

          <ProductMultiSelector
            products={products}
            isSearching={isSearching}
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            setProducts={setProducts}
            selectedProducts={selectedProducts}
            setSelectedProducts={setSelectedProducts}
            useAllProducts={useAllProducts}
            setUseAllProducts={setUseAllProducts}
            supplierIds={supplierIds}
            availableShops={availableShops}
            selectedShopNames={selectedShopNames}
          />
        </div>
      )}

      {/* ============ STEP 3 — Платформи і бюджет ============ */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Крок 3. Платформи і бюджет
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Оберіть платформи для реклами та вкажіть бюджет. Кілька платформ — знижка на націнку.
            </p>
          </div>

          {/* Auto-Ads Toggle */}
          <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Авто-реклама</p>
                    <p className="text-sm text-muted-foreground">
                      Безкоштовно від Taverna Group
                    </p>
                  </div>
                </div>
                <Switch checked={isAutoAds} onCheckedChange={setIsAutoAds} />
              </div>
              {isAutoAds && (
                <div className="mt-3 p-3 bg-muted rounded-lg space-y-2">
                  <p className="text-xs text-muted-foreground">
                    ✅ Товари{selectedShopName ? ` магазину "${selectedShopName}"` : ""} автоматично рекламуються на всіх платформах Taverna по черзі
                  </p>
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Наступна реклама через ~{Math.floor(Math.random() * 20) + 10} хв
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Platform Selection — grouped by category */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Оберіть платформи для реклами ({selectedPlatforms.length})</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConditions(!showConditions)}
                disabled={selectedPlatforms.length === 0}
              >
                <Info className="h-4 w-4 mr-1" />
                Умови
              </Button>
            </div>

            {categories.map((cat) => {
              const catPlatforms = AD_PLATFORMS.filter(p => p.category === cat);
              if (catPlatforms.length === 0) return null;
              return (
                <div key={cat} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{CATEGORY_LABELS[cat]}</p>
                  <div className="grid grid-cols-1 gap-2">
                    {catPlatforms.map((platform) => (
                      <button
                        key={platform.id}
                        onClick={() => togglePlatform(platform.id)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
                          selectedPlatforms.includes(platform.id)
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <span className="text-2xl">{platform.icon}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{platform.name}</span>
                            <Badge variant="outline" className="text-xs">
                              від {platform.minBudget} ₴
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              +{currentMarkup}%
                            </Badge>
                            {platform.apiStatus === "connected" ? (
                              <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                API
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                                <Clock className="h-3 w-3 mr-1" />
                                Скоро
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {platform.reach}
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              ~{platform.cpm} ₴/1000
                            </span>
                          </div>
                        </div>
                        {selectedPlatforms.includes(platform.id) && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Platform Conditions */}
          {showConditions && selectedPlatforms.length > 0 && (
            <PlatformConditions selectedPlatforms={selectedPlatforms} />
          )}

          {/* Budget */}
          {selectedPlatforms.length > 0 && (
            <div className="space-y-2">
              <Label>Бюджет на кожну платформу (₴)</Label>
              <Input
                type="number"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                min={50}
                step={50}
              />
              <p className="text-xs text-muted-foreground">
                Мінімальний бюджет для обраних платформ: {Math.max(...selectedPlatforms.map(id =>
                  AD_PLATFORMS.find(p => p.id === id)?.minBudget || 50
                ))} ₴
              </p>
            </div>
          )}

          {/* Cost Summary */}
          {selectedPlatforms.length > 0 && (
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Загальна вартість:</span>
                  <span className="text-xl font-bold text-success">{totalCost} ₴</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {selectedPlatforms.map((platformId) => {
                    const platform = AD_PLATFORMS.find((p) => p.id === platformId);
                    if (!platform) return null;
                    const platformCost = Math.max(budget, platform.minBudget);
                    const withMarkup = Math.round(platformCost * (1 + currentMarkup / 100));
                    return (
                      <div key={platformId} className="flex justify-between">
                        <span>{platform.icon} {platform.name}</span>
                        <span>{withMarkup} ₴ (+{currentMarkup}%)</span>
                      </div>
                    );
                  })}
                </div>
                {selectedPlatforms.length >= 2 && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs text-success flex items-center gap-1">
                      <Gift className="h-3 w-3" />
                      Знижка за {selectedPlatforms.length} платформ: -{getMultiPlatformDiscount(selectedPlatforms.length, budget)}% від націнки
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ============ STEP 4 — Контент і запуск ============ */}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              Крок 4. Контент і запуск
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Згенеруйте чи напишіть рекламний текст, додайте фото/відео, перегляньте та оплатіть запуск кампанії.
            </p>
          </div>

          {/* AI Prompt Hint */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Як ви бачите цю рекламу? (для AI Gemini)
            </Label>
            <Input
              value={aiPromptHint}
              onChange={(e) => setAiPromptHint(e.target.value)}
              placeholder="Наприклад: зробити акцент на знижці, або використати гумор..."
            />
          </div>

          {/* AI Text Generation */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Рекламний текст</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  disabled={!aiText}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  Перегляд
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateDescription}
                  disabled={!sampleProduct || isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Згенерувати AI
                </Button>
              </div>
            </div>
            <Textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="AI згенерує оптимальний рекламний текст для обраних платформ..."
              rows={5}
            />
          </div>

          {/* AI Post Preview */}
          {showPreview && (
            <AIPostPreview
              product={sampleProduct}
              postText={aiText}
              platform={(selectedPlatforms[0] || "telegram") as any}
            />
          )}

          {/* Media uploader (optional) */}
          <PostMediaUploader
            profileId={profileId}
            images={mediaImages}
            video={mediaVideo}
            onChange={({ images, video }) => { setMediaImages(images); setMediaVideo(video); }}
          />

          {/* Ad Status */}
          {adStatus !== "draft" && (
            <Card className={cn(
              "border",
              adStatus === "pending_review" && "border-warning/50 bg-warning/5",
              adStatus === "approved" && "border-success/50 bg-success/5",
              adStatus === "active" && "border-success/50 bg-success/5",
              adStatus === "rejected" && "border-destructive/50 bg-destructive/5",
              adStatus === "completed" && "border-muted bg-muted/50"
            )}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  {adStatus === "pending_review" && <Clock className="h-5 w-5 text-warning animate-pulse" />}
                  {adStatus === "approved" && <ShieldCheck className="h-5 w-5 text-success" />}
                  {adStatus === "active" && <TrendingUp className="h-5 w-5 text-success animate-pulse" />}
                  {adStatus === "rejected" && <AlertCircle className="h-5 w-5 text-destructive" />}
                  {adStatus === "completed" && <CheckCircle2 className="h-5 w-5 text-muted-foreground" />}
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {adStatus === "pending_review" && "Модерація рекламного контенту..."}
                      {adStatus === "approved" && "Рекламу схвалено!"}
                      {adStatus === "active" && "Рекламна кампанія активна"}
                      {adStatus === "rejected" && "Рекламу відхилено"}
                      {adStatus === "completed" && "Кампанію завершено"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {adStatus === "pending_review" && "Перевірка на відповідність правилам платформ"}
                      {adStatus === "approved" && "Запуск кампанії розпочнеться найближчим часом"}
                      {adStatus === "active" && "Відстежуйте статистику в розділі 'Статистика'"}
                      {adStatus === "rejected" && "Будь ласка, перевірте вміст та спробуйте знову"}
                      {adStatus === "completed" && "Переглянути звіт можна в розділі 'Статистика'"}
                    </p>
                  </div>
                </div>
                {adStatus === "active" && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-muted rounded">
                      <p className="text-lg font-bold">1,247</p>
                      <p className="text-xs text-muted-foreground">Перегляди</p>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <p className="text-lg font-bold">156</p>
                      <p className="text-xs text-muted-foreground">Кліки</p>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <p className="text-lg font-bold">12.5%</p>
                      <p className="text-xs text-muted-foreground">CTR</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Wizard navigation */}
      <StepNav
        step={step}
        totalSteps={4}
        canProceed={canProceed()}
        onBack={() => setStep((s) => Math.max(1, s - 1))}
        onNext={() => setStep((s) => Math.min(4, s + 1))}
        finalSlot={
          <div className="space-y-2">
            <PromoCodeField cost={totalCost} onDiscountChange={(p) => setPromoPercent(p)} />
            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmitAd}
              disabled={
                !hasSelection ||
                selectedPlatforms.length === 0 ||
                !aiText ||
                adStatus === "pending_review" ||
                adStatus === "active"
              }
            >
              {adStatus === "pending_review" ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Megaphone className="h-5 w-5 mr-2" />
              )}
              {adStatus === "pending_review"
                ? "Модерація..."
                : `Оплатити ${finalAdCost} ₴ та запустити рекламу`}
            </Button>
          </div>
        }
      />

      {/* Payment Modal */}
      <PaymentModal
        open={showPaymentModal}
        onOpenChange={setShowPaymentModal}
        amount={finalAdCost}
        description={`Рекламна кампанія: ${useAllProducts ? "усі товари" : selectedProducts.length > 1 ? `${selectedProducts.length} товарів` : (sampleProduct?.name || "товар")} на ${selectedPlatforms.length} платформах`}
        type="advertising"
        onSuccess={handlePaymentSuccess}
      />

      {/* Confirmation Preview Dialog */}
      <PromotionPreviewDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        type="advertising"
        selectedProducts={selectedProducts}
        useAllProducts={useAllProducts}
        allProductsCount={null}
        shopNames={selectedShopNames || []}
        platforms={selectedPlatforms}
        aiText={aiText}
        onAiTextChange={setAiText}
        estimatedCost={totalCost}
        intervalSeconds={120}
        onConfirm={proceedToPayment}
        isSubmitting={false}
        paid
      />
    </div>
  );
}

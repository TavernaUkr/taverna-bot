import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, Package, TrendingUp, Megaphone, Zap, Eye, MousePointer,
  ShoppingCart, Clock, CheckCircle, XCircle, PlayCircle, PauseCircle,
  Shuffle, Globe, ChevronRight, Loader2, Plus, Sparkles, Send, Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SupplierSettings } from "@/components/supplier/SupplierSettings";
import { SupplierOrders } from "@/components/supplier/SupplierOrders";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { hapticSelection } from "@/lib/haptics";

interface Product {
  id: string;
  name: string;
  price: number;
  images?: string[];
  in_stock?: boolean;
}

interface Platform {
  id: string;
  name: string;
  icon: string;
  is_active: boolean;
  description?: string;
  cost_per_promotion?: number;
}

interface Promotion {
  id: string;
  product_id: string;
  product?: Product;
  promotion_type: "post" | "ad" | "auto";
  status: string;
  platforms: string[];
  budget: number;
  spent: number;
  views: number;
  clicks: number;
  orders: number;
  start_date: string;
  end_date?: string;
}

interface QueuePosition {
  position: number;
  total_promotions: number;
  last_promoted_at?: string;
}

export default function SupplierDashboard() {
  const navigate = useNavigate();
  const { profile } = useTelegramAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [products, setProducts] = useState<Product[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [queuePosition, setQueuePosition] = useState<QueuePosition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentSupplierId, setCurrentSupplierId] = useState<string | null>(null);
  
  // New promotion dialog state
  const [isNewPromoOpen, setIsNewPromoOpen] = useState(false);
  const [promoType, setPromoType] = useState<"post" | "ad">("post");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isRandom, setIsRandom] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      let foundSupplierId: string | null = null;
      
      if (profile?.telegram_id) {
        const { data: linkedSupplier } = await supabase
          .from("suppliers")
          .select("id")
          .eq("telegram_id", profile.telegram_id)
          .limit(1);
        
        foundSupplierId = linkedSupplier?.[0]?.id || null;
      }
      
      if (!foundSupplierId) {
        const { data: fallback } = await supabase
          .from("suppliers")
          .select("id")
          .eq("is_active", true)
          .limit(1);
        foundSupplierId = fallback?.[0]?.id || null;
      }
      
      setCurrentSupplierId(foundSupplierId);
      
      let productsQuery = supabase
        .from("products")
        .select("id, name, price, images, in_stock");
      
      if (foundSupplierId) {
        productsQuery = productsQuery.eq("supplier_id", foundSupplierId);
      }
      
      const { data: productsData } = await productsQuery.limit(50);

      // Fetch platforms
      const { data: platformsData } = await supabase
        .from("promotion_platforms")
        .select("*")
        .eq("is_active", true);

      // Fetch promotions
      const { data: promotionsData } = await supabase
        .from("promotions")
        .select(`
          *,
          product:products(id, name, price, images)
        `)
        .order("created_at", { ascending: false })
        .limit(20);

      if (productsData) setProducts(productsData);
      if (platformsData) setPlatforms(platformsData);
      if (promotionsData) setPromotions(promotionsData as Promotion[]);

      // Mock queue position
      setQueuePosition({
        position: 3,
        total_promotions: 5,
        last_promoted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      });
    } catch (err) {
      console.error("Error fetching data:", err);
      toast.error("Помилка завантаження даних");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePromotion = async () => {
    if (!selectedProduct && !isRandom) {
      toast.error("Оберіть товар або увімкніть рандомний вибір");
      return;
    }

    if (promoType === "ad" && selectedPlatforms.length === 0) {
      toast.error("Оберіть хоча б одну платформу");
      return;
    }

    setIsSubmitting(true);
    try {
      // Get product ID (random if needed)
      let productId = selectedProduct;
      if (isRandom && products.length > 0) {
        const randomIndex = Math.floor(Math.random() * products.length);
        productId = products[randomIndex].id;
      }

      // Create promotion record
      const { error } = await supabase.from("promotions").insert({
        product_id: productId || null,
        promotion_type: promoType,
        platforms: promoType === "post" ? ["Telegram"] : selectedPlatforms,
        status: "pending",
        budget: 0,
      });

      if (error) throw error;

      // If it's a Telegram post, publish it
      if (promoType === "post" && productId) {
        toast.info("Публікуємо в Telegram...");
        
        const { data: publishResult, error: publishError } = await supabase.functions.invoke(
          "telegram-publish",
          {
            body: { product_id: productId },
          }
        );

        if (publishError) {
          console.error("Telegram publish error:", publishError);
          toast.error("Помилка публікації в Telegram");
        } else {
          toast.success("Пост опубліковано в Telegram каналі!");
        }
      } else {
        toast.success("Рекламну кампанію створено!");
      }

      setIsNewPromoOpen(false);
      setSelectedProduct("");
      setSelectedPlatforms([]);
      setIsRandom(false);
      fetchData();
    } catch (err) {
      console.error("Error creating promotion:", err);
      toast.error("Помилка створення просування");
    } finally {
      setIsSubmitting(false);
    }
  };

  const togglePlatform = (platformName: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platformName)
        ? prev.filter((p) => p !== platformName)
        : [...prev, platformName]
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-success text-success-foreground">Активна</Badge>;
      case "pending":
        return <Badge variant="secondary">Очікує</Badge>;
      case "completed":
        return <Badge variant="outline">Завершена</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Скасовано</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const stats = {
    totalProducts: products.length,
    activePromotions: promotions.filter((p) => p.status === "active").length,
    totalViews: promotions.reduce((sum, p) => sum + (p.views || 0), 0),
    totalOrders: promotions.reduce((sum, p) => sum + (p.orders || 0), 0),
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={() => navigate("/?tab=account")}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Кабінет постачальника</h1>
            <p className="text-sm text-muted-foreground">Управління товарами та рекламою</p>
          </div>
        </div>
      </div>

      <div className="p-4 pb-24">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.totalProducts}</p>
                  <p className="text-xs text-muted-foreground">Товарів</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <Megaphone className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.activePromotions}</p>
                  <p className="text-xs text-muted-foreground">Активних</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Eye className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.totalViews.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Переглядів</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                  <ShoppingCart className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">Замовлень</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Auto-Promotion Banner */}
        <Card className="mb-6 bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">
                  🎁 Безкоштовна авто-реклама від Taverna
                </h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Ваші товари автоматично рекламуються на різних платформах без оплати!
                </p>
                {queuePosition && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      Позиція в черзі: <strong>#{queuePosition.position}</strong>
                    </span>
                    <span className="text-muted-foreground">
                      Всього просувань: {queuePosition.total_promotions}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(value) => {
          hapticSelection();
          setActiveTab(value);
        }}>
          <TabsList className="w-full grid grid-cols-5 mb-4">
            <TabsTrigger value="overview">Огляд</TabsTrigger>
            <TabsTrigger value="orders">
              <Package className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Замовлення</span>
            </TabsTrigger>
            <TabsTrigger value="post">Пости</TabsTrigger>
            <TabsTrigger value="ads">Реклама</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1">
              <Settings className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <Dialog open={isNewPromoOpen} onOpenChange={setIsNewPromoOpen}>
                <DialogTrigger asChild>
                  <Button 
                    className="h-auto py-4 flex-col gap-2"
                    onClick={() => setPromoType("post")}
                  >
                    <Send className="h-6 w-6" />
                    <span>Просунути пост</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {promoType === "post" ? "Просування поста" : "Рекламна кампанія"}
                    </DialogTitle>
                    <DialogDescription>
                      {promoType === "post"
                        ? "Опублікуйте товар в Telegram каналі з кнопкою замовлення"
                        : "Розмістіть рекламу на вибраних платформах"}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    {/* Product Selection */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Товар</label>
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox
                          id="random"
                          checked={isRandom}
                          onCheckedChange={(checked) => setIsRandom(!!checked)}
                        />
                        <label htmlFor="random" className="text-sm flex items-center gap-1 cursor-pointer">
                          <Shuffle className="h-4 w-4" />
                          Рандомний вибір
                        </label>
                      </div>
                      {!isRandom && (
                        <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                          <SelectTrigger>
                            <SelectValue placeholder="Оберіть товар" />
                          </SelectTrigger>
                          <SelectContent>
                            <ScrollArea className="h-48">
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name} - {product.price} ₴
                                </SelectItem>
                              ))}
                            </ScrollArea>
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    {/* Platform Selection (for ads) */}
                    {promoType === "ad" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Платформи</label>
                        <div className="grid grid-cols-2 gap-2">
                          {platforms.map((platform) => (
                            <button
                              key={platform.id}
                              onClick={() => togglePlatform(platform.name)}
                              className={cn(
                                "flex items-center gap-2 p-3 rounded-lg border transition-all",
                                selectedPlatforms.includes(platform.name)
                                  ? "bg-primary/10 border-primary"
                                  : "bg-card border-border hover:border-primary/50"
                              )}
                            >
                              <span className="text-xl">{platform.icon}</span>
                              <span className="text-sm font-medium">{platform.name}</span>
                            </button>
                          ))}
                        </div>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <Checkbox
                            id="all-platforms"
                            checked={selectedPlatforms.length === platforms.length}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedPlatforms(platforms.map(p => p.name));
                              } else {
                                setSelectedPlatforms([]);
                              }
                            }}
                          />
                          <label htmlFor="all-platforms" className="text-sm cursor-pointer">
                            Обрати всі платформи
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsNewPromoOpen(false)}>
                      Скасувати
                    </Button>
                    <Button onClick={handleCreatePromotion} disabled={isSubmitting}>
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {promoType === "post" ? "Опублікувати" : "Запустити рекламу"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button 
                variant="secondary" 
                className="h-auto py-4 flex-col gap-2"
                onClick={() => {
                  setPromoType("ad");
                  setIsNewPromoOpen(true);
                }}
              >
                <Globe className="h-6 w-6" />
                <span>Запустити рекламу</span>
              </Button>
            </div>

            {/* Recent Promotions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Останні просування</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {promotions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Немає активних просувань
                  </p>
                ) : (
                  promotions.slice(0, 5).map((promo) => (
                    <div
                      key={promo.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                    >
                      {promo.product?.images?.[0] ? (
                        <img
                          src={promo.product.images[0]}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                          <Package className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {promo.product?.name || "Рандомний товар"}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{promo.promotion_type === "post" ? "📱 Пост" : "📢 Реклама"}</span>
                          <span>•</span>
                          <span>{promo.views} переглядів</span>
                        </div>
                      </div>
                      {getStatusBadge(promo.status)}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="post">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Просування постів
                </CardTitle>
                <CardDescription>
                  Публікуйте товари в Telegram каналі @taverna_ukr_group з кнопкою "Замовити"
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <h4 className="font-medium mb-2">Як це працює:</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>1. Оберіть товар для публікації</li>
                      <li>2. AI Gemini автоматично створить опис</li>
                      <li>3. Пост публікується в каналі з кнопкою замовлення</li>
                      <li>4. Клієнти переходять в Mini App для оформлення</li>
                    </ul>
                  </div>
                  
                  <Button 
                    className="w-full"
                    onClick={() => {
                      setPromoType("post");
                      setIsNewPromoOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Створити пост
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Post History */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Історія постів</CardTitle>
              </CardHeader>
              <CardContent>
                {promotions.filter(p => p.promotion_type === "post").length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Ще немає опублікованих постів
                  </p>
                ) : (
                  <div className="space-y-3">
                    {promotions
                      .filter(p => p.promotion_type === "post")
                      .map((promo) => (
                        <div key={promo.id} className="flex items-center gap-3 p-3 rounded-lg border">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{promo.product?.name || "Товар"}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" /> {promo.views}
                              </span>
                              <span className="flex items-center gap-1">
                                <MousePointer className="h-3 w-3" /> {promo.clicks}
                              </span>
                              <span className="flex items-center gap-1">
                                <ShoppingCart className="h-3 w-3" /> {promo.orders}
                              </span>
                            </div>
                          </div>
                          {getStatusBadge(promo.status)}
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ads">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Рекламні кампанії
                </CardTitle>
                <CardDescription>
                  Розміщуйте рекламу на OLX, Prom, Instagram, Facebook, TikTok та інших платформах
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Platforms Grid */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Доступні платформи:</h4>
                    <div className="flex flex-wrap gap-2">
                      {platforms.map((platform) => (
                        <Badge key={platform.id} variant="secondary" className="text-sm">
                          {platform.icon} {platform.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <Button 
                    className="w-full"
                    onClick={() => {
                      setPromoType("ad");
                      setIsNewPromoOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Створити рекламу
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Ads History */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Рекламні кампанії</CardTitle>
              </CardHeader>
              <CardContent>
                {promotions.filter(p => p.promotion_type === "ad").length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Ще немає рекламних кампаній
                  </p>
                ) : (
                  <div className="space-y-3">
                    {promotions
                      .filter(p => p.promotion_type === "ad")
                      .map((promo) => (
                        <div key={promo.id} className="p-3 rounded-lg border">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">{promo.product?.name || "Товар"}</p>
                            {getStatusBadge(promo.status)}
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {promo.platforms?.map((platform) => (
                              <Badge key={platform} variant="outline" className="text-xs">
                                {platforms.find(p => p.name === platform)?.icon} {platform}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" /> {promo.views}
                            </span>
                            <span className="flex items-center gap-1">
                              <MousePointer className="h-3 w-3" /> {promo.clicks}
                            </span>
                            <span className="flex items-center gap-1">
                              <ShoppingCart className="h-3 w-3" /> {promo.orders}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders">
            {currentSupplierId ? (
              <SupplierOrders supplierId={currentSupplierId} />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Магазин не прив'язано</p>
              </div>
            )}
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <SupplierSettings supplierId={currentSupplierId || undefined} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
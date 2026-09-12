import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Megaphone,
  Plus,
  Send,
  Clock,
  TrendingUp,
  Target,
  BarChart3,
  Eye,
  MousePointerClick,
  ShoppingCart,
  RefreshCw,
  Wand2,
  Image,
  Check,
  Store,
  Trophy,
  Gift,
  X,
  Search,
  ListOrdered,
  Shuffle,
  Pause,
  Play,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PostingTab } from "@/components/manager/PostingTab";
import { AdvertisingTab } from "@/components/manager/AdvertisingTab";
import { AutoQueueDialog } from "@/components/manager/AutoQueueDialog";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

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

interface PromotionalPost {
  id: string;
  product: Product | null;
  status: "draft" | "scheduled" | "published";
  aiText: string;
  scheduledAt?: Date;
  platforms: string[];
  type: "posting" | "advertising";
}

interface AutoQueueItem {
  id: string;
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
  is_paused: boolean;
  total_published: number;
  next_execution_at: string | null;
  created_at: string;
}

const platforms = [
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
  { id: "pinterest", name: "Pinterest", icon: "📌" },
  { id: "linkedin", name: "LinkedIn", icon: "💼" },
  { id: "threads", name: "Threads", icon: "🧵" },
  { id: "google", name: "Google Ads", icon: "🔍" },
];

export default function Manager() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deepLinkShopId = searchParams.get("shop");
  const deepLinkTab = searchParams.get("tab");
  const deepLinkStep = searchParams.get("step");
  const initialStep = deepLinkStep ? parseInt(deepLinkStep, 10) || undefined : undefined;
  const { profile, effectiveRole } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState(
    deepLinkTab === "advertising" ? "advertising" : "posting"
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  const [useAllProducts, setUseAllProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [promotionalPosts, setPromotionalPosts] = useState<PromotionalPost[]>([]);
  const [queueStats, setQueueStats] = useState({ pending: 0, active: 0 });

  // Multi-shop selection
  const [availableShops, setAvailableShops] = useState<ShopOption[]>([]);
  const [myShops, setMyShops] = useState<ShopOption[]>([]);
  const [partnerShops, setPartnerShops] = useState<ShopOption[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [shopSearchQuery, setShopSearchQuery] = useState("");
  const [shopSelectorOpen, setShopSelectorOpen] = useState(false);

  // Auto-queue
  const [autoQueues, setAutoQueues] = useState<AutoQueueItem[]>([]);
  const [queueSubTab, setQueueSubTab] = useState<"scheduled" | "auto">("scheduled");

  const isAdminOrMod = effectiveRole === "admin" || effectiveRole === "moderator";
  const isAdmin = effectiveRole === "admin";

  // Auto-queue dialog state
  const [autoQueueDialogOpen, setAutoQueueDialogOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<AutoQueueItem | null>(null);

  // Load auto-queues from Supabase + one-shot migration from localStorage
  const loadAutoQueues = async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from("user_auto_queues")
      .select("*")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load auto queues:", error);
      return;
    }
    setAutoQueues((data || []) as unknown as AutoQueueItem[]);
  };

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      // One-shot migration from localStorage
      const legacy = localStorage.getItem("taverna_auto_queues");
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const rows = parsed.map((q: any) => ({
              profile_id: profile.id,
              name: "Імпортована черга",
              type: q.type || "posting",
              mode: q.mode || "random",
              supplier_ids: q.shopIds || [],
              product_ids: q.productIds || [],
              interval_minutes: q.intervalMinutes || 60,
              platforms: q.platforms || ["telegram"],
              budget: 0,
              is_paused: !!q.isPaused,
            }));
            await supabase.from("user_auto_queues").insert(rows);
          }
        } catch {}
        localStorage.removeItem("taverna_auto_queues");
      }
      await loadAutoQueues();
    })();
  }, [profile?.id]);

  // Fetch available shops based on role
  useEffect(() => {
    const fetchShops = async () => {
      if (!profile?.id) return;
      // Skip DB calls that require a valid UUID profile.id in dev mode
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const profileIdIsUuid = uuidRe.test(profile.id);

      try {
        if (isAdminOrMod) {
          const { data: allShops } = await supabase
            .from("suppliers")
            .select("id, shop_name, logo_url, is_active")
            .eq("is_active", true)
            .order("shop_name");

          const shops = allShops || [];
          setAvailableShops(shops);

          if (isAdmin) {
            // Split: admin's own shops (telegram_id match or via shop_manager_links)
            const { data: adminOwnShops } = profile.telegram_id
              ? await supabase
                  .from("suppliers")
                  .select("id, shop_name, logo_url, is_active")
                  .eq("telegram_id", profile.telegram_id)
              : { data: [] as any[] };

            const { data: adminLinks } = profileIdIsUuid
              ? await supabase
                  .from("shop_manager_links")
                  .select("supplier_id")
                  .eq("profile_id", profile.id)
              : { data: [] as any[] };

            const adminLinkedIds = new Set(adminLinks?.map(l => l.supplier_id) || []);
            const adminOwnIds = new Set((adminOwnShops || []).map(s => s.id));

            const mySet = new Set<string>();
            adminOwnIds.forEach(id => mySet.add(id));
            adminLinkedIds.forEach(id => mySet.add(id));

            setMyShops(shops.filter(s => mySet.has(s.id)));
            setPartnerShops(shops.filter(s => !mySet.has(s.id)));
          } else {
            // Moderator — all are "platform shops"
            setMyShops([]);
            setPartnerShops(shops);
          }

          // Default: select all
          setSelectedShopIds(shops.map(s => s.id));
        } else {
          // Supplier: own shops via telegram_id
          const { data: ownShops } = profile.telegram_id
            ? await supabase
                .from("suppliers")
                .select("id, shop_name, logo_url, is_active")
                .eq("telegram_id", profile.telegram_id)
            : { data: [] as any[] };

          // Manager: linked shops
          const { data: links } = profileIdIsUuid
            ? await supabase
                .from("shop_manager_links")
                .select("supplier_id")
                .eq("profile_id", profile.id)
            : { data: [] as any[] };

          const linkedIds = links?.map(l => l.supplier_id) || [];
          let allShops = ownShops || [];

          if (linkedIds.length > 0) {
            const { data: linkedShops } = await supabase
              .from("suppliers")
              .select("id, shop_name, logo_url, is_active")
              .in("id", linkedIds);
            if (linkedShops) {
              const existingIds = new Set(allShops.map(s => s.id));
              linkedShops.forEach(s => {
                if (!existingIds.has(s.id)) allShops.push(s);
              });
            }
          }

          setAvailableShops(allShops);
          setMyShops(allShops);
          setPartnerShops([]);

          // Auto-select single shop if only one available; otherwise select all
          setSelectedShopIds(allShops.map(s => s.id));
        }
      } catch (err) {
        console.error("Error fetching shops:", err);
      }
    };
    fetchShops();
  }, [profile?.id, profile?.telegram_id, isAdminOrMod, isAdmin]);

  // Deep-link: pre-select a single shop when navigated from "Керування магазинами"
  useEffect(() => {
    if (!deepLinkShopId) return;
    if (availableShops.some((s) => s.id === deepLinkShopId)) {
      setSelectedShopIds([deepLinkShopId]);
    }
  }, [deepLinkShopId, availableShops]);

  // Derive supplierIds for child components.
  // For non-admin/mod: always restrict to availableShops, even when "all" selected,
  // so a supplier never accidentally promotes another shop's products.
  const supplierIds = (() => {
    if (selectedShopIds.length === 0) return [];
    if (isAdminOrMod && selectedShopIds.length === availableShops.length) {
      return []; // admin/mod "all" = no filter (cross-platform)
    }
    return selectedShopIds;
  })();

  // Update product selection when shops change
  useEffect(() => {
    setSelectedProducts([]);
    setUseAllProducts(false);
    setProductSearch("");
    setProducts([]);
  }, [selectedShopIds.join(",")]);

  // Fetch promotional posts from database
  useEffect(() => {
    const fetchPromotions = async () => {
      let query = supabase
        .from("promotions")
        .select("*, product:products(id, name, price, images)")
        .order("created_at", { ascending: false })
        .limit(20);

      if (supplierIds.length > 0) {
        query = query.in("supplier_id", supplierIds);
      }

      const { data, error } = await query;

      if (!error && data) {
        const posts: PromotionalPost[] = data.map((p) => ({
          id: p.id,
          product: p.product ? {
            id: p.product.id,
            name: p.product.name,
            price: p.product.price,
            images: p.product.images || [],
          } : null,
          status: p.status === "active" ? "published" : p.status === "pending" ? "scheduled" : "draft",
          aiText: p.ai_generated_text || "",
          scheduledAt: p.start_date ? new Date(p.start_date) : undefined,
          platforms: p.platforms || [],
          type: p.promotion_type === "auto" || p.promotion_type === "paid_posting" ? "posting" : "advertising",
        }));
        setPromotionalPosts(posts);
        
        setQueueStats({
          pending: posts.filter((p) => p.status === "scheduled").length,
          active: posts.filter((p) => p.status === "published").length,
        });
      }
    };
    fetchPromotions();
  }, [supplierIds.join(",")]);

  // Generate invite link for new suppliers
  const generateInviteLink = () => {
    const baseUrl = window.location.origin;
    const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const link = `${baseUrl}/partner?ref=${inviteCode}`;
    setInviteLink(link);
    navigator.clipboard.writeText(link);
    toast.success("Посилання скопійовано!");
  };

  // Search products - filter by supplier if available
  useEffect(() => {
    if (productSearch.length < 2) {
      setProducts([]);
      return;
    }

    const searchProducts = async () => {
      setIsSearching(true);
      try {
        let query = supabase
          .from("products")
          .select("id, name, price, images, supplier_id")
          .ilike("name", `%${productSearch}%`)
          .eq("in_stock", true);
        
        if (supplierIds.length > 0) {
          query = query.in("supplier_id", supplierIds);
        }
        
        const { data, error } = await query.limit(15);

        if (!error && data) {
          setProducts(data);
        }
      } catch (err) {
        console.error("Product search error:", err);
      } finally {
        setIsSearching(false);
      }
    };

    const debounce = setTimeout(searchProducts, 300);
    return () => clearTimeout(debounce);
  }, [productSearch, supplierIds.join(",")]);

  // Shop selector helpers
  const toggleShop = (shopId: string) => {
    setSelectedShopIds(prev =>
      prev.includes(shopId)
        ? prev.filter(id => id !== shopId)
        : [...prev, shopId]
    );
  };

  const selectAllShops = () => setSelectedShopIds(availableShops.map(s => s.id));
  const selectMyShops = () => setSelectedShopIds(myShops.map(s => s.id));
  const clearShops = () => setSelectedShopIds([]);

  const filteredShopsForSelector = (shops: ShopOption[]) => {
    if (!shopSearchQuery) return shops;
    return shops.filter(s => s.shop_name.toLowerCase().includes(shopSearchQuery.toLowerCase()));
  };

  const selectedShopNames = availableShops
    .filter(s => selectedShopIds.includes(s.id))
    .map(s => s.shop_name);

  // Auto-queue helpers
  const openCreateQueue = () => {
    if (selectedShopIds.length === 0) {
      toast.error("Спочатку оберіть магазини у селекторі");
      return;
    }
    setEditingQueue(null);
    setAutoQueueDialogOpen(true);
  };

  const openEditQueue = (q: AutoQueueItem) => {
    setEditingQueue(q);
    setAutoQueueDialogOpen(true);
  };

  const saveAutoQueue = async (data: any) => {
    if (!profile?.id) return;
    if (editingQueue?.id) {
      const { error } = await supabase
        .from("user_auto_queues")
        .update({ ...data, profile_id: profile.id })
        .eq("id", editingQueue.id);
      if (error) throw error;
      toast.success("Авто-чергу оновлено");
    } else {
      const { error } = await supabase
        .from("user_auto_queues")
        .insert({ ...data, profile_id: profile.id });
      if (error) throw error;
      toast.success("Авто-чергу створено");
    }
    await loadAutoQueues();
  };

  const toggleQueuePause = async (id: string) => {
    const queue = autoQueues.find(q => q.id === id);
    if (!queue) return;
    const newPaused = !queue.is_paused;
    setAutoQueues(prev => prev.map(q => q.id === id ? { ...q, is_paused: newPaused } : q));
    await supabase.from("user_auto_queues").update({
      is_paused: newPaused,
      next_execution_at: newPaused ? null : new Date().toISOString(),
    }).eq("id", id);
  };

  const deleteQueue = async (id: string) => {
    setAutoQueues(prev => prev.filter(q => q.id !== id));
    await supabase.from("user_auto_queues").delete().eq("id", id);
    toast.success("Авто-чергу видалено");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/?tab=account")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="font-bold text-lg text-foreground">Просування</h1>
              <p className="text-xs text-muted-foreground">Постинг та реклама</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1.5 select-none">
            <Sparkles className="w-3 h-3 text-warning" />
            <span className="text-[11px] font-medium text-foreground whitespace-nowrap">Ваші бафи: 2 безк. пости</span>
          </div>
        </div>

        {/* Multi-Shop Selector */}
        {availableShops.length > 0 && (
          <div className="px-4 pb-3">
            <Popover open={shopSelectorOpen} onOpenChange={setShopSelectorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start bg-muted/50 h-auto min-h-[2.75rem] py-2">
                  <Store className="h-4 w-4 text-primary mr-2 shrink-0" />
                  <div className="flex-1 flex flex-wrap gap-1 text-left">
                    {selectedShopIds.length === 0 ? (
                      <span className="text-muted-foreground text-sm">Оберіть магазини...</span>
                    ) : selectedShopIds.length === availableShops.length ? (
                      <Badge variant="secondary" className="text-xs">
                        🌐 Усі магазини ({availableShops.length})
                      </Badge>
                    ) : selectedShopNames.length <= 3 ? (
                      selectedShopNames.map(name => (
                        <Badge key={name} variant="secondary" className="text-xs">
                          {name}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {selectedShopIds.length} магазинів обрано
                      </Badge>
                    )}
                  </div>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="start">
                {/* Search */}
                <div className="p-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={shopSearchQuery}
                      onChange={(e) => setShopSearchQuery(e.target.value)}
                      placeholder="Пошук магазину..."
                      className="pl-9 h-9"
                    />
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex gap-1 p-2 border-b border-border">
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectAllShops}>
                    🌐 Усі
                  </Button>
                  {isAdmin && myShops.length > 0 && (
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectMyShops}>
                      🏠 Мої
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={clearShops}>
                    Скинути
                  </Button>
                </div>

                {/* Shop lists */}
                <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                  {/* Admin: My shops section */}
                  {isAdmin && myShops.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground px-2 py-1">🏠 Мої магазини</p>
                      {filteredShopsForSelector(myShops).map(shop => (
                        <label
                          key={shop.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedShopIds.includes(shop.id)}
                            onCheckedChange={() => toggleShop(shop.id)}
                          />
                          {shop.logo_url ? (
                            <img src={shop.logo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                          ) : (
                            <Store className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="text-sm flex-1 truncate">{shop.shop_name}</span>
                        </label>
                      ))}
                    </>
                  )}

                  {/* Admin: Partner shops / Moderator: All shops / Supplier: My shops */}
                  {(isAdmin && partnerShops.length > 0) && (
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1 mt-2">
                      🌐 Партнерські магазини
                    </p>
                  )}
                  {(!isAdmin && !isAdminOrMod && myShops.length > 0) && (
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                      🏠 Мої магазини
                    </p>
                  )}
                  {(effectiveRole === "moderator") && (
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                      🌐 Усі магазини платформи
                    </p>
                  )}

                  {filteredShopsForSelector(
                    isAdmin ? partnerShops :
                    !isAdminOrMod ? myShops :
                    availableShops
                  ).map(shop => (
                    <label
                      key={shop.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedShopIds.includes(shop.id)}
                        onCheckedChange={() => toggleShop(shop.id)}
                      />
                      {shop.logo_url ? (
                        <img src={shop.logo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <Store className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm flex-1 truncate">{shop.shop_name}</span>
                      {!shop.is_active && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Неакт.</Badge>
                      )}
                    </label>
                  ))}
                </div>

                {/* Footer */}
                <div className="p-2 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Обрано: {selectedShopIds.length}/{availableShops.length}
                  </span>
                  <Button size="sm" className="h-7 text-xs" onClick={() => setShopSelectorOpen(false)}>
                    Готово
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Selected shops chips */}
            {selectedShopIds.length > 0 && selectedShopIds.length < availableShops.length && selectedShopIds.length <= 5 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedShopNames.map(name => (
                  <Badge key={name} variant="outline" className="text-xs gap-1">
                    {name}
                    <button
                      onClick={() => {
                        const shop = availableShops.find(s => s.shop_name === name);
                        if (shop) toggleShop(shop.id);
                      }}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {inviteLink && (
          <div className="px-4 pb-3">
            <div className="bg-primary/10 rounded-lg p-2 text-xs text-center">
              <span className="text-muted-foreground">Посилання: </span>
              <span className="text-primary font-mono">{inviteLink}</span>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-4 mb-4">
            <TabsTrigger value="posting" className="text-xs">
              <Send className="h-4 w-4 mr-1" />
              Постинг
            </TabsTrigger>
            <TabsTrigger value="advertising" className="text-xs">
              <Megaphone className="h-4 w-4 mr-1" />
              Реклама
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="text-xs">
              <Clock className="h-4 w-4 mr-1" />
              Черга
            </TabsTrigger>
            <TabsTrigger value="stats" className="text-xs">
              <TrendingUp className="h-4 w-4 mr-1" />
              Статистика
            </TabsTrigger>
          </TabsList>

          {/* Posting Tab */}
          <TabsContent value="posting">
            <PostingTab
              products={products}
              isSearching={isSearching}
              productSearch={productSearch}
              setProductSearch={setProductSearch}
              selectedProducts={selectedProducts}
              setSelectedProducts={setSelectedProducts}
              useAllProducts={useAllProducts}
              setUseAllProducts={setUseAllProducts}
              setProducts={setProducts}
              supplierIds={supplierIds}
              selectedShopNames={selectedShopNames}
              availableShops={availableShops}
              myShops={myShops}
              partnerShops={partnerShops}
              selectedShopIds={selectedShopIds}
              toggleShop={toggleShop}
              selectAllShops={selectAllShops}
              selectMyShops={selectMyShops}
              clearShops={clearShops}
              isAdmin={isAdmin}
              effectiveRole={effectiveRole}
              profileId={profile?.id}
              initialStep={initialStep}
            />
          </TabsContent>

          {/* Advertising Tab */}
          <TabsContent value="advertising">
            <AdvertisingTab
              products={products}
              isSearching={isSearching}
              productSearch={productSearch}
              setProductSearch={setProductSearch}
              selectedProducts={selectedProducts}
              setSelectedProducts={setSelectedProducts}
              useAllProducts={useAllProducts}
              setUseAllProducts={setUseAllProducts}
              setProducts={setProducts}
              supplierIds={supplierIds}
              selectedShopNames={selectedShopNames}
              availableShops={availableShops}
              myShops={myShops}
              partnerShops={partnerShops}
              selectedShopIds={selectedShopIds}
              toggleShop={toggleShop}
              selectAllShops={selectAllShops}
              selectMyShops={selectMyShops}
              clearShops={clearShops}
              isAdmin={isAdmin}
              effectiveRole={effectiveRole}
              profileId={profile?.id}
              initialStep={initialStep}
            />
          </TabsContent>

          {/* Scheduled Posts Tab */}
          <TabsContent value="scheduled" className="space-y-4">
            {/* Sub-tabs */}
            <div className="flex gap-2 mb-4">
              <Button
                variant={queueSubTab === "scheduled" ? "default" : "outline"}
                size="sm"
                onClick={() => setQueueSubTab("scheduled")}
              >
                <Clock className="h-4 w-4 mr-1" />
                Заплановані
              </Button>
              <Button
                variant={queueSubTab === "auto" ? "default" : "outline"}
                size="sm"
                onClick={() => setQueueSubTab("auto")}
              >
                <Shuffle className="h-4 w-4 mr-1" />
                Авто-черга
              </Button>
            </div>

            {queueSubTab === "scheduled" && (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <Card className="p-3">
                    <div className="flex items-center gap-2">
                      <Send className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-xs text-muted-foreground">У черзі постинга</p>
                        <p className="text-lg font-bold">{queueStats.pending}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2">
                      <Megaphone className="h-4 w-4 text-warning" />
                      <div>
                        <p className="text-xs text-muted-foreground">Активна реклама</p>
                        <p className="text-lg font-bold">{queueStats.active}</p>
                      </div>
                    </div>
                  </Card>
                </div>

                {promotionalPosts
                  .filter((p) => p.status === "scheduled")
                  .map((post) => (
                    <Card key={post.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
                            <Image className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-sm">{post.product?.name}</p>
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-xs",
                                  post.type === "posting" 
                                    ? "bg-primary/10 text-primary border-primary/20" 
                                    : "bg-warning/10 text-warning border-warning/20"
                                )}
                              >
                                {post.type === "posting" ? "Постинг" : "Реклама"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {post.aiText}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                {post.scheduledAt?.toLocaleDateString("uk-UA")}
                              </span>
                            </div>
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {post.platforms.map((p) => (
                                <Badge key={p} variant="secondary" className="text-xs">
                                  {platforms.find((pl) => pl.id === p)?.icon}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                {promotionalPosts.filter((p) => p.status === "scheduled").length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Немає запланованих публікацій</p>
                  </div>
                )}
              </>
            )}

            {queueSubTab === "auto" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">Авто-черги</h3>
                    <p className="text-xs text-muted-foreground">
                      Автоматична публікація товарів з обраних магазинів
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="default" onClick={openCreateQueue}>
                      <Plus className="h-4 w-4 mr-1" />
                      Створити чергу
                    </Button>
                  </div>
                </div>

                {autoQueues.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shuffle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Немає активних авто-черг</p>
                    <p className="text-xs mt-1">Створіть авто-чергу для автоматичного просування товарів</p>
                  </div>
                ) : (
                  autoQueues.map(queue => {
                    const queueShopNames = availableShops
                      .filter(s => queue.supplier_ids.includes(s.id))
                      .map(s => s.shop_name);
                    const nextExec = queue.next_execution_at ? new Date(queue.next_execution_at) : null;
                    const minsToNext = nextExec ? Math.max(0, Math.round((nextExec.getTime() - Date.now()) / 60000)) : null;

                    return (
                      <Card key={queue.id} className={cn(queue.is_paused && "opacity-60")}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {queue.type === "posting" ? (
                                <Send className="h-4 w-4 text-primary" />
                              ) : (
                                <Megaphone className="h-4 w-4 text-warning" />
                              )}
                              <span className="font-medium text-sm">{queue.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {queue.type === "posting" ? "Постинг" : "Реклама"}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {queue.mode === "random" ? (
                                  <><Shuffle className="h-3 w-3 mr-1" />Рандом</>
                                ) : (
                                  <><ListOrdered className="h-3 w-3 mr-1" />Черга ({queue.product_ids.length})</>
                                )}
                              </Badge>
                              {queue.is_paused && (
                                <Badge variant="destructive" className="text-xs">Пауза</Badge>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditQueue(queue)}>
                                <Wand2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => toggleQueuePause(queue.id)}
                              >
                                {queue.is_paused ? (
                                  <Play className="h-3.5 w-3.5 text-success" />
                                ) : (
                                  <Pause className="h-3.5 w-3.5 text-warning" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => deleteQueue(queue.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>
                              <strong>Магазини:</strong>{" "}
                              {queueShopNames.length <= 2
                                ? queueShopNames.join(", ")
                                : `${queueShopNames.slice(0, 2).join(", ")} +${queueShopNames.length - 2}`}
                            </p>
                            <p>
                              <strong>Інтервал:</strong> кожні {queue.interval_minutes} хв
                              {queue.active_hours_start != null && queue.active_hours_end != null && (
                                <> · {queue.active_hours_start}:00–{queue.active_hours_end}:00</>
                              )}
                            </p>
                            <p>
                              <strong>Опубліковано:</strong> {queue.total_published}
                              {!queue.is_paused && minsToNext != null && (
                                <> · наступне через {minsToNext} хв</>
                              )}
                            </p>
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {queue.platforms.map(p => (
                                <Badge key={p} variant="secondary" className="text-xs">
                                  {platforms.find(pl => pl.id === p)?.icon} {platforms.find(pl => pl.id === p)?.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}
          </TabsContent>

          {/* Stats Tab */}
          <TabsContent value="stats" className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Перегляди</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">1,247</p>
                  <p className="text-xs text-success flex items-center gap-1 mt-1">
                    <TrendingUp className="h-3 w-3" />
                    +12% за тиждень
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-accent/10 to-accent/5 border-accent/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <MousePointerClick className="h-4 w-4 text-accent" />
                    <span className="text-xs text-muted-foreground">Кліки</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">156</p>
                  <p className="text-xs text-success flex items-center gap-1 mt-1">
                    <TrendingUp className="h-3 w-3" />
                    +8% за тиждень
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ShoppingCart className="h-4 w-4 text-success" />
                    <span className="text-xs text-muted-foreground">Замовлення</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">24</p>
                  <p className="text-xs text-success flex items-center gap-1 mt-1">
                    <TrendingUp className="h-3 w-3" />
                    +15% за тиждень
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-4 w-4 text-warning" />
                    <span className="text-xs text-muted-foreground">Конверсія</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">12.5%</p>
                  <p className="text-xs text-success flex items-center gap-1 mt-1">
                    <TrendingUp className="h-3 w-3" />
                    +2.1% за тиждень
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Views Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Динаміка переглядів
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={[
                        { day: 'Пн', views: 120, clicks: 15 },
                        { day: 'Вт', views: 180, clicks: 22 },
                        { day: 'Ср', views: 250, clicks: 35 },
                        { day: 'Чт', views: 190, clicks: 28 },
                        { day: 'Пт', views: 320, clicks: 45 },
                        { day: 'Сб', views: 280, clicks: 38 },
                        { day: 'Нд', views: 220, clicks: 30 },
                      ]}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="day" 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          background: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px'
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="views"
                        stroke="hsl(var(--primary))"
                        fillOpacity={1}
                        fill="url(#colorViews)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Platform Performance */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Ефективність платформ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { name: 'Telegram', icon: '📱', views: 850, percent: 68 },
                  { name: 'Instagram', icon: '📸', views: 234, percent: 19 },
                  { name: 'OLX', icon: '🛒', views: 98, percent: 8 },
                  { name: 'Prom.ua', icon: '🏪', views: 65, percent: 5 },
                ].map((platform) => (
                  <div key={platform.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{platform.icon}</span>
                        <span className="text-sm font-medium">{platform.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{platform.views} переглядів</span>
                    </div>
                    <Progress value={platform.percent} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* AI Processing Status */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-primary" />
                  Статус AI-обробки товарів
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { name: 'Тактичні рукавички M-Pact', status: 'done', progress: 100 },
                  { name: 'Рюкзак тактичний 35л', status: 'generating', progress: 65 },
                  { name: 'Берці демісезонні', status: 'analyzing', progress: 30 },
                ].map((item, idx) => (
                  <div key={idx} className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate flex-1 mr-2">{item.name}</span>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs shrink-0",
                          item.status === 'done' && "bg-success/10 text-success border-success/20",
                          item.status === 'generating' && "bg-primary/10 text-primary border-primary/20",
                          item.status === 'analyzing' && "bg-warning/10 text-warning border-warning/20"
                        )}
                      >
                        {item.status === 'done' && 'Готово'}
                        {item.status === 'generating' && 'Генерація опису'}
                        {item.status === 'analyzing' && 'AI аналіз'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={item.progress} className="h-1.5 flex-1" />
                      <span className="text-xs text-muted-foreground w-8">{item.progress}%</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recent Publications */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Останні публікації</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {promotionalPosts
                  .filter((p) => p.status === "published")
                  .map((post) => (
                    <div key={post.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                      <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                        <Image className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{post.product?.name}</p>
                        <div className="flex gap-1 flex-wrap">
                          {post.platforms.map((p) => (
                            <span key={p} className="text-xs">
                              {platforms.find((pl) => pl.id === p)?.icon}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs text-success bg-success/10 border-success/20">
                        <Check className="h-3 w-3 mr-1" />
                        Опубліковано
                      </Badge>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AutoQueueDialog
        open={autoQueueDialogOpen}
        onOpenChange={setAutoQueueDialogOpen}
        initialData={editingQueue ? {
          id: editingQueue.id,
          name: editingQueue.name,
          type: editingQueue.type,
          mode: editingQueue.mode,
          supplier_ids: editingQueue.supplier_ids,
          product_ids: editingQueue.product_ids,
          interval_minutes: editingQueue.interval_minutes,
          platforms: editingQueue.platforms,
          budget: editingQueue.budget,
          active_hours_start: editingQueue.active_hours_start,
          active_hours_end: editingQueue.active_hours_end,
        } : undefined}
        availableShops={availableShops.map(s => ({ id: s.id, shop_name: s.shop_name }))}
        defaultShopIds={selectedShopIds}
        onSave={saveAutoQueue}
      />
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Users, Check, X, Loader2, DollarSign, ShoppingCart, Package,
  Shield, UserCog, RefreshCw,
  Crown, Tag, Gift, Brain, BookOpen, MessageSquare, Trophy, Store, Megaphone, Wallet,
  Phone, Link2, Bot, Trash2, MessageCircle, History, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTelegramAuthContext } from '@/components/TelegramAuthProvider';
import { hapticSelection } from '@/lib/haptics';
import { vibrate } from '@/hooks/useTelegramUI';
import { PromoCodesManager } from '@/components/admin/PromoCodesManager';
import { BonusesManager } from '@/components/admin/BonusesManager';
import { AIInsightsDashboard } from '@/components/admin/AIInsightsDashboard';
import { ManualSupplierForm } from '@/components/admin/ManualSupplierForm';
import { SupportChatsViewer } from '@/components/admin/SupportChatsViewer';
import { GiveawaysManager } from '@/components/admin/GiveawaysManager';
import { AdminStoreManager } from '@/components/admin/AdminStoreManager';
import { AdminStoreOrders } from '@/components/admin/AdminStoreOrders';
import { OrdersManager } from '@/components/admin/OrdersManager';
import { AIOrderReports } from '@/components/admin/AIOrderReports';
import { AdminRolesManager } from '@/components/admin/AdminRolesManager';
import { CommandCenter } from '@/components/admin/CommandCenter';
import { AdminAiQueuePanel } from '@/components/admin/AdminQueueSheet';
import { AIRulesManager } from '@/components/admin/AIRulesManager';
import { PaymentsManager } from '@/components/admin/PaymentsManager';
import { ShopBalancesPanel } from '@/components/admin/ShopBalancesPanel';
import { TavernaGroupPanel } from '@/components/admin/TavernaGroupPanel';
import { AnimatePresence, motion } from 'framer-motion';
import {
  fetchPendingSupplierApplications,
  fetchSupplierDeletionRequests,
  fetchSupplierHistory,
  fetchAdminStores,
  approveSupplierApplication,
  rejectSupplierApplication,
  deleteSupplierAccount,
  approveSupplierDeletion,
  restoreSupplier,
  type BackendPendingSupplierApplication,
} from '@/lib/backendApi';

interface SupplierApplication {
  id: string;
  shop_name: string;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  supplier_type: string;
  tax_id: string;
  description: string | null;
  xml_url: string | null;
  source_type?: string | null;
  telegram_channel_link?: string | null;
  manager_telegram?: string | null;
  status: string;
  created_at: string;
  approved_at?: string | null;
  deleted_at?: string | null;
  reseller_probability: number | null;
  plagiarism_score: number | null;
  suggested_categories: string[] | null;
  profile_id: string | null;
  telegram_id: number | null;
  ai_score_report?: string | null;
  scoring_result?: string | null;
  deletion_reason?: string | null;
}

function supplierTypeLabel(type?: string | null): string {
  if (type === "business" || type === "company") return "ФОП";
  return "Фіз особа";
}

function historyStatusLabel(status?: string) {
  switch (status) {
    case "approved":
    case "active":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "deleted":
      return "Deleted";
    case "banned":
      return "Banned";
    default:
      return status || "—";
  }
}

function historyStatusClass(status?: string) {
  switch (status) {
    case "approved":
    case "active":
      return "bg-green-500/10 text-green-700 border-green-500/30";
    case "rejected":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "deleted":
      return "bg-orange-500/10 text-orange-700 border-orange-500/30";
    case "banned":
      return "bg-red-500/10 text-red-700 border-red-500/30";
    default:
      return "";
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function managerTelegramUrl(raw?: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/^https?:\/\//i, "").replace(/^@/, "");
  if (value.toLowerCase().startsWith("t.me/")) value = value.slice(5);
  value = value.split("?")[0].replace(/^\/+|\/+$/g, "");
  if (value.includes("/")) value = value.split("/").pop() || value;
  return value ? `https://t.me/${value}` : null;
}

interface TelegramAiScore {
  is_dropship: boolean;
  niche: string;
  price_range: string;
  description_quality: string;
  admin_summary: string;
}

function parseTelegramAiScore(raw?: string | null): TelegramAiScore | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    const candidate = first !== -1 && last > first ? text.slice(first, last + 1) : text;
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!("is_dropship" in parsed) || !("niche" in parsed)) return null;
    return {
      is_dropship: Boolean(parsed.is_dropship),
      niche: String(parsed.niche ?? "—"),
      price_range: String(parsed.price_range ?? "—"),
      description_quality: String(parsed.description_quality ?? "—"),
      admin_summary: String(parsed.admin_summary ?? ""),
    };
  } catch {
    return null;
  }
}

function TelegramScoreDashboard({ score }: { score: TelegramAiScore }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur-md p-3 space-y-3 shadow-lg shadow-indigo-500/10">
      <p className="text-sm font-semibold text-indigo-200 flex items-center gap-1.5">
        <Bot className="h-4 w-4" />
        🤖 AI-аналіз каналу
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white/5 border border-white/10 p-2 min-w-0">
          <p className="text-[10px] text-slate-400 leading-tight">🏷️ Ніша</p>
          <p className="text-xs font-medium text-white mt-1 break-words">{score.niche || "—"}</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 p-2 min-w-0">
          <p className="text-[10px] text-slate-400 leading-tight">💰 Ціни</p>
          <p className="text-xs font-medium text-white mt-1 break-words">{score.price_range || "—"}</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 p-2 min-w-0">
          <p className="text-[10px] text-slate-400 leading-tight">📦 Дропшипінг</p>
          <span
            className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              score.is_dropship
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                : "bg-red-500/20 text-red-300 border border-red-400/30"
            }`}
          >
            {score.is_dropship ? "Підтверджено" : "Ризик"}
          </span>
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Опис</p>
        <p className="text-sm text-slate-400 leading-relaxed break-words">
          {score.description_quality || "—"}
        </p>
      </div>
      {score.admin_summary ? (
        <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 p-3 rounded-lg">
          <p className="text-[10px] uppercase tracking-wide text-indigo-400 mb-1">🤖 Висновок AI</p>
          <p className="text-sm leading-relaxed break-words">{score.admin_summary}</p>
        </div>
      ) : null}
    </div>
  );
}

function mapSupplierApplication(r: BackendPendingSupplierApplication): SupplierApplication {
  return {
    id: String(r.id),
    shop_name: r.shop_name,
    full_name: r.full_name || "",
    email: r.email || "",
    phone: r.phone || "",
    company_name: r.company_name,
    supplier_type: r.supplier_type || "individual",
    tax_id: r.tax_id || "",
    description: r.description,
    xml_url: r.xml_url || r.yml_link,
    source_type: r.source_type || "xml",
    telegram_channel_link: r.telegram_channel_link || r.channel_link,
    manager_telegram: r.manager_telegram,
    status: r.status,
    created_at: r.created_at || new Date().toISOString(),
    approved_at: r.approved_at ?? null,
    deleted_at: r.deleted_at ?? null,
    reseller_probability: null,
    plagiarism_score: null,
    suggested_categories: null,
    profile_id: null,
    telegram_id: r.telegram_id ?? null,
    ai_score_report: r.ai_score_report || r.scoring_result,
    scoring_result: r.scoring_result || r.ai_score_report,
    deletion_reason: r.deletion_reason,
  };
}

interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  totalMargin: number;
  pendingOrders: number;
  openTickets: number;
  suppliersCount: number;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isLoading: authLoading, rolesLoading, isAuthenticated, effectiveRole, profile } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState('overview');
  const [pendingSuppliers, setPendingSuppliers] = useState<SupplierApplication[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<SupplierApplication[]>([]);
  const [historySuppliers, setHistorySuppliers] = useState<SupplierApplication[]>([]);
  const [applicationsSubTab, setApplicationsSubTab] = useState<'partnership' | 'deletion' | 'history'>('partnership');
  const [processingAppId, setProcessingAppId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<'approve' | 'reject' | 'delete' | 'approve-deletion' | 'restore' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [orderStats, setOrderStats] = useState<OrderStats>({
    totalOrders: 0, totalRevenue: 0, totalMargin: 0,
    pendingOrders: 0, openTickets: 0, suppliersCount: 0,
  });
  const [marketingSubTab, setMarketingSubTab] = useState<'promos' | 'bonuses' | 'giveaways'>('promos');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'insights' | 'reports'>('insights');
  const [storesSubTab, setStoresSubTab] = useState<'all' | 'partners' | 'my' | 'add'>('all');
  const [ordersSubTab, setOrdersSubTab] = useState<'all' | 'my_stores'>('all');

  const isAdmin = isAuthenticated && effectiveRole === 'admin';

  useEffect(() => {
    const tab = searchParams.get("tab");
    const zone = searchParams.get("zone");
    if (tab) setActiveTab(tab);
    if (zone === "danger") {
      setActiveTab("overview");
      const tryScroll = (attempt = 0) => {
        const el = document.getElementById("danger-zone");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        if (attempt < 20) window.setTimeout(() => tryScroll(attempt + 1), 150);
      };
      window.setTimeout(() => tryScroll(), 80);
    }
  }, [searchParams]);

  useEffect(() => {
    if (isAdmin) {
      fetchApplications();
      fetchDeletionList();
      fetchOrderStats();
    }
  }, [isAdmin]);

  const adminTelegramId =
    profile?.telegram_id ||
    (typeof window !== "undefined"
      ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
      : null);

  const fetchApplications = async () => {
    setIsLoading(true);
    try {
      const rows = await fetchPendingSupplierApplications(
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      setPendingSuppliers(rows.map(mapSupplierApplication));
      const focusId = searchParams.get("supplier");
      if (focusId) setActiveTab("applications");
    } catch (err) {
      console.error("Error fetching applications:", err);
      toast.error("Не вдалося завантажити заявки");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDeletionList = async () => {
    try {
      const rows = await fetchSupplierDeletionRequests(
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      setDeletionRequests(rows.map(mapSupplierApplication));
    } catch (err) {
      console.error("Error fetching deletion requests:", err);
      toast.error("Не вдалося завантажити заявки на видалення");
    }
  };

  const fetchHistoryList = async () => {
    try {
      const rows = await fetchSupplierHistory(
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      setHistorySuppliers(rows.map(mapSupplierApplication));
    } catch (err) {
      console.error("Error fetching supplier history:", err);
      toast.error("Не вдалося завантажити історію заявок");
    }
  };

  const fetchOrderStats = async () => {
    try {
      const [ordersResult, ticketsResult, stores] = await Promise.all([
        supabase.from('orders').select('id, total, subtotal, status'),
        supabase.from('support_tickets').select('id').eq('status', 'open'),
        fetchAdminStores(adminTelegramId ? Number(adminTelegramId) : undefined).catch(() => []),
      ]);
      const orders = ordersResult.data || [];
      const tickets = ticketsResult.data || [];
      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      setOrderStats({
        totalOrders: orders.length,
        totalRevenue,
        totalMargin: Math.round(totalRevenue * 0.2),
        pendingOrders: orders.filter(o => o.status === 'pending').length,
        openTickets: tickets.length,
        suppliersCount: stores.length,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const handleApprove = async (id: number) => {
    if (processingAppId) return;
    vibrate("success");
    const idStr = String(id);
    setProcessingAppId(idStr);
    setProcessingAction('approve');
    try {
      await approveSupplierApplication(
        id,
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      hapticSelection();
      setPendingSuppliers((prev) => prev.filter((item) => item.id !== idStr));
      toast.success("Магазин схвалено! AI почав імпорт та категоризацію товарів у фоновому режимі.");
    } catch (err: any) {
      console.error("Approve error:", err);
      toast.error(err?.message || "Не вдалося схвалити заявку");
    } finally {
      setProcessingAppId(null);
      setProcessingAction(null);
    }
  };

  const handleReject = async (id: number) => {
    if (processingAppId) return;
    vibrate("error");
    const idStr = String(id);
    setProcessingAppId(idStr);
    setProcessingAction('reject');
    try {
      await rejectSupplierApplication(
        id,
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      hapticSelection();
      setPendingSuppliers((prev) => prev.filter((item) => item.id !== idStr));
      toast.success("Заявку відхилено");
    } catch (err: any) {
      console.error("Reject error:", err);
      toast.error(err?.message || "Не вдалося відхилити заявку");
    } finally {
      setProcessingAppId(null);
      setProcessingAction(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (processingAppId) return;
    const idStr = String(id);
    setProcessingAppId(idStr);
    setProcessingAction('delete');
    try {
      await deleteSupplierAccount(
        id,
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      hapticSelection();
      setPendingSuppliers((prev) => prev.filter((item) => item.id !== idStr));
      toast.success("Постачальника та його товари видалено. Користувач знову став клієнтом");
    } catch (err: any) {
      console.error("Delete supplier error:", err);
      toast.error(err?.message || "Не вдалося видалити постачальника");
    } finally {
      setProcessingAppId(null);
      setProcessingAction(null);
    }
  };

  const handleApproveDeletion = async (id: number) => {
    if (processingAppId) return;
    const idStr = String(id);
    setProcessingAppId(idStr);
    setProcessingAction('approve-deletion');
    let removed: SupplierApplication | undefined;
    setDeletionRequests((prev) => {
      removed = prev.find((req) => String(req.id) === idStr);
      return prev.filter((req) => String(req.id) !== idStr);
    });
    try {
      await approveSupplierDeletion(
        id,
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      hapticSelection();
      setDeletionRequests((prev) => prev.filter((req) => String(req.id) !== String(id)));
      toast.success("Видалення підтверджено. Товари архівовано, користувач знову клієнт.");
      fetchHistoryList();
    } catch (err: any) {
      console.error("Approve deletion error:", err);
      const alreadyGone = err?.status === 409 || String(err?.message || "").includes("409");
      if (alreadyGone) {
        setDeletionRequests((prev) => prev.filter((req) => String(req.id) !== String(id)));
        toast.success("Магазин уже видалено.");
        fetchHistoryList();
      } else {
        if (removed) {
          setDeletionRequests((prev) => {
            if (prev.some((req) => String(req.id) === idStr)) return prev;
            return [removed as SupplierApplication, ...prev];
          });
        }
        toast.error(err?.message || "Не вдалося підтвердити видалення");
      }
    } finally {
      setProcessingAppId(null);
      setProcessingAction(null);
    }
  };

  const handleRestore = async (id: number) => {
    if (processingAppId) return;
    const idStr = String(id);
    setProcessingAppId(idStr);
    setProcessingAction("restore");
    try {
      await restoreSupplier(
        id,
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      hapticSelection();
      toast.success("Магазин і товари відновлено.");
      fetchHistoryList();
    } catch (err: any) {
      console.error("Restore supplier error:", err);
      toast.error(err?.message || "Не вдалося відновити магазин");
    } finally {
      setProcessingAppId(null);
      setProcessingAction(null);
    }
  };

  const switchApplicationsTab = (tab: 'partnership' | 'deletion' | 'history') => {
    hapticSelection();
    setApplicationsSubTab(tab);
    if (tab === 'partnership') fetchApplications();
    if (tab === 'deletion') fetchDeletionList();
    if (tab === 'history') fetchHistoryList();
  };

  if (authLoading || rolesLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mx-auto">
            <Shield className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Доступ заборонено</h1>
          <p className="text-slate-500 dark:text-slate-400">Ця сторінка доступна лише адміністраторам</p>
          <Button onClick={() => navigate('/')}>На головну</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-foreground" onClick={() => navigate("/?tab=account")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="font-bold text-lg text-foreground flex items-center gap-2">
                <Crown className="h-5 w-5 text-warning" />
                Адмін-панель
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-300">Taverna · Повний контроль</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            fetchApplications();
            fetchDeletionList();
            if (applicationsSubTab === 'history') fetchHistoryList();
            fetchOrderStats();
            toast.success('Дані оновлено');
          }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="p-4 grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 text-center">
          <ShoppingCart className="h-4 w-4 text-primary mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{orderStats.totalOrders}</p>
          <p className="text-[10px] text-muted-foreground">Замовлень</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <DollarSign className="h-4 w-4 text-green-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{orderStats.totalMargin.toLocaleString()}₴</p>
          <p className="text-[10px] text-muted-foreground">Прибуток</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <Store className="h-4 w-4 text-amber-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{orderStats.suppliersCount}</p>
          <p className="text-[10px] text-muted-foreground">Магазинів</p>
        </CardContent></Card>
      </div>

      {/* Alert badges */}
      <div className="px-4 flex gap-2 flex-wrap">
        {orderStats.pendingOrders > 0 && (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 gap-1">
            <Package className="h-3 w-3" /> {orderStats.pendingOrders} нових замовлень
          </Badge>
        )}
        {orderStats.openTickets > 0 && (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 gap-1">
            <MessageSquare className="h-3 w-3" /> {orderStats.openTickets} тікетів
          </Badge>
        )}
        {pendingSuppliers.length + deletionRequests.length > 0 && (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
            <Users className="h-3 w-3" /> {pendingSuppliers.length + deletionRequests.length} заявок
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="p-4 min-w-0">
        <Tabs value={activeTab} onValueChange={(v) => { hapticSelection(); setActiveTab(v); }}>
          <div className="flex overflow-x-auto whitespace-nowrap flex-nowrap gap-2 pb-2 scrollbar-hide [&::-webkit-scrollbar]:hidden w-full min-w-0">
            <TabsList className="flex w-max flex-nowrap gap-2 mb-0 h-auto">
              <TabsTrigger value="overview" className="text-xs px-3 gap-1 flex-shrink-0">
                <Crown className="h-3.5 w-3.5" /> Огляд
              </TabsTrigger>
              <TabsTrigger value="orders" className="text-xs px-3 gap-1 flex-shrink-0">
                <ShoppingCart className="h-3.5 w-3.5" /> Замовлення
              </TabsTrigger>
              <TabsTrigger value="payments" className="text-xs px-3 gap-1 flex-shrink-0">
                <Wallet className="h-3.5 w-3.5" /> Оплати
              </TabsTrigger>
              <TabsTrigger value="stores" className="text-xs px-3 gap-1 flex-shrink-0">
                <Store className="h-3.5 w-3.5" /> Магазини
              </TabsTrigger>
              <TabsTrigger value="ai-queue" className="text-xs px-3 gap-1 flex-shrink-0">
                <Bot className="h-3.5 w-3.5" /> AI-черга
              </TabsTrigger>
              <TabsTrigger value="ai-rules" className="text-xs px-3 gap-1 flex-shrink-0">
                <BookOpen className="h-3.5 w-3.5" /> Словник ШІ
              </TabsTrigger>
              <TabsTrigger value="applications" className="text-xs px-3 gap-1 flex-shrink-0">
                <Users className="h-3.5 w-3.5" /> Заявки
                {pendingSuppliers.length + deletionRequests.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                    {pendingSuppliers.length + deletionRequests.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="support" className="text-xs px-3 gap-1 flex-shrink-0">
                <MessageSquare className="h-3.5 w-3.5" /> Підтримка
              </TabsTrigger>
              <TabsTrigger value="marketing" className="text-xs px-3 gap-1 flex-shrink-0">
                <Megaphone className="h-3.5 w-3.5" /> Маркетинг
              </TabsTrigger>
              <TabsTrigger value="analytics" className="text-xs px-3 gap-1 flex-shrink-0">
                <Brain className="h-3.5 w-3.5" /> Аналітика
              </TabsTrigger>
              <TabsTrigger value="roles" className="text-xs px-3 gap-1 flex-shrink-0">
                <UserCog className="h-3.5 w-3.5" /> Користувачі
              </TabsTrigger>
            </TabsList>
          </div>

          {/* === ОГЛЯД === */}
          <TabsContent value="overview">
            <CommandCenter
              stats={orderStats}
              applicationsCount={pendingSuppliers.length}
              onNavigate={(tab) => { hapticSelection(); setActiveTab(tab); }}
            />
          </TabsContent>

          <TabsContent value="ai-queue">
            <AdminAiQueuePanel />
          </TabsContent>

          <TabsContent value="ai-rules">
            <AIRulesManager />
          </TabsContent>



          {/* === ЗАМОВЛЕННЯ === */}
          <TabsContent value="orders">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={ordersSubTab === 'all' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setOrdersSubTab('all')}
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Усі замовлення
                </Button>
                <Button
                  variant={ordersSubTab === 'my_stores' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setOrdersSubTab('my_stores')}
                >
                  <Crown className="h-3.5 w-3.5" />
                  Замовлення магазинів
                </Button>
              </div>
              {ordersSubTab === 'all' ? (
                <OrdersManager />
              ) : (
                <AdminStoreOrders />
              )}
            </div>
          </TabsContent>

          {/* === ОПЛАТИ === */}
          <TabsContent value="payments">
            <Tabs defaultValue="group" className="w-full">
              <TabsList className="w-full grid grid-cols-3 mb-4">
                <TabsTrigger value="group">Taverna Group</TabsTrigger>
                <TabsTrigger value="balances">Баланси магазинів</TabsTrigger>
                <TabsTrigger value="splits">Виплати за замовлення</TabsTrigger>
              </TabsList>
              <TabsContent value="group"><TavernaGroupPanel /></TabsContent>
              <TabsContent value="balances"><ShopBalancesPanel mode="admin" /></TabsContent>
              <TabsContent value="splits"><PaymentsManager mode="admin" /></TabsContent>
            </Tabs>
          </TabsContent>

          {/* === МАГАЗИНИ === */}
          <TabsContent value="stores">
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {(['all', 'partners', 'my', 'add'] as const).map((tab) => {
                  const labels = { all: 'Усі магазини', partners: 'Партнери', my: 'Мої магазини', add: '+ Додати' };
                  const icons = { all: <Store className="h-3.5 w-3.5" />, partners: <Users className="h-3.5 w-3.5" />, my: <Crown className="h-3.5 w-3.5" />, add: <Package className="h-3.5 w-3.5" /> };
                  return (
                    <Button
                      key={tab}
                      variant={storesSubTab === tab ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => setStoresSubTab(tab)}
                    >
                      {icons[tab]}
                      {labels[tab]}
                    </Button>
                  );
                })}
              </div>
              {storesSubTab === 'add' ? (
                <ScrollArea className="h-[calc(100vh-420px)]">
                  <div className="pr-4">
                    <ManualSupplierForm onSuccess={() => { setStoresSubTab('my'); fetchOrderStats(); }} />
                  </div>
                </ScrollArea>
              ) : (
                <AdminStoreManager filter={storesSubTab === 'partners' ? 'partners' : storesSubTab === 'my' ? 'my' : 'all'} />
              )}
            </div>
          </TabsContent>

          {/* === ЗАЯВКИ === */}
          <TabsContent value="applications">
            <div className="space-y-3">
              <div className="flex overflow-x-auto whitespace-nowrap flex-nowrap gap-2 pb-2 scrollbar-hide">
                {(
                  [
                    { key: 'partnership' as const, label: 'Партнерство', icon: <Users className="h-3.5 w-3.5" />, count: pendingSuppliers.length },
                    { key: 'deletion' as const, label: 'Видалення', icon: <Trash2 className="h-3.5 w-3.5" />, count: deletionRequests.length },
                    { key: 'history' as const, label: 'Історія', icon: <History className="h-3.5 w-3.5" />, count: 0 },
                  ] as const
                ).map((tab) => (
                  <Button
                    key={tab.key}
                    variant={applicationsSubTab === tab.key ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs flex-shrink-0"
                    onClick={() => switchApplicationsTab(tab.key)}
                  >
                    {tab.icon}
                    {tab.label}
                    {tab.count > 0 && (
                      <Badge variant="destructive" className="ml-0.5 h-4 px-1 text-[10px]">{tab.count}</Badge>
                    )}
                  </Button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={applicationsSubTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  <ScrollArea className="h-[calc(100vh-430px)]">
                    <div className="space-y-4 pr-4 pb-6">
                      {applicationsSubTab === 'partnership' && (
                        isLoading ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          </div>
                        ) : pendingSuppliers.length === 0 ? (
                          <div className="text-center py-12">
                            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                              <Users className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <p className="font-medium text-slate-900 dark:text-white">Немає нових заявок</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Всі заявки оброблені</p>
                          </div>
                        ) : (
                          pendingSuppliers.map((app) => {
                            const xmlUrl = app.xml_url;
                            const isTelegram = app.source_type === "telegram";
                            const channelUrl = managerTelegramUrl(app.telegram_channel_link);
                            const telegramScore = isTelegram
                              ? parseTelegramAiScore(app.ai_score_report || app.scoring_result)
                              : null;
                            const rawReport = app.ai_score_report || app.scoring_result;
                            return (
                            <Card key={app.id} className="overflow-hidden border-border">
                              <CardContent className="p-4 space-y-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h3 className="font-semibold text-foreground truncate">{app.shop_name}</h3>
                                    <p className="text-sm text-muted-foreground">{app.full_name || "—"}</p>
                                  </div>
                                  <Badge variant={app.supplier_type === "individual" ? "secondary" : "outline"}>
                                    {supplierTypeLabel(app.supplier_type)}
                                  </Badge>
                                </div>

                                <div className="grid grid-cols-1 gap-2 text-sm">
                                  <div className="flex justify-between gap-3">
                                    <span className="text-muted-foreground shrink-0">ПІБ</span>
                                    <span className="text-foreground text-right">{app.full_name || "—"}</span>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <span className="text-muted-foreground shrink-0">ЄДРПОУ / ІПН</span>
                                    <span className="text-foreground text-right font-medium">{app.tax_id || "—"}</span>
                                  </div>
                                  <div className="flex justify-between gap-3 items-center">
                                    <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                                      <Phone className="h-3.5 w-3.5" /> Телефон
                                    </span>
                                    {app.phone ? (
                                      <a href={`tel:${app.phone}`} className="text-primary text-right">
                                        {app.phone}
                                      </a>
                                    ) : (
                                      <span className="text-foreground">—</span>
                                    )}
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <span className="text-muted-foreground shrink-0">Telegram менеджера</span>
                                    <span className="text-foreground text-right">
                                      {app.manager_telegram || "—"}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-3 items-start">
                                    <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                                      {isTelegram ? (
                                        <MessageCircle className="h-3.5 w-3.5 text-sky-400 fill-sky-400/30" />
                                      ) : (
                                        <Link2 className="h-3.5 w-3.5" />
                                      )}
                                      {isTelegram ? "Telegram" : "XML"}
                                    </span>
                                    {isTelegram ? (
                                      app.telegram_channel_link ? (
                                        channelUrl ? (
                                        <a
                                          href={channelUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sky-400 text-right text-xs break-all underline underline-offset-2 hover:text-sky-300"
                                        >
                                          {app.telegram_channel_link}
                                        </a>
                                        ) : (
                                          <span className="text-sky-400 text-right text-xs break-all">
                                            {app.telegram_channel_link}
                                          </span>
                                        )
                                      ) : (
                                        <span className="text-foreground">—</span>
                                      )
                                    ) : xmlUrl ? (
                                      <a
                                        href={xmlUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary text-right text-xs break-all underline underline-offset-2"
                                      >
                                        {xmlUrl}
                                      </a>
                                    ) : (
                                      <span className="text-foreground">—</span>
                                    )}
                                  </div>
                                </div>

                                {telegramScore ? (
                                  <TelegramScoreDashboard score={telegramScore} />
                                ) : (
                                <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 space-y-2">
                                  <p className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                                    <Bot className="h-4 w-4" />
                                    🤖 AI-аналіз
                                  </p>
                                  <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed max-h-64 overflow-y-auto">
                                    {rawReport || "AI-звіт ще готується. Оновіть список через хвилину."}
                                  </p>
                                </div>
                                )}

                                <div className="grid grid-cols-2 gap-2 pt-1">
                                  <Button
                                    className="h-11 gap-2 bg-green-600 hover:bg-green-700 text-white"
                                    disabled={processingAppId === app.id}
                                    onClick={() => handleApprove(Number(app.id))}
                                  >
                                    {processingAppId === app.id && processingAction === 'approve' ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Check className="h-4 w-4" />
                                    )}
                                    ✅ Схвалити
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    className="h-11 gap-2"
                                    disabled={processingAppId === app.id}
                                    onClick={() => handleReject(Number(app.id))}
                                  >
                                    {processingAppId === app.id && processingAction === 'reject' ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <X className="h-4 w-4" />
                                    )}
                                    ❌ Відхилити
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="h-11 col-span-2 gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
                                    disabled={processingAppId === app.id}
                                    onClick={() => handleDelete(Number(app.id))}
                                  >
                                    {processingAppId === app.id && processingAction === 'delete' ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                    🗑 Видалити акаунт
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                            );
                          })
                        )
                      )}

                      {applicationsSubTab === 'deletion' && (
                        deletionRequests.length === 0 ? (
                          <div className="text-center py-12">
                            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                              <Trash2 className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <p className="font-medium text-slate-900 dark:text-white">Немає заявок на видалення</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Постачальники ще не просили закрити магазин</p>
                          </div>
                        ) : (
                          deletionRequests.map((app) => {
                            const tgUrl = managerTelegramUrl(app.manager_telegram);
                            return (
                              <Card key={app.id} className="overflow-hidden border-orange-500/30">
                                <CardContent className="p-4 space-y-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <h3 className="font-semibold text-foreground truncate">{app.shop_name}</h3>
                                      <p className="text-sm text-muted-foreground">{app.full_name || "—"}</p>
                                    </div>
                                    <Badge variant="destructive">На видалення</Badge>
                                  </div>

                                  <div className="grid grid-cols-1 gap-2 text-sm">
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground shrink-0">ПІБ</span>
                                      <span className="text-foreground text-right">{app.full_name || "—"}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground shrink-0">Telegram для зв'язку</span>
                                      <span className="text-foreground text-right">
                                        {app.manager_telegram || "—"}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="rounded-xl border border-orange-500/40 bg-orange-500/15 p-3 space-y-1.5">
                                    <p className="text-sm font-semibold text-orange-700 dark:text-orange-300 flex items-center gap-1.5">
                                      <AlertTriangle className="h-4 w-4" />
                                      Причина видалення
                                    </p>
                                    <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                                      {app.deletion_reason || "Причину не вказано"}
                                    </p>
                                  </div>

                                  <div className="grid grid-cols-1 gap-2 pt-1">
                                    <Button
                                      variant="outline"
                                      className="h-11 gap-2"
                                      disabled={!tgUrl}
                                      onClick={() => {
                                        if (!tgUrl) return;
                                        hapticSelection();
                                        const tg = (window as any).Telegram?.WebApp;
                                        if (tg?.openTelegramLink) tg.openTelegramLink(tgUrl);
                                        else window.open(tgUrl, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      <MessageCircle className="h-4 w-4" />
                                      💬 Написати менеджеру
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      className="h-11 gap-2"
                                      disabled={processingAppId === app.id}
                                      onClick={() => handleApproveDeletion(Number(app.id))}
                                    >
                                      {processingAppId === app.id && processingAction === 'approve-deletion' ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                      🗑 Підтвердити видалення
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })
                        )
                      )}

                      {applicationsSubTab === 'history' && (
                        historySuppliers.length === 0 ? (
                          <div className="text-center py-12">
                            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                              <History className="h-8 w-8 text-muted-foreground" />
                            </div>
                          <p className="font-medium text-slate-900 dark:text-white">Історія порожня</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">Тут з'являться схвалені, відхилені та видалені магазини</p>
                          </div>
                        ) : (
                          historySuppliers.map((app) => (
                            <Card key={app.id} className="overflow-hidden border-border">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h3 className="font-semibold text-foreground truncate">{app.shop_name}</h3>
                                    <p className="text-sm text-muted-foreground">{app.full_name || "—"}</p>
                                  </div>
                                  <Badge variant="outline" className={historyStatusClass(app.status)}>
                                    {historyStatusLabel(app.status)}
                                  </Badge>
                                </div>
                                <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                                  <p>📅 Створено: {formatDate(app.created_at)}</p>
                                  {app.approved_at ? (
                                    <p>✅ Схвалено: {formatDate(app.approved_at)}</p>
                                  ) : null}
                                  {app.deleted_at ? (
                                    <p>🗑 Видалено: {formatDate(app.deleted_at)}</p>
                                  ) : null}
                                </div>
                                {app.status === "deleted" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full gap-1.5"
                                    disabled={processingAppId === app.id}
                                    onClick={() => handleRestore(Number(app.id))}
                                  >
                                    {processingAppId === app.id && processingAction === "restore" ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    )}
                                    Відновити магазин
                                  </Button>
                                ) : null}
                              </CardContent>
                            </Card>
                          ))
                        )
                      )}
                    </div>
                  </ScrollArea>
                </motion.div>
              </AnimatePresence>
            </div>
          </TabsContent>

          {/* === ПІДТРИМКА === */}
          <TabsContent value="support">
            <SupportChatsViewer />
          </TabsContent>

          {/* === МАРКЕТИНГ === */}
          <TabsContent value="marketing">
            <div className="space-y-3">
              <div className="flex gap-2">
                {[
                  { key: 'promos' as const, label: 'Промокоди', icon: <Tag className="h-3.5 w-3.5" /> },
                  { key: 'bonuses' as const, label: 'Бонуси', icon: <Trophy className="h-3.5 w-3.5" /> },
                  { key: 'giveaways' as const, label: 'Розіграші', icon: <Gift className="h-3.5 w-3.5" /> },
                ].map(tab => (
                  <Button
                    key={tab.key}
                    variant={marketingSubTab === tab.key ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setMarketingSubTab(tab.key)}
                  >
                    {tab.icon}
                    {tab.label}
                  </Button>
                ))}
              </div>
              {marketingSubTab === 'promos' && <PromoCodesManager />}
              {marketingSubTab === 'bonuses' && <BonusesManager />}
              {marketingSubTab === 'giveaways' && <GiveawaysManager />}
            </div>
          </TabsContent>

          {/* === АНАЛІТИКА === */}
          <TabsContent value="analytics">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={analyticsSubTab === 'insights' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setAnalyticsSubTab('insights')}
                >
                  <Brain className="h-3.5 w-3.5" />
                  AI Інсайти
                </Button>
                <Button
                  variant={analyticsSubTab === 'reports' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setAnalyticsSubTab('reports')}
                >
                  <Package className="h-3.5 w-3.5" />
                  Звіти
                </Button>
              </div>
              {analyticsSubTab === 'insights' ? <AIInsightsDashboard /> : <AIOrderReports />}
            </div>
          </TabsContent>

          {/* === РОЛІ === */}
          <TabsContent value="roles">
            <AdminRolesManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

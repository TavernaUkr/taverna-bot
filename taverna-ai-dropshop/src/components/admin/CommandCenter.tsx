import { useEffect, useState } from "react";
import {
  ShoppingCart, DollarSign, Store, MessageSquare, Users, Megaphone,
  Ban, AlertTriangle, Clock, ChevronRight, Loader2, ShieldAlert,
  TrendingUp, Package,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformTreasury } from "./PlatformTreasury";
import { SupplierAuditCards } from "./SupplierAuditCards";
import { SystemKillSwitch } from "./SystemKillSwitch";

interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  totalMargin: number;
  pendingOrders: number;
  openTickets: number;
  suppliersCount: number;
}

interface CommandCenterProps {
  stats: OrderStats;
  applicationsCount: number;
  onNavigate: (tab: string) => void;
}

interface ExtraMetrics {
  activePromotions: number;
  activeAds: number;
  activeBans: number;
  overduePayments: number;
  openDisputes: number;
  productCount: number;
}

const EMPTY: ExtraMetrics = {
  activePromotions: 0,
  activeAds: 0,
  activeBans: 0,
  overduePayments: 0,
  openDisputes: 0,
  productCount: 0,
};

export function CommandCenter({ stats, applicationsCount, onNavigate }: CommandCenterProps) {
  const [extra, setExtra] = useState<ExtraMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const nowIso = new Date().toISOString();
        const [
          promoRes, adsRes, bansRes, overdueRes, disputesRes, productsRes,
        ] = await Promise.all([
          supabase.from("promotions").select("id", { count: "exact", head: true })
            .eq("status", "active").in("promotion_type", ["auto", "paid_posting"]),
          supabase.from("promotions").select("id", { count: "exact", head: true })
            .eq("status", "active").not("promotion_type", "in", "(auto,paid_posting)"),
          supabase.from("user_bans").select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase.from("supplier_payment_deadlines").select("id", { count: "exact", head: true })
            .eq("is_paid", false).lt("deadline_at", nowIso),
          supabase.from("reports").select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase.from("products").select("id", { count: "exact", head: true }),
        ]);

        setExtra({
          activePromotions: promoRes.count || 0,
          activeAds: adsRes.count || 0,
          activeBans: bansRes.count || 0,
          overduePayments: overdueRes.count || 0,
          openDisputes: disputesRes.count || 0,
          productCount: productsRes.count || 0,
        });
      } catch (err) {
        console.error("CommandCenter metrics error:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const kpis = [
    { label: "Замовлень", value: stats.totalOrders, icon: ShoppingCart, color: "text-primary", tab: "orders" },
    { label: "Прибуток", value: `${stats.totalMargin.toLocaleString()}₴`, icon: DollarSign, color: "text-green-500", tab: "orders" },
    { label: "Магазинів", value: stats.suppliersCount, icon: Store, color: "text-amber-500", tab: "stores" },
    { label: "Товарів", value: extra.productCount, icon: Package, color: "text-sky-500", tab: "stores" },
    { label: "Просувань", value: extra.activePromotions, icon: TrendingUp, color: "text-violet-500", tab: "analytics" },
    { label: "Реклам", value: extra.activeAds, icon: Megaphone, color: "text-pink-500", tab: "analytics" },
    { label: "Тікетів", value: stats.openTickets, icon: MessageSquare, color: "text-blue-500", tab: "support" },
    { label: "Банів", value: extra.activeBans, icon: Ban, color: "text-red-500", tab: "roles" },
  ];

  const attention = [
    {
      show: applicationsCount > 0,
      label: `${applicationsCount} нових заявок постачальників`,
      icon: Users, tone: "warning" as const, tab: "applications",
    },
    {
      show: stats.pendingOrders > 0,
      label: `${stats.pendingOrders} замовлень очікують обробки`,
      icon: Package, tone: "warning" as const, tab: "orders",
    },
    {
      show: extra.openDisputes > 0,
      label: `${extra.openDisputes} відкритих спорів/скарг`,
      icon: ShieldAlert, tone: "danger" as const, tab: "support",
    },
    {
      show: stats.openTickets > 0,
      label: `${stats.openTickets} відкритих тікетів підтримки`,
      icon: MessageSquare, tone: "info" as const, tab: "support",
    },
    {
      show: extra.overduePayments > 0,
      label: `${extra.overduePayments} прострочених оплат постачальників`,
      icon: Clock, tone: "danger" as const, tab: "stores",
    },
  ].filter((a) => a.show);

  const quickActions = [
    { label: "Заявки", icon: Users, tab: "applications" },
    { label: "Магазини", icon: Store, tab: "stores" },
    { label: "Користувачі", icon: Users, tab: "roles" },
    { label: "Підтримка", icon: MessageSquare, tab: "support" },
    { label: "Маркетинг", icon: Megaphone, tab: "marketing" },
    { label: "Аналітика", icon: TrendingUp, tab: "analytics" },
  ];

  return (
    <div className="space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {kpis.map((k) => (
          <button
            key={k.label}
            onClick={() => onNavigate(k.tab)}
            className="text-left"
          >
            <Card className="h-full hover:border-primary/40 transition-colors">
              <CardContent className="p-3">
                <k.icon className={cn("h-4 w-4 mb-1", k.color)} />
                <p className="text-lg font-bold text-foreground leading-tight">
                  {loading && typeof k.value === "number" && k.value === 0 ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : k.value}
                </p>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* Needs attention */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Потребує уваги
          </p>
          {attention.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Усе під контролем — критичних завдань немає 🎉
            </p>
          ) : (
            attention.map((a, i) => (
              <button
                key={i}
                onClick={() => onNavigate(a.tab)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg border p-2.5 text-left transition-colors",
                  a.tone === "danger" && "border-red-500/30 bg-red-500/5 hover:bg-red-500/10",
                  a.tone === "warning" && "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
                  a.tone === "info" && "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10",
                )}
              >
                <a.icon className={cn(
                  "h-4 w-4 shrink-0",
                  a.tone === "danger" && "text-red-500",
                  a.tone === "warning" && "text-amber-500",
                  a.tone === "info" && "text-blue-500",
                )} />
                <span className="text-xs text-foreground flex-1">{a.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Platform treasury */}
      <PlatformTreasury />

      {/* AI supplier audit */}
      <SupplierAuditCards />

      {/* Quick actions */}
      <div>
        <p className="text-sm font-semibold text-foreground mb-2">Швидкі дії</p>
        <div className="grid grid-cols-3 gap-2">
          {quickActions.map((qa) => (
            <Button
              key={qa.tab}
              variant="outline"
              className="h-auto flex-col gap-1.5 py-3"
              onClick={() => onNavigate(qa.tab)}
            >
              <qa.icon className="h-5 w-5 text-primary" />
              <span className="text-xs">{qa.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <SystemKillSwitch />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Loader2, MessageSquare, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

interface ShopOption {
  id: string;
  shop_name: string;
}

interface TicketRow {
  id: string;
  status: string;
  type: string;
  supplier_id: string | null;
  updated_at: string;
  user_id: string;
  shop_name?: string;
  customer_name?: string;
}

interface ManagerShopChatsProps {
  lockedSupplierId?: string;
}

export function ManagerShopChats({ lockedSupplierId }: ManagerShopChatsProps) {
  const navigate = useNavigate();
  const { profile } = useTelegramAuthContext() as any;
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopFilter, setShopFilter] = useState(lockedSupplierId || "all");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (lockedSupplierId) setShopFilter(lockedSupplierId);
  }, [lockedSupplierId]);

  useEffect(() => {
    const loadShops = async () => {
      const ids = new Set<string>();
      if (lockedSupplierId) ids.add(lockedSupplierId);

      if (profile?.id) {
        const { data: links } = await supabase
          .from("shop_manager_links")
          .select("supplier_id")
          .eq("profile_id", profile.id);
        (links || []).forEach((l: any) => ids.add(l.supplier_id));
      }

      if (profile?.telegram_id) {
        const { data: owned } = await supabase
          .from("suppliers")
          .select("id")
          .eq("telegram_id", profile.telegram_id);
        (owned || []).forEach((s: any) => ids.add(s.id));
      }

      const idList = [...ids].filter(Boolean);
      if (idList.length === 0) {
        setShops([]);
        return;
      }

      const { data } = await supabase
        .from("suppliers")
        .select("id, shop_name")
        .in("id", idList);
      setShops((data || []).map((s) => ({ id: s.id, shop_name: s.shop_name })));
    };

    loadShops();
  }, [lockedSupplierId, profile?.id, profile?.telegram_id]);

  const shopIds = useMemo(() => shops.map((s) => s.id), [shops]);

  useEffect(() => {
    const loadTickets = async () => {
      setIsLoading(true);
      try {
        const ids = shopFilter !== "all" ? [shopFilter] : shopIds;
        if (ids.length === 0) {
          setTickets([]);
          return;
        }

        const { data, error } = await supabase
          .from("support_tickets")
          .select("id, status, type, supplier_id, updated_at, user_id")
          .in("supplier_id", ids)
          .order("updated_at", { ascending: false })
          .limit(80);

        if (error) throw error;

        const userIds = [...new Set((data || []).map((t) => t.user_id))];
        const { data: profiles } = userIds.length
          ? await supabase.from("profiles_safe" as any).select("id, first_name, last_name").in("id", userIds)
          : { data: [] as any[] };

        const shopMap = Object.fromEntries(shops.map((s) => [s.id, s.shop_name]));
        const profileMap = Object.fromEntries(
          ((profiles || []) as any[]).map((p) => [p.id, `${p.first_name || ""} ${p.last_name || ""}`.trim()]),
        );

        setTickets(
          (data || []).map((t) => ({
            ...t,
            shop_name: t.supplier_id ? shopMap[t.supplier_id] : undefined,
            customer_name: profileMap[t.user_id] || "Клієнт",
          })),
        );
      } catch (err) {
        console.error("Error loading manager chats:", err);
        setTickets([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadTickets();
  }, [shopFilter, shopIds.join("|"), shops]);

  return (
    <div className="space-y-3">
      {!lockedSupplierId && shops.length > 1 && (
        <Select value={shopFilter} onValueChange={setShopFilter}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Усі магазини" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Усі магазини</SelectItem>
            {shops.map((shop) => (
              <SelectItem key={shop.id} value={shop.id}>
                {shop.shop_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>Чатів поки немає</p>
        </div>
      ) : (
        tickets.map((ticket) => (
          <Card
            key={ticket.id}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => navigate(`/support/chat/${ticket.id}`)}
          >
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{ticket.customer_name}</p>
                  <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
                    {ticket.status === "open" ? "Відкритий" : "Закритий"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <Store className="h-3 w-3" />
                  {ticket.shop_name || "Магазин"}
                  <Clock className="h-3 w-3 ml-1" />
                  {new Date(ticket.updated_at).toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}
                </p>
              </div>
              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

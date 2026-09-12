import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Scale, MessageSquare, Loader2, Check, AlertTriangle, Package, User, Store,
  Clock, Undo2, ShieldAlert, UserX, ArrowUpRight, Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface Dispute {
  id: string;
  ticket_id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  supplier_name: string;
  reason: string;
  description: string;
  status: "pending" | "in_review" | "resolved_customer" | "resolved_supplier" | "rejected";
  created_at: string;
  order_amount: number;
  client_claim: string | null;
  shop_reply: string | null;
  timeline: { label: string; at: string }[];
}

type QuickActionId = "refund" | "penalty_shop" | "penalty_client" | "escalate";

const QUICK_ACTIONS: {
  id: QuickActionId;
  label: string;
  icon: any;
  tone: "success" | "destructive" | "warning" | "primary";
  title: string;
  hint: string;
  note: (d: Dispute) => string;
}[] = [
  {
    id: "refund",
    label: "Повернути кошти",
    icon: Undo2,
    tone: "success",
    title: "Повернення коштів клієнту",
    hint: "Сума замовлення повернеться на «Картку для повернень» клієнта.",
    note: (d) => `Модератор ініціював повернення коштів клієнту на суму ${d.order_amount.toLocaleString()} ₴.`,
  },
  {
    id: "penalty_shop",
    label: "Штраф магазину",
    icon: ShieldAlert,
    tone: "destructive",
    title: "Штраф магазину",
    hint: "Знижує рейтинг магазину та фіксує порушення в історії.",
    note: (d) => `Модератор наклав штраф на магазин «${d.supplier_name}».`,
  },
  {
    id: "penalty_client",
    label: "Штраф клієнту",
    icon: UserX,
    tone: "warning",
    title: "Штраф клієнту (неправдива скарга)",
    hint: "Використовуйте лише при підтвердженій неправдивій претензії.",
    note: (d) => `Модератор наклав штраф на клієнта «${d.customer_name}» за неправдиву претензію.`,
  },
  {
    id: "escalate",
    label: "Ескалація до Адміна",
    icon: ArrowUpRight,
    tone: "primary",
    title: "Ескалація до адміністратора",
    hint: "Спір перейде до адміністратора платформи з вашим коментарем.",
    note: () => `Спір ескальовано до адміністратора платформи.`,
  },
];

const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;

const agoISO = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

const MOCK_DISPUTES: Dispute[] = [
  {
    id: "demo-1",
    ticket_id: "demo-1",
    order_id: "demo-order-1",
    order_number: "#1042-A",
    customer_name: "Олег Кравченко",
    supplier_name: "Tactical Pro",
    reason: "Пошкоджена коробка",
    description: "Пошкоджена коробка при отриманні",
    status: "pending",
    created_at: agoISO(31),
    order_amount: 1450,
    client_claim:
      "Отримав посилку з розірваною коробкою, кріплення на рюкзаку зламане. Прошу повне повернення коштів, фото додав у чат.",
    shop_reply:
      "Надіслали відео цілого пакування перед відправкою. Коробка була ціла, пошкодження сталося на боці перевізника — готові оформити претензію до служби доставки.",
    timeline: [
      { label: "Клієнт написав", at: agoISO(31) },
      { label: "Магазин відповів", at: agoISO(27) },
      { label: "Клієнт надіслав фото", at: agoISO(20) },
    ],
  },
  {
    id: "demo-2",
    ticket_id: "demo-2",
    order_id: "demo-order-2",
    order_number: "#1078-B",
    customer_name: "Ірина Мельник",
    supplier_name: "Alpha Gear",
    reason: "Невідповідний розмір",
    description: "Прийшов не той розмір",
    status: "pending",
    created_at: agoISO(11),
    order_amount: 890,
    client_claim:
      "Замовляла черевики 39 розміру, у посилці 41. Хочу обмін або повернення, товар не носила.",
    shop_reply:
      "У накладній вказано 39. Перевіряємо склад, можливо переплутали пару при комплектації. Пропонуємо безкоштовний обмін.",
    timeline: [
      { label: "Клієнт написав", at: agoISO(11) },
      { label: "Магазин відповів", at: agoISO(9) },
    ],
  },
  {
    id: "demo-3",
    ticket_id: "demo-3",
    order_id: "demo-order-3",
    order_number: "#1093-C",
    customer_name: "Сергій Бондар",
    supplier_name: "Nord Supply",
    reason: "Замовлення не доїхало",
    description: "Трек не оновлюється 9 днів",
    status: "pending",
    created_at: agoISO(52),
    order_amount: 3200,
    client_claim:
      "Трек-номер не оновлюється 9 днів, у відділенні посилки немає. Оплатив повну передоплату 3 200 ₴, магазин не виходить на зв'язок.",
    shop_reply: null,
    timeline: [
      { label: "Клієнт написав", at: agoISO(52) },
      { label: "AI-асистент", at: agoISO(51) },
      { label: "Модератор втрутився", at: agoISO(6) },
    ],
  },
  {
    id: "demo-4",
    ticket_id: "demo-4",
    order_id: "demo-order-4",
    order_number: "#1101-D",
    customer_name: "Марта Гнатюк",
    supplier_name: "Taverna Store",
    reason: "Спірна якість",
    description: "Плями на тканині",
    status: "pending",
    created_at: agoISO(2),
    order_amount: 640,
    client_claim: "На сорочці плями від фарби, схоже на брак партії.",
    shop_reply: "Готові прийняти повернення після фото. Компенсуємо доставку.",
    timeline: [{ label: "Клієнт написав", at: agoISO(2) }],
  },
];

export function DisputesManager() {
  const navigate = useNavigate();
  const [disputes, setDisputes] = useState<Dispute[]>(MOCK_DISPUTES);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState("");
  const [resolutionType, setResolutionType] = useState<string>("");
  const [isResolving, setIsResolving] = useState(false);
  const [quickAction, setQuickAction] = useState<{ dispute: Dispute; action: QuickActionId } | null>(null);
  const [quickComment, setQuickComment] = useState("");
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    fetchDisputes();
  }, []);

  const fetchDisputes = async () => {
    try {
      const { data: tickets, error } = await supabase
        .from("support_tickets")
        .select(`*, order:orders(id, order_number, total, profile_id)`)
        .eq("type", "supplier_question")
        .in("status", ["open"])
        .not("related_order_id", "is", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch customer names from profiles_safe
      const profileIds = [...new Set((tickets || []).map(t => t.user_id).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles_safe" as any)
          .select("id, first_name, last_name")
          .in("id", profileIds);
        (profiles || []).forEach((p: any) => {
          profileMap[p.id] = [p.first_name, p.last_name].filter(Boolean).join(" ") || "Клієнт";
        });
      }

      // Fetch order items to find supplier
      const orderIds = [...new Set((tickets || []).map(t => t.related_order_id).filter(Boolean))];
      let supplierMap: Record<string, string> = {};
      if (orderIds.length > 0) {
        const { data: orderItems } = await supabase
          .from("order_items")
          .select("order_id, product_id")
          .in("order_id", orderIds);

        const productIds = [...new Set((orderItems || []).map(oi => oi.product_id).filter(Boolean))];
        if (productIds.length > 0) {
          const { data: products } = await supabase
            .from("products")
            .select("id, supplier_id")
            .in("id", productIds);

          const supplierIds = [...new Set((products || []).map(p => p.supplier_id).filter(Boolean))];
          if (supplierIds.length > 0) {
            const { data: suppliers } = await supabase
              .from("suppliers")
              .select("id, shop_name")
              .in("id", supplierIds as string[]);

            const supplierNameMap: Record<string, string> = {};
            (suppliers || []).forEach(s => { supplierNameMap[s.id] = s.shop_name; });

            (orderItems || []).forEach(oi => {
              const product = (products || []).find(p => p.id === oi.product_id);
              if (product?.supplier_id && oi.order_id) {
                supplierMap[oi.order_id] = supplierNameMap[product.supplier_id] || "Постачальник";
              }
            });
          }
        }
      }

      // Fetch messages for each ticket: client claim, shop reply, timeline
      const ticketIds = (tickets || []).map(t => t.id);
      const claimMap: Record<string, string> = {};
      const replyMap: Record<string, string> = {};
      const timelineMap: Record<string, { label: string; at: string }[]> = {};
      if (ticketIds.length > 0) {
        const { data: messages } = await supabase
          .from("ticket_messages")
          .select("ticket_id, message_text, sender_role, created_at")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: true });

        (messages || []).forEach(m => {
          const clean = (m.message_text || "").replace(/^\[.*?\]\n?/, "");
          if (m.sender_role === "user" && !claimMap[m.ticket_id]) claimMap[m.ticket_id] = clean;
          if ((m.sender_role === "supplier" || m.sender_role === "moderator") && !replyMap[m.ticket_id]) {
            replyMap[m.ticket_id] = clean;
          }
          const list = timelineMap[m.ticket_id] || (timelineMap[m.ticket_id] = []);
          if (list.length < 5) {
            list.push({
              label:
                m.sender_role === "user" ? "Клієнт написав" :
                m.sender_role === "supplier" ? "Магазин відповів" :
                m.sender_role === "moderator" ? "Модератор втрутився" : "AI-асистент",
              at: m.created_at,
            });
          }
        });
      }

      const disputesData: Dispute[] = (tickets || []).map((t) => ({
        id: t.id,
        ticket_id: t.id,
        order_id: t.related_order_id || "",
        order_number: t.order?.order_number || `#${(t.related_order_id || "").slice(0, 8)}`,
        customer_name: profileMap[t.user_id] || "Клієнт",
        supplier_name: supplierMap[t.related_order_id || ""] || "Постачальник",
        reason: "Спір по замовленню",
        description: claimMap[t.id] || "Спірне питання щодо замовлення",
        status: "pending" as const,
        created_at: t.created_at,
        order_amount: t.order?.total || 0,
        client_claim: claimMap[t.id] || null,
        shop_reply: replyMap[t.id] || null,
        timeline: timelineMap[t.id] || [],
      }));

      if (disputesData.length > 0) setDisputes(disputesData);
    } catch (err) {
      console.error("Error fetching disputes:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedDispute || !resolutionType) {
      toast.error("Оберіть рішення");
      return;
    }

    const isDemo = selectedDispute.id.startsWith("demo-");
    setIsResolving(true);
    try {
      if (!isDemo) {
        const { error } = await supabase
          .from("support_tickets")
          .update({ status: "closed" })
          .eq("id", selectedDispute.ticket_id);

        if (error) throw error;

        await supabase.from("ticket_messages").insert({
          ticket_id: selectedDispute.ticket_id,
          sender_role: "moderator",
          message_text: `Рішення модератора: ${
            resolutionType === "customer" ? "На користь клієнта" :
            resolutionType === "supplier" ? "На користь постачальника" :
            "Спір відхилено"
          }.\n\n${resolution}`,
        });
      } else {
        setDisputes(prev => prev.filter(d => d.id !== selectedDispute.id));
      }

      hapticNotification("success");
      toast.success("Спір вирішено");
      setSelectedDispute(null);
      setResolution("");
      setResolutionType("");
      if (!isDemo) fetchDisputes();
    } catch (err) {
      console.error("Error resolving dispute:", err);
      toast.error("Помилка вирішення спору");
    } finally {
      setIsResolving(false);
    }
  };

  const runQuickAction = async () => {
    if (!quickAction) return;
    const cfg = QUICK_ACTIONS.find(a => a.id === quickAction.action)!;
    const isDemo = quickAction.dispute.id.startsWith("demo-");
    setIsActing(true);
    try {
      const note = `${cfg.note(quickAction.dispute)}${quickComment ? `\n\n${quickComment}` : ""}`;
      if (!isDemo) {
        await supabase.from("ticket_messages").insert({
          ticket_id: quickAction.dispute.ticket_id,
          sender_role: "moderator",
          message_text: `[Дія модератора] ${note}`,
        });
      } else {
        const id = quickAction.dispute.id;
        setDisputes(prev => prev.map(d => d.id === id
          ? { ...d, timeline: [...d.timeline, { label: cfg.label, at: new Date().toISOString() }] }
          : d));
      }
      hapticNotification("success");
      toast.success(cfg.title, { description: "Дію зафіксовано в історії спору" });
      setQuickAction(null);
      setQuickComment("");
      if (!isDemo) fetchDisputes();
    } catch (err) {
      console.error("Quick action error:", err);
      toast.error("Не вдалося виконати дію");
    } finally {
      setIsActing(false);
    }
  };


  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("uk-UA", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  };

  const hotCount = disputes.filter(d => hoursSince(d.created_at) > 24).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Scale className="h-5 w-5 text-warning" />
          Арена спорів
        </h3>
        <div className="flex items-center gap-2">
          {hotCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Flame className="h-3 w-3" /> {hotCount} гарячих
            </Badge>
          )}
          <Badge variant={disputes.length > 0 ? "default" : "outline"}>
            {disputes.length} активних
          </Badge>
        </div>
      </div>

      <ScrollArea className="h-[420px]">
        <div className="space-y-3 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : disputes.length === 0 ? (
            <div className="text-center py-12">
              <Scale className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Немає активних спорів</p>
              <p className="text-sm text-muted-foreground mt-1">Всі спірні питання вирішено</p>
            </div>
          ) : (
            disputes.map((dispute) => {
              const hours = hoursSince(dispute.created_at);
              const urgent = hours > 24;

              return (
                <Card
                  key={dispute.id}
                  className={cn(
                    "overflow-hidden",
                    urgent ? "border-destructive/50" : hours > 8 ? "border-warning/50" : "",
                  )}
                >
                  {/* Смуга-заголовок */}
                  <div className={cn(
                    "flex items-center justify-between gap-2 px-4 py-2.5 text-sm",
                    urgent ? "bg-destructive/10" : "bg-muted/60",
                  )}>
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className={cn("h-4 w-4 shrink-0", urgent ? "text-destructive" : "text-warning")} />
                      <span className="font-semibold truncate">{dispute.order_number}</span>
                      <span className="text-muted-foreground shrink-0">
                        · {dispute.order_amount.toLocaleString()} ₴
                      </span>
                    </div>
                    <div className={cn(
                      "flex items-center gap-1 text-xs shrink-0",
                      urgent ? "text-destructive font-semibold" : "text-muted-foreground",
                    )}>
                      <Clock className="h-3 w-3" />
                      {hours < 1 ? "щойно" : hours < 24 ? `${Math.floor(hours)} год` : `${Math.floor(hours / 24)} дн`}
                    </div>
                  </div>

                  <CardContent className="p-4 space-y-3">
                    {/* Дві сторони конфлікту */}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                          <User className="h-3.5 w-3.5" /> Претензія клієнта
                        </div>
                        <p className="text-sm font-medium text-foreground truncate">{dispute.customer_name}</p>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                          {dispute.client_claim || "Клієнт ще не описав претензію"}
                        </p>
                      </div>

                      <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                          <Store className="h-3.5 w-3.5" /> Позиція магазину / Історія
                        </div>
                        <p className="text-sm font-medium text-foreground truncate">{dispute.supplier_name}</p>
                        {dispute.shop_reply ? (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                            {dispute.shop_reply}
                          </p>
                        ) : (
                          <p className="text-xs text-warning">Без відповіді магазину</p>
                        )}
                        {dispute.timeline.length > 0 && (
                          <ul className="space-y-1 pt-1 border-t border-border/60">
                            {dispute.timeline.slice(-3).map((ev, i) => (
                              <li key={i} className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span className="truncate">{ev.label}</span>
                                <span className="shrink-0 ml-2">{formatDate(ev.at)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {/* Швидкі дії */}
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_ACTIONS.map((a) => {
                        const Icon = a.icon;
                        return (
                          <Button
                            key={a.id}
                            size="sm"
                            variant="outline"
                            className={cn(
                              "h-9 text-[11px] justify-start",
                              a.tone === "success" && "border-success/40 text-success hover:bg-success/10",
                              a.tone === "destructive" && "border-destructive/40 text-destructive hover:bg-destructive/10",
                              a.tone === "warning" && "border-warning/40 text-warning hover:bg-warning/10",
                              a.tone === "primary" && "border-primary/40 text-primary hover:bg-primary/10",
                            )}
                            onClick={() => { hapticSelection(); setQuickAction({ dispute, action: a.id }); }}
                          >
                            <Icon className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                            {a.label}
                          </Button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => navigate(`/support/chat/${dispute.ticket_id}`)}
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Міст-чат
                      </Button>
                      <Button size="sm" className="flex-1" onClick={() => setSelectedDispute(dispute)}>
                        <Scale className="h-4 w-4 mr-1" />
                        Вирішити
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Швидка дія */}
      <Dialog open={!!quickAction} onOpenChange={(o) => { if (!o) { setQuickAction(null); setQuickComment(""); } }}>
        <DialogContent>
          {quickAction && (() => {
            const cfg = QUICK_ACTIONS.find(a => a.id === quickAction.action)!;
            const Icon = cfg.icon;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Icon className="h-5 w-5" /> {cfg.title}
                  </DialogTitle>
                  <DialogDescription>{cfg.hint}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    <p className="font-medium">{quickAction.dispute.order_number}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {quickAction.dispute.customer_name} vs {quickAction.dispute.supplier_name} ·{" "}
                      {quickAction.dispute.order_amount.toLocaleString()} ₴
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Коментар (необов'язково)</Label>
                    <Textarea
                      value={quickComment}
                      onChange={(e) => setQuickComment(e.target.value)}
                      rows={3}
                      placeholder="Підстава для дії..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setQuickAction(null)}>Скасувати</Button>
                  <Button onClick={runQuickAction} disabled={isActing}>
                    {isActing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                    Підтвердити
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Resolution Dialog */}
      <Dialog open={!!selectedDispute} onOpenChange={() => setSelectedDispute(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Вирішення спору
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedDispute && (
              <div className="p-3 bg-muted rounded-lg space-y-2">
                <p className="font-medium">{selectedDispute.order_number}</p>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{selectedDispute.customer_name} vs {selectedDispute.supplier_name}</span>
                  <span>{selectedDispute.order_amount.toLocaleString()} ₴</span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Рішення</Label>
              <Select value={resolutionType} onValueChange={setResolutionType}>
                <SelectTrigger><SelectValue placeholder="Оберіть рішення..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">На користь клієнта</SelectItem>
                  <SelectItem value="supplier">На користь постачальника</SelectItem>
                  <SelectItem value="rejected">Відхилити спір</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Коментар модератора</Label>
              <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Опишіть причину рішення..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDispute(null)}>Скасувати</Button>
            <Button onClick={handleResolve} disabled={isResolving || !resolutionType}>
              {isResolving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Прийняти рішення
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

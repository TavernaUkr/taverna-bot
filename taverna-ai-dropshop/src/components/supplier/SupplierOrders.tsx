import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Loader2, Truck, Clock, CheckCircle2, XCircle, ChevronRight,
  RefreshCw, RotateCcw, Eye, Archive, Copy, MapPin, MessageSquare, CalendarIcon, Sparkles,
  Star, UserCheck, TrendingUp
} from "lucide-react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";
import { MOCK_ORDERS, MockOrder } from "@/data/mockOrders";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

const payStageStyle: Record<string, { label: string; cls: string }> = {
  created: { label: "Оплата: створено", cls: "bg-yellow-100 text-yellow-700" },
  processing: { label: "Оплата: в обробці", cls: "bg-blue-100 text-blue-700" },
  paid: { label: "Оплачено ✓", cls: "bg-green-100 text-green-700" },
};

interface SupplierOrdersProps {
  supplierId: string;
  mode?: "active" | "history";
}

const statusConfig: Record<string, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
  pending: { label: "Очікує обробки", icon: Clock, color: "text-yellow-600", bgColor: "bg-yellow-100" },
  processing: { label: "В обробці", icon: Package, color: "text-blue-600", bgColor: "bg-blue-100" },
  shipped: { label: "Відправлено", icon: Truck, color: "text-purple-600", bgColor: "bg-purple-100" },
  delivered: { label: "Доставлено", icon: CheckCircle2, color: "text-green-600", bgColor: "bg-green-100" },
  received: { label: "Отримано", icon: CheckCircle2, color: "text-emerald-600", bgColor: "bg-emerald-100" },
  exchange: { label: "Обмін", icon: RefreshCw, color: "text-orange-600", bgColor: "bg-orange-100" },
  return: { label: "Повернення", icon: RotateCcw, color: "text-rose-600", bgColor: "bg-rose-100" },
  cancelled: { label: "Скасовано", icon: XCircle, color: "text-red-600", bgColor: "bg-red-100" },
};

const ARCHIVE_DAYS = 15;

function isArchivedOrder(order: { status: string; updated_at: string }): boolean {
  const daysSince = Math.floor((Date.now() - new Date(order.updated_at).getTime()) / (1000 * 60 * 60 * 24));
  if (["cancelled", "exchange", "return"].includes(order.status)) return true;
  if ((order.status === "received" || order.status === "delivered") && daysSince >= ARCHIVE_DAYS) return true;
  return false;
}

type SupplierOrder = MockOrder & { customer_name?: string; profile_id?: string };

export function SupplierOrders({ supplierId, mode = "active" }: SupplierOrdersProps) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<SupplierOrder | null>(null);
  const [ttnInput, setTtnInput] = useState("");
  const [isSavingTtn, setIsSavingTtn] = useState(false);
  const [useMockData, setUseMockData] = useState(false);
  const { sessionToken } = useTelegramAuthContext();
  const [paymentMap, setPaymentMap] = useState<Record<string, string>>({});
  const [customerRating, setCustomerRating] = useState(0);
  const [showCustomerRating, setShowCustomerRating] = useState(false);
  const [supplierAvgRating, setSupplierAvgRating] = useState<number | null>(null);
  const [supplierReviewCount, setSupplierReviewCount] = useState(0);

  useEffect(() => {
    const loadPayments = async () => {
      if (!sessionToken || !supplierId || supplierId === "demo") return;
      try {
        const { data } = await supabase.functions.invoke("manage-payments", {
          body: { action: "supplier_list", session_token: sessionToken, supplier_id: supplierId },
        });
        const map: Record<string, string> = {};
        (data?.splits || []).forEach((s: any) => { if (s.order_id) map[s.order_id] = s.payout_stage; });
        setPaymentMap(map);
      } catch { /* non-critical */ }
    };
    loadPayments();
  }, [sessionToken, supplierId]);

  useEffect(() => {
    if (supplierId) {
      fetchOrders();
      fetchSupplierRating();
    }
  }, [supplierId]);

  const fetchSupplierRating = async () => {
    if (supplierId === "demo") {
      setSupplierAvgRating(4.6);
      setSupplierReviewCount(23);
      return;
    }
    try {
      const { data: products } = await supabase
        .from("products")
        .select("id")
        .eq("supplier_id", supplierId);
      
      if (products?.length) {
        const { data: reviews } = await supabase
          .from("reviews")
          .select("rating")
          .in("product_id", products.map(p => p.id));
        
        if (reviews?.length) {
          const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
          setSupplierAvgRating(Math.round(avg * 10) / 10);
          setSupplierReviewCount(reviews.length);
        }
      }
    } catch (err) {
      console.error("Error fetching supplier rating:", err);
    }
  };

  const getMarkupTier = () => {
    if (supplierAvgRating === null) return { markup: 33, label: "Стандарт", next: "Отримайте 4.5+ для 28%" };
    if (supplierAvgRating >= 4.8 && supplierReviewCount >= 50) return { markup: 25, label: "Преміум", next: "Максимальна знижка!" };
    if (supplierAvgRating >= 4.5) return { markup: 28, label: "Знижена", next: `${supplierReviewCount}/50 відгуків для 25%` };
    return { markup: 33, label: "Стандарт", next: `Рейтинг ${supplierAvgRating}/4.5 для 28%` };
  };

  const handleRateCustomer = async (orderId: string, profileId: string) => {
    if (customerRating === 0) {
      toast.error("Оберіть оцінку");
      return;
    }
    try {
      await supabase.from("app_ratings").insert({
        rating: customerRating,
        rating_type: "customer",
        rated_profile_id: profileId,
        order_id: orderId,
      });
      toast.success(`Оцінку клієнта збережено: ${customerRating}/5`);
      setShowCustomerRating(false);
      setCustomerRating(0);
    } catch (err) {
      console.error("Error rating customer:", err);
      toast.error("Помилка збереження оцінки");
    }
  };

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      // Demo/fallback mode - use mock data directly
      if (supplierId === "demo") {
        setOrders(MOCK_ORDERS.map(o => ({ ...o, customer_name: o.delivery_address.recipient_name })));
        setUseMockData(true);
        setIsLoading(false);
        return;
      }

      const { data: supplierProducts } = await supabase
        .from("products")
        .select("id")
        .eq("supplier_id", supplierId);

      const productIds = (supplierProducts || []).map(p => p.id);
      if (productIds.length === 0) {
        // Fallback to mock data
        setOrders(MOCK_ORDERS.map(o => ({ ...o, customer_name: o.delivery_address.recipient_name })));
        setUseMockData(true);
        setIsLoading(false);
        return;
      }

      const { data: orderItems } = await supabase
        .from("order_items")
        .select("order_id, product_name, product_image, quantity, price, size, color")
        .in("product_id", productIds);

      const orderIds = [...new Set((orderItems || []).map(oi => oi.order_id).filter(Boolean))];
      if (orderIds.length === 0) {
        setOrders(MOCK_ORDERS.map(o => ({ ...o, customer_name: o.delivery_address.recipient_name })));
        setUseMockData(true);
        setIsLoading(false);
        return;
      }

      const { data: ordersData } = await supabase
        .from("orders")
        .select("id, order_number, status, total, subtotal, delivery_tracking, delivery_service, delivery_cost, payment_method, payment_status, notes, created_at, updated_at, profile_id")
        .in("id", orderIds as string[])
        .order("created_at", { ascending: false })
        .limit(50);

      const profileIds = [...new Set((ordersData || []).map(o => o.profile_id).filter(Boolean))];
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

      const combined: SupplierOrder[] = (ordersData || []).map(o => ({
        id: o.id,
        order_number: o.order_number || o.id.slice(0, 8),
        status: o.status || "pending",
        payment_status: o.payment_status || "pending",
        payment_method: o.payment_method || "cod",
        subtotal: o.subtotal || 0,
        delivery_cost: o.delivery_cost || 0,
        total: o.total || 0,
        notes: o.notes || null,
        delivery_tracking: o.delivery_tracking || null,
        delivery_service: o.delivery_service || "nova_poshta",
        created_at: o.created_at,
        updated_at: o.updated_at,
        items: (orderItems || []).filter(oi => oi.order_id === o.id).map((oi, idx) => ({
          id: `item-${idx}`,
          product_id: "",
          product_name: oi.product_name,
          product_image: oi.product_image || "",
          quantity: oi.quantity,
          price: oi.price,
          size: oi.size,
          color: oi.color,
          total: oi.quantity * oi.price,
        })),
        delivery_address: {
          city: "",
          warehouse_number: null,
          street_address: null,
          building_number: null,
          recipient_name: profileMap[o.profile_id || ""] || "Клієнт",
          phone: "",
        },
        customer_name: profileMap[o.profile_id || ""] || "Клієнт",
      }));

      setOrders(combined);
      setUseMockData(false);
    } catch (err) {
      console.error("Error fetching supplier orders:", err);
      setOrders(MOCK_ORDERS.map(o => ({ ...o, customer_name: o.delivery_address.recipient_name })));
      setUseMockData(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTtn = async (orderId: string) => {
    if (!ttnInput.trim()) return;
    setIsSavingTtn(true);
    try {
      if (!useMockData) {
        const { error } = await supabase
          .from("orders")
          .update({ delivery_tracking: ttnInput.trim(), status: "shipped" })
          .eq("id", orderId);
        if (error) throw error;
      }
      toast.success("ТТН збережено, статус → Відправлено");
      setTtnInput("");
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? { ...prev, delivery_tracking: ttnInput.trim(), status: "shipped" } : null);
      }
    } catch (err) {
      toast.error("Помилка збереження ТТН");
    } finally {
      setIsSavingTtn(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      if (!useMockData) {
        const { error } = await supabase
          .from("orders")
          .update({ status: newStatus })
          .eq("id", orderId);
        if (error) throw error;
      }
      const label = statusConfig[newStatus]?.label || newStatus;
      toast.success(`Статус змінено → ${label}`);
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err) {
      toast.error("Помилка зміни статусу");
    }
  };

  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const filteredOrders = useMemo(() => {
    let result = orders.filter(o =>
      mode === "history" ? isArchivedOrder(o) : !isArchivedOrder(o)
    );
    result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (mode === "history") {
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        result = result.filter(o => new Date(o.created_at) >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        result = result.filter(o => new Date(o.created_at) <= to);
      }
    }
    return result;
  }, [orders, mode, dateFrom, dateTo]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const title = mode === "history" ? "Історія замовлень" : "Замовлення з моїми товарами";

  const markupTier = getMarkupTier();

  return (
    <div className="space-y-4">
      {/* Rating Tier Banner */}
      {supplierAvgRating !== null && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-warning fill-warning" />
              <span className="font-semibold text-foreground">{supplierAvgRating}</span>
              <span className="text-xs text-muted-foreground">({supplierReviewCount} відгуків)</span>
            </div>
            <Badge variant="outline" className="text-xs">
              Націнка: {markupTier.markup}% ({markupTier.label})
            </Badge>
          </div>
          <div className="w-full bg-muted rounded-full h-2 mb-1">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, (supplierAvgRating / 5) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{markupTier.next}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          {mode === "history" ? <Archive className="h-5 w-5 text-muted-foreground" /> : <Package className="h-5 w-5 text-primary" />}
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{filteredOrders.length}</Badge>
          <Button variant="ghost" size="sm" onClick={fetchOrders}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {useMockData && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-warning flex-shrink-0" />
          <p className="text-xs text-foreground">Тестові замовлення для перегляду функціоналу</p>
        </div>
      )}

      {mode === "history" && (
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {dateFrom ? format(dateFrom, "dd.MM.yy", { locale: uk }) : "Від"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={setDateFrom}
                disabled={dateTo ? (date) => date > dateTo : undefined}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground text-sm">—</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {dateTo ? format(dateTo, "dd.MM.yy", { locale: uk }) : "До"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={setDateTo}
                disabled={dateFrom ? (date) => date < dateFrom : undefined}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
              Скинути
            </Button>
          )}
        </div>
      )}

      <ScrollArea className="h-[calc(100vh-380px)]">
        <div className="space-y-3 pr-2">
          {filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {mode === "history" ? "Архів порожній" : "Немає активних замовлень"}
              </p>
            </div>
          ) : (
            filteredOrders.map(order => {
              const status = statusConfig[order.status] || statusConfig.pending;
              const StatusIcon = status.icon;
              return (
                <Card key={order.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => {
                  setSelectedOrder(order);
                  setTtnInput(order.delivery_tracking || "");
                }}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-foreground">{order.order_number}</span>
                      <div className="flex items-center gap-1.5">
                        {order.status === "pending" && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground">
                            <Sparkles className="h-2.5 w-2.5" /> Нове
                          </span>
                        )}
                        <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", status.bgColor, status.color)}>
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                        </div>
                      </div>
                    </div>
                    {paymentMap[order.id] && (
                      <div className="mb-2">
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold", payStageStyle[paymentMap[order.id]]?.cls)}>
                          {payStageStyle[paymentMap[order.id]]?.label}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                      <span>{order.customer_name || order.delivery_address.recipient_name}</span>
                      <span className="font-bold text-foreground">{order.total?.toLocaleString()} ₴</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{formatDate(order.created_at)}</span>
                      <div className="flex items-center gap-2">
                        {order.delivery_tracking && (
                          <span className="text-xs text-primary flex items-center gap-1">
                            <Truck className="h-3 w-3" />
                            {order.delivery_tracking}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* History button (only in active mode) */}
      {mode === "active" && (
        <button
          onClick={() => {
            hapticSelection();
            navigate("/store-orders-history");
          }}
          className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-card border-border hover:border-muted-foreground/50"
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-muted">
            <Archive className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-medium text-foreground">Історія замовлень</h4>
            <p className="text-xs text-muted-foreground">Завершені, скасовані, обміняні</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      )}

      {/* Order Detail Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {selectedOrder?.order_number}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (() => {
            const status = statusConfig[selectedOrder.status] || statusConfig.pending;
            const StatusIcon = status.icon;
            const isDeliveredOrReceived = ["delivered", "received"].includes(selectedOrder.status);
            const deliveryDate = new Date(selectedOrder.updated_at);
            const daysSinceDelivery = Math.floor((Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
            const daysLeftForReturn = Math.max(0, 14 - daysSinceDelivery);
            const canRequestReturnExchange = isDeliveredOrReceived && daysSinceDelivery <= 14;

            return (
              <div className="space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Статус</span>
                  <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", status.bgColor, status.color)}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {status.label}
                  </div>
                </div>

                {/* Customer */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Клієнт</span>
                  <span className="text-sm font-medium">{selectedOrder.customer_name || selectedOrder.delivery_address.recipient_name}</span>
                </div>

                {/* Total */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Сума</span>
                  <span className="text-sm font-bold">{selectedOrder.total?.toLocaleString()} ₴</span>
                </div>

                {/* Items */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Товари:</p>
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 bg-muted rounded-lg">
                      {item.product_image ? (
                        <img src={item.product_image} className="w-10 h-10 rounded object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted-foreground/10 flex items-center justify-center">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} × {item.price?.toLocaleString()} ₴
                          {item.size && ` • ${item.size}`}
                          {item.color && ` • ${item.color}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* TTN input - for pending/processing */}
                {(selectedOrder.status === "pending" || selectedOrder.status === "processing") && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Додати ТТН (номер відстеження):</p>
                    <div className="flex gap-2">
                      <Input
                        value={ttnInput}
                        onChange={e => setTtnInput(e.target.value)}
                        placeholder="20450000000000"
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSaveTtn(selectedOrder.id)}
                        disabled={isSavingTtn || !ttnInput.trim()}
                      >
                        {isSavingTtn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Existing TTN */}
                {selectedOrder.delivery_tracking && (
                  <div className="p-3 bg-primary/5 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">ТТН</p>
                    <p className="text-sm font-mono font-bold text-foreground">{selectedOrder.delivery_tracking}</p>
                  </div>
                )}

                {/* Return/exchange window info */}
                {isDeliveredOrReceived && (
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
                    {canRequestReturnExchange ? (
                      <p className="text-xs text-foreground">
                        ⏳ Клієнт може подати на обмін/повернення. Залишилось <strong>{daysLeftForReturn}</strong> {daysLeftForReturn === 1 ? "день" : daysLeftForReturn < 5 ? "дні" : "днів"}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">✅ Термін обміну/повернення (14 днів) минув</p>
                    )}
                  </div>
                )}

                {/* Status change actions */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Змінити статус</p>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedOrder.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(selectedOrder.id, "processing")} className="gap-1.5">
                        <Package className="h-3.5 w-3.5 text-blue-500" /> В обробку
                      </Button>
                    )}
                    {(selectedOrder.status === "pending" || selectedOrder.status === "processing") && (
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(selectedOrder.id, "cancelled")} className="gap-1.5 text-destructive">
                        <XCircle className="h-3.5 w-3.5" /> Скасувати
                      </Button>
                    )}
                    {selectedOrder.status === "shipped" && (
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(selectedOrder.id, "delivered")} className="gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Доставлено
                      </Button>
                    )}
                    {selectedOrder.status === "delivered" && (
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(selectedOrder.id, "received")} className="gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Отримано
                      </Button>
                    )}
                  </div>
                </div>

                {/* Customer Rating - for received orders */}
                {["received", "delivered"].includes(selectedOrder.status) && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Оцінка клієнта</p>
                    {showCustomerRating ? (
                      <div className="space-y-3 bg-muted/50 rounded-xl p-3">
                        <p className="text-sm text-foreground">Оцініть клієнта:</p>
                        <div className="flex justify-center gap-2">
                          {[1, 2, 3, 4, 5].map(s => (
                            <button key={s} onClick={() => setCustomerRating(s)} className="p-1">
                              <Star className={cn("h-8 w-8", s <= customerRating ? "text-warning fill-warning" : "text-muted-foreground/30")} />
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => { setShowCustomerRating(false); setCustomerRating(0); }} className="flex-1">
                            Скасувати
                          </Button>
                          <Button size="sm" onClick={() => handleRateCustomer(selectedOrder.id, selectedOrder.profile_id || "")} className="flex-1">
                            Зберегти
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setShowCustomerRating(true)} className="w-full gap-2">
                        <UserCheck className="h-4 w-4" />
                        Оцінити клієнта
                      </Button>
                    )}
                  </div>
                )}

                {/* Notes */}
                {selectedOrder.notes && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Коментар клієнта</p>
                    <p className="text-sm text-foreground">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  Package, Truck, CheckCircle2, Clock, XCircle, ChevronDown, ChevronUp,
  Eye, Loader2, MapPin, RefreshCw, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MOCK_ORDERS, MockOrder } from '@/data/mockOrders';

const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  pending: { label: 'Очікує', color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  processing: { label: 'В обробці', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  shipped: { label: 'Відправлено', color: 'text-purple-600', bgColor: 'bg-purple-100' },
  delivered: { label: 'Доставлено', color: 'text-green-600', bgColor: 'bg-green-100' },
  cancelled: { label: 'Скасовано', color: 'text-red-600', bgColor: 'bg-red-100' },
};

interface DBOrder {
  id: string;
  order_number: string | null;
  status: string | null;
  total: number;
  subtotal: number;
  delivery_cost: number | null;
  delivery_service: string | null;
  delivery_tracking: string | null;
  payment_method: string | null;
  payment_status: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  profile_id: string | null;
  items: { id: string; product_name: string; product_image: string | null; quantity: number; price: number; total: number; size: string | null; color: string | null }[];
  delivery_address?: { city: string; warehouse_number: string | null; recipient_name: string; phone: string } | null;
}

export function OrdersManager() {
  const [orders, setOrders] = useState<(MockOrder | DBOrder)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const { data: dbOrders, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      if (dbOrders && dbOrders.length > 0) {
        // Fetch order items for all orders
        const orderIds = dbOrders.map(o => o.id);
        const { data: items } = await supabase
          .from("order_items")
          .select("*")
          .in("order_id", orderIds);

        // Fetch delivery addresses
        const addressIds = dbOrders.map(o => o.delivery_address_id).filter(Boolean);
        let addressMap: Record<string, any> = {};
        if (addressIds.length > 0) {
          const { data: addresses } = await supabase
            .from("delivery_addresses")
            .select("id, city, warehouse_number, recipient_name, phone")
            .in("id", addressIds as string[]);
          (addresses || []).forEach(a => { addressMap[a.id] = a; });
        }

        const enrichedOrders: DBOrder[] = dbOrders.map(o => ({
          ...o,
          items: (items || []).filter(i => i.order_id === o.id),
          delivery_address: o.delivery_address_id ? addressMap[o.delivery_address_id] || null : null,
        }));

        setOrders(enrichedOrders);
        setUsingMock(false);
      } else {
        setOrders(MOCK_ORDERS);
        setUsingMock(true);
      }
    } catch (err) {
      console.error("Error fetching orders:", err);
      setOrders(MOCK_ORDERS);
      setUsingMock(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    if (usingMock) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus, updated_at: new Date().toISOString() } : o));
      toast.success(`Статус змінено на "${statusConfig[newStatus]?.label}"`);
      return;
    }

    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", orderId);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus, updated_at: new Date().toISOString() } : o));
      toast.success(`Статус змінено на "${statusConfig[newStatus]?.label}"`);
    } catch (err) {
      toast.error("Помилка зміни статусу");
    }
  };

  const handleAddTracking = async (orderId: string) => {
    const tracking = trackingInputs[orderId];
    if (!tracking?.trim()) { toast.error("Введіть ТТН"); return; }

    if (usingMock) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, delivery_tracking: tracking, status: 'shipped' } : o));
      toast.success(`ТТН ${tracking} додано`);
      return;
    }

    try {
      const { error } = await supabase
        .from("orders")
        .update({ delivery_tracking: tracking, status: "shipped", updated_at: new Date().toISOString() })
        .eq("id", orderId);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, delivery_tracking: tracking, status: 'shipped' } : o));
      toast.success(`ТТН ${tracking} додано`);
    } catch (err) {
      toast.error("Помилка додавання ТТН");
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const filteredOrders = orders.filter(o => {
    const status = o.status || 'pending';
    if (filterStatus !== "all" && status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const orderNum = ('order_number' in o ? o.order_number : '') || '';
      const tracking = ('delivery_tracking' in o ? o.delivery_tracking : '') || '';
      if (!orderNum.toLowerCase().includes(q) && !tracking.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const statusCounts = {
    all: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    processing: orders.filter(o => o.status === 'processing').length,
    shipped: orders.filter(o => o.status === 'shipped').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-380px)]">
      <div className="space-y-4 pr-4">
        {/* Search & Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Пошук за номером або ТТН..."
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchOrders}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {usingMock && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-2 flex items-center gap-2">
            <Package className="h-4 w-4 text-warning" />
            <p className="text-xs text-foreground">Тестові дані (немає замовлень у базі)</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Всього', count: statusCounts.all, color: 'bg-primary/10 text-primary', filter: 'all' },
            { label: 'Нові', count: statusCounts.pending, color: 'bg-yellow-100 text-yellow-700', filter: 'pending' },
            { label: 'Обробка', count: statusCounts.processing, color: 'bg-blue-100 text-blue-700', filter: 'processing' },
            { label: 'Відправ.', count: statusCounts.shipped, color: 'bg-purple-100 text-purple-700', filter: 'shipped' },
            { label: 'Достав.', count: statusCounts.delivered, color: 'bg-green-100 text-green-700', filter: 'delivered' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => setFilterStatus(s.filter)}
              className={cn(
                "rounded-lg p-2 text-center transition-all",
                s.color,
                filterStatus === s.filter && "ring-2 ring-primary ring-offset-1"
              )}
            >
              <p className="text-lg font-bold">{s.count}</p>
              <p className="text-[10px]">{s.label}</p>
            </button>
          ))}
        </div>

        {/* Orders list */}
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Немає замовлень</p>
          </div>
        ) : filteredOrders.map((order: any) => {
          const st = statusConfig[order.status || 'pending'] || statusConfig.pending;
          const isExpanded = expandedId === order.id;
          const orderNumber = order.order_number || order.id?.slice(0, 8) || '';
          const items: any[] = order.items || [];
          const deliveryTracking = order.delivery_tracking || null;
          const deliveryAddress = order.delivery_address || null;
          const notes = order.notes || null;
          const paymentMethod = order.payment_method || null;
          const paymentStatus = order.payment_status || null;

          return (
            <Card key={order.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{orderNumber}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(order.created_at)}</p>
                  </div>
                  <Badge className={cn(st.bgColor, st.color, "border-0")}>{st.label}</Badge>
                </div>

                <div className="flex gap-2 overflow-x-auto">
                  {items.slice(0, 4).map((item: any, idx: number) => (
                    <div key={item.id || idx} className="flex items-center gap-2 bg-muted/50 rounded-lg p-2 min-w-0 flex-shrink-0">
                      {item.product_image && <img src={item.product_image} alt="" className="w-8 h-8 rounded object-cover" />}
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate max-w-[120px]">{item.product_name}</p>
                        <p className="text-xs text-muted-foreground">{item.quantity} × {(item.price || 0).toLocaleString()} ₴</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-primary">{order.total.toLocaleString()} ₴</span>
                  <button onClick={() => setExpandedId(isExpanded ? null : order.id)} className="flex items-center gap-1 text-xs text-primary">
                    <Eye className="h-3.5 w-3.5" />
                    {isExpanded ? 'Згорнути' : 'Керувати'}
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="space-y-3 pt-3 border-t border-border">
                    {deliveryAddress && (
                      <div className="flex items-start gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-foreground">{deliveryAddress.city}{deliveryAddress.warehouse_number && `, Від. №${deliveryAddress.warehouse_number}`}</p>
                          <p className="text-muted-foreground">{deliveryAddress.recipient_name}, {deliveryAddress.phone}</p>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-xs">Змінити статус</Label>
                      <Select value={order.status || 'pending'} onValueChange={(v) => handleStatusChange(order.id, v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Очікує обробки</SelectItem>
                          <SelectItem value="processing">В обробці</SelectItem>
                          <SelectItem value="shipped">Відправлено</SelectItem>
                          <SelectItem value="delivered">Доставлено</SelectItem>
                          <SelectItem value="cancelled">Скасовано</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {!deliveryTracking && (
                      <div className="space-y-2">
                        <Label className="text-xs">Додати ТТН</Label>
                        <div className="flex gap-2">
                          <Input
                            value={trackingInputs[order.id] || ''}
                            onChange={e => setTrackingInputs(prev => ({ ...prev, [order.id]: e.target.value }))}
                            placeholder="20450000000000"
                            className="flex-1"
                          />
                          <Button size="sm" onClick={() => handleAddTracking(order.id)}>
                            <Truck className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {deliveryTracking && (
                      <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">ТТН:</span>
                        <span className="font-mono text-foreground">{deliveryTracking}</span>
                      </div>
                    )}

                    {notes && (
                      <div className="bg-muted/50 rounded-lg p-2 text-sm">
                        <p className="text-xs text-muted-foreground">Коментар клієнта:</p>
                        <p className="text-foreground">{notes}</p>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Оплата: {paymentMethod === 'card' ? 'Карткою' : 'Накладний платіж'} • {paymentStatus === 'paid' ? '✓ Оплачено' : 'Очікує'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}

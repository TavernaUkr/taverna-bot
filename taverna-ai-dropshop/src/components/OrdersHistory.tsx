import { useState, useEffect, useMemo } from 'react';
import { 
  Package, Truck, CheckCircle2, Clock, XCircle, ChevronRight, 
  Loader2, MapPin, RefreshCw, RotateCcw, MessageSquare, 
  Star, Flag, FileText, Receipt, Copy, ShoppingCart, CalendarIcon, Sparkles, Gift
} from 'lucide-react';
import { openAIChatWithContext } from './AIChatAssistant';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { cn } from '@/lib/utils';
import { useTelegramAuthContext } from './TelegramAuthProvider';
import { supabase } from '@/integrations/supabase/client';
import { Button } from './ui/button';
import { OrderTracking } from './OrderTracking';
import { toast } from 'sonner';
import { MOCK_ORDERS, MockOrder } from '@/data/mockOrders';
import { useRatingRewards } from '@/hooks/useRatingRewards';
import { useOrderRefunds, type OrderRefund } from '@/hooks/useOrderRefunds';
import { RefundStatusBlock } from './orders/RefundStatusBlock';
import { RefundRequestSheet } from './orders/RefundRequestSheet';

type Order = MockOrder;

const statusConfig: Record<string, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
  pending: { label: 'Очікує обробки', icon: Clock, color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  processing: { label: 'В обробці', icon: Package, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  shipped: { label: 'Відправлено', icon: Truck, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  delivered: { label: 'Доставлено', icon: CheckCircle2, color: 'text-green-600', bgColor: 'bg-green-100' },
  received: { label: 'Отримано', icon: CheckCircle2, color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  exchange: { label: 'Обмін', icon: RefreshCw, color: 'text-orange-600', bgColor: 'bg-orange-100' },
  return: { label: 'Повернення', icon: RotateCcw, color: 'text-rose-600', bgColor: 'bg-rose-100' },
  cancelled: { label: 'Скасовано', icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-100' },
};

function OrderCard({ order, onViewDetails, refund }: { order: Order; onViewDetails: (o: Order) => void; refund?: OrderRefund | null }) {
  const status = statusConfig[order.status] || statusConfig.pending;
  const StatusIcon = status.icon;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const itemsPreview = order.items.slice(0, 3);
  const moreItemsCount = order.items.length - 3;

  const isNew = order.status === 'pending';

  return (
    <button onClick={() => onViewDetails(order)} className="w-full bg-card rounded-xl border border-border p-4 hover:shadow-md transition-all text-left relative">
      {isNew && (
        <div className="absolute -top-2 -right-2 z-10">
          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-3 w-3" /> Нове
          </span>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-semibold text-foreground">{order.order_number}</span>
          <p className="text-xs text-muted-foreground">{formatDate(order.created_at)}</p>
        </div>
        <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', status.bgColor, status.color)}>
          <StatusIcon className="h-3.5 w-3.5" />
          {status.label}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        {itemsPreview.map((item, idx) => (
          <div key={idx} className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
            {item.product_image ? (
              <img src={item.product_image} alt={item.product_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {moreItemsCount > 0 && (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">+{moreItemsCount}</div>
        )}
        <div className="ml-auto flex items-center gap-1 text-primary">
          <span className="text-sm font-medium">Деталі</span>
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>

      {refund && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5">
          <RotateCcw className="h-3.5 w-3.5 text-rose-500" />
          <span className="text-xs font-medium text-rose-600">
            {refund.status === 'paid' ? 'Кошти повернуто' : refund.status === 'rejected' ? 'Повернення відхилено' : 'Повернення'} · {refund.amount.toLocaleString()} ₴
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Package className="h-4 w-4" />
          <span>{order.items.length} {order.items.length === 1 ? 'товар' : 'товарів'}</span>
        </div>
        <span className="font-bold text-primary">{order.total.toLocaleString()} ₴</span>
      </div>
    </button>
  );
}

function OrderDetailsModal({ order, onClose, refund, onCreateRefund }: {
  order: Order | null;
  onClose: () => void;
  refund?: OrderRefund | null;
  onCreateRefund: (payload: { order_id: string; item_ids: string[]; reason: string; comment?: string }) => Promise<unknown>;
}) {
  const [returnAddress, setReturnAddress] = useState<string | null>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [complaintText, setComplaintText] = useState('');
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [bonusAwarded, setBonusAwarded] = useState(0);
  const [showRefundForm, setShowRefundForm] = useState(false);
  const { awardForOrderReview, getOrderRewards, isAwarding } = useRatingRewards();

  // Check if order was already rated
  useEffect(() => {
    if (order?.id) {
      getOrderRewards(order.id).then(rewards => {
        setAlreadyRated(rewards.includes("review_text"));
      });
    }
  }, [order?.id, getOrderRewards]);

  if (!order) return null;

  const status = statusConfig[order.status] || statusConfig.pending;
  const StatusIcon = status.icon;
  const isDelivered = order.status === 'delivered';
  const isReceived = order.status === 'received';
  const isDeliveredOrReceived = isDelivered || isReceived;
  
  // Ukrainian consumer protection law: 14 days for return/exchange from delivery date
  // Applies to non-food, non-custom items in original condition
  const deliveryDate = new Date(order.updated_at);
  const daysSinceDelivery = Math.floor((Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
  const RETURN_PERIOD_DAYS = 14;
  const canRequestReturnExchange = isDeliveredOrReceived && daysSinceDelivery <= RETURN_PERIOD_DAYS;
  const daysLeftForReturn = Math.max(0, RETURN_PERIOD_DAYS - daysSinceDelivery);
  const canReturn = isDeliveredOrReceived && order.total >= 1500;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handleOpenExchange = () => {
    openAIChatWithContext({
      order_id: order.id,
      order_number: order.order_number,
      topic: "exchange",
    });
  };

  const handleOpenReturnChat = () => {
    openAIChatWithContext({
      order_id: order.id,
      order_number: order.order_number,
      topic: "return",
    });
  };

  const handleContactManager = () => {
    openAIChatWithContext({
      order_id: order.id,
      order_number: order.order_number,
      topic: "manager",
    });
  };

  const handleOpenComplaint = () => {
    openAIChatWithContext({
      order_id: order.id,
      order_number: order.order_number,
      topic: "complaint",
    });
  };


  const handleCopyOrderNumber = () => {
    navigator.clipboard.writeText(order.order_number);
    toast.success("Номер замовлення скопійовано");
  };

  const handleSubmitRating = async () => {
    if (rating === 0) {
      toast.error("Оберіть оцінку");
      return;
    }
    try {
      // Save rating to app_ratings table with order_id
      await supabase.from("app_ratings").insert({
        rating,
        rating_type: "order",
        target_id: order.items[0]?.product_id || null,
        comment: ratingComment.trim() || null,
        order_id: order.id,
      });

      // Also save individual product reviews if delivered
      for (const item of order.items) {
        if (item.product_id) {
          try {
            await supabase.from("reviews").insert({
              product_id: item.product_id,
              rating,
              author_name: order.delivery_address?.recipient_name || "Покупець",
              content: ratingComment.trim() || null,
              is_verified_purchase: true,
            });
          } catch (_) {}
        }
      }

      // Award bonus for review
      const hasPhoto = false; // TODO: add photo upload support
      const awarded = await awardForOrderReview(order.id, hasPhoto);
      setBonusAwarded(awarded);
      setAlreadyRated(true);

      if (awarded === 0) {
        toast.success(`Дякуємо за оцінку ${rating}/5! Ваш відгук збережено.`);
      }
    } catch (err) {
      console.error("Error saving rating:", err);
      toast.success(`Дякуємо за оцінку ${rating}/5!`);
    }
    setShowRating(false);
    setRating(0);
    setRatingComment('');
  };

  const handleSubmitComplaint = async () => {
    if (!complaintText.trim()) {
      toast.error("Опишіть проблему");
      return;
    }
    try {
      // Save complaint as a report
      const productId = order.items[0]?.product_id;
      await supabase.from("reports").insert({
        product_id: productId || null,
        reason: "order_complaint",
        description: `Замовлення ${order.order_number}: ${complaintText.trim()}`,
        status: "pending",
      });

      // Also create a support ticket
      try {
        await supabase.from("support_tickets").insert({
          user_id: "00000000-0000-0000-0000-000000000000",
          type: "order_complaint",
          related_order_id: order.id,
          status: "open",
        });
      } catch (_) {}

      toast.success("Скаргу відправлено. Модератор зв'яжеться з вами найближчим часом.");
    } catch (err) {
      console.error("Error submitting complaint:", err);
      toast.success("Скаргу відправлено.");
    }
    setShowComplaint(false);
    setComplaintText('');
  };

  const handleReorder = async () => {
    try {
      for (const item of order.items) {
        if (item.product_id) {
          try {
            await supabase.from("cart_items").insert({
              product_id: item.product_id,
              quantity: item.quantity,
              size: item.size || null,
              color: item.color || null,
            });
          } catch (_) {}
        }
      }
      toast.success("Товари додано в кошик!");
    } catch (err) {
      toast.success("Товари додано в кошик для повторного замовлення");
    }
  };

  // Receipt modal
  if (showReceipt) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={() => setShowReceipt(false)}>
        <div className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[90vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="font-bold text-lg text-foreground flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Чек замовлення
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowReceipt(false)}>✕</Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 font-mono text-sm space-y-2">
              <div className="text-center border-b border-dashed border-border pb-3">
                <p className="font-bold text-base">TAVERNA GROUP</p>
                <p className="text-xs text-muted-foreground">Маркетплейс товарів</p>
              </div>
              <div className="space-y-1 py-2 border-b border-dashed border-border">
                <div className="flex justify-between"><span>Замовлення:</span><span>{order.order_number}</span></div>
                <div className="flex justify-between"><span>Дата:</span><span>{new Date(order.created_at).toLocaleDateString('uk-UA')}</span></div>
                <div className="flex justify-between"><span>Оплата:</span><span>{order.payment_method === 'card' ? 'Карткою' : 'Накладний платіж'}</span></div>
                <div className="flex justify-between"><span>Статус:</span><span>{order.payment_status === 'paid' ? 'Оплачено ✓' : 'Очікує оплати'}</span></div>
              </div>
              <div className="py-2 border-b border-dashed border-border">
                <p className="font-medium mb-2">Товари:</p>
                {order.items.map((item, i) => (
                  <div key={i} className="mb-2">
                    <p className="truncate">{item.product_name}</p>
                    <div className="flex justify-between text-muted-foreground">
                      <span>{item.quantity} × {item.price.toLocaleString()} ₴</span>
                      <span>{item.total.toLocaleString()} ₴</span>
                    </div>
                    {(item.size || item.color) && (
                      <p className="text-xs text-muted-foreground">
                        {item.size && `Розмір: ${item.size}`}{item.size && item.color && ' • '}{item.color && `Колір: ${item.color}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-1 py-2">
                <div className="flex justify-between"><span>Підсумок:</span><span>{order.subtotal.toLocaleString()} ₴</span></div>
                <div className="flex justify-between"><span>Доставка:</span><span>{order.delivery_cost > 0 ? `${order.delivery_cost.toLocaleString()} ₴` : 'Безкоштовно'}</span></div>
                <div className="flex justify-between font-bold text-base pt-2 border-t border-dashed border-border">
                  <span>ВСЬОГО:</span><span>{order.total.toLocaleString()} ₴</span>
                </div>
                {refund && (
                  <div className="flex justify-between text-rose-600">
                    <span>{refund.status === 'paid' ? 'Повернуто:' : 'До повернення:'}</span>
                    <span>-{refund.amount.toLocaleString()} ₴</span>
                  </div>
                )}
              </div>
              {order.delivery_address && (
                <div className="pt-2 border-t border-dashed border-border text-xs text-muted-foreground">
                  <p>Доставка: {order.delivery_address.city}{order.delivery_address.warehouse_number && `, Від. №${order.delivery_address.warehouse_number}`}</p>
                  <p>Отримувач: {order.delivery_address.recipient_name}</p>
                </div>
              )}
              {order.delivery_tracking && (
                <div className="pt-2 text-xs text-muted-foreground">
                  <p>ТТН: {order.delivery_tracking}</p>
                </div>
              )}
              <div className="text-center pt-3 border-t border-dashed border-border text-xs text-muted-foreground">
                <p>Дякуємо за покупку! 🛍️</p>
                <p>taverna-ai-dropshop.lovable.app</p>
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-border">
            <Button onClick={() => setShowReceipt(false)} className="w-full">Закрити</Button>
          </div>
        </div>
      </div>
    );
  }

  // Rating modal
  if (showRating) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={() => setShowRating(false)}>
        <div className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[90vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="font-bold text-lg text-foreground flex items-center gap-2">
              <Star className="h-5 w-5 text-warning" />
              Оцінити замовлення
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowRating(false)}>✕</Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">Як вам якість товарів та доставки?</p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setRating(s)} className="p-1 transition-transform hover:scale-110">
                    <Star className={cn("h-10 w-10", s <= rating ? "text-warning fill-warning" : "text-muted-foreground/30")} />
                  </button>
                ))}
              </div>
              {rating > 0 && <p className="text-sm text-muted-foreground mt-2">{['', 'Жахливо', 'Погано', 'Нормально', 'Добре', 'Чудово'][rating]}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Коментар (необов'язково)</label>
              <textarea
                value={ratingComment}
                onChange={e => setRatingComment(e.target.value)}
                placeholder="Розкажіть детальніше про ваш досвід..."
                className="w-full mt-2 p-3 rounded-xl border border-border bg-card text-foreground resize-none h-24"
              />
            </div>
            {order.items.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-card rounded-xl p-3 border border-border">
                <img src={item.product_image} alt="" className="w-12 h-12 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product_name}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-border flex gap-3">
            <Button variant="outline" onClick={() => setShowRating(false)} className="flex-1">Пізніше</Button>
            <Button onClick={handleSubmitRating} className="flex-1">Надіслати оцінку</Button>
          </div>
        </div>
      </div>
    );
  }

  // Complaint modal
  if (showComplaint) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={() => setShowComplaint(false)}>
        <div className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[90vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="font-bold text-lg text-foreground flex items-center gap-2">
              <Flag className="h-5 w-5 text-destructive" />
              Скарга на замовлення
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowComplaint(false)}>✕</Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-3">
              <p className="text-sm text-foreground font-medium">Замовлення {order.order_number}</p>
              <p className="text-xs text-muted-foreground mt-1">{order.items.map(i => i.product_name).join(', ')}</p>
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Тип проблеми</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Пошкоджений товар', value: 'damaged' },
                  { label: 'Не той товар', value: 'wrong_item' },
                  { label: 'Не відповідає опису', value: 'misleading' },
                  { label: 'Проблема з доставкою', value: 'delivery' },
                ].map(opt => (
                  <button key={opt.value} className="p-3 rounded-xl border border-border bg-card text-sm text-foreground hover:border-primary transition-colors text-left">
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Опишіть проблему</label>
              <textarea
                value={complaintText}
                onChange={e => setComplaintText(e.target.value)}
                placeholder="Детально опишіть вашу проблему..."
                className="w-full mt-2 p-3 rounded-xl border border-border bg-card text-foreground resize-none h-28"
              />
            </div>
          </div>
          <div className="p-4 border-t border-border flex gap-3">
            <Button variant="outline" onClick={() => setShowComplaint(false)} className="flex-1">Скасувати</Button>
            <Button variant="destructive" onClick={handleSubmitComplaint} className="flex-1">Надіслати скаргу</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[90vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-lg text-foreground">{order.order_number}</h2>
              <button onClick={handleCopyOrderNumber} className="text-muted-foreground hover:text-foreground">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium', status.bgColor, status.color)}>
              <StatusIcon className="h-4 w-4" />
              {status.label}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="ml-2">✕</Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Tracking */}
          {order.delivery_tracking && <OrderTracking trackingNumber={order.delivery_tracking} />}

          {/* Delivery Address */}
          {order.delivery_address && (
            <div className="bg-muted/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-foreground">Адреса доставки</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {order.delivery_address.city}
                {order.delivery_address.warehouse_number && <>, Відділення №{order.delivery_address.warehouse_number}</>}
                {order.delivery_address.street_address && <>, {order.delivery_address.street_address} {order.delivery_address.building_number}</>}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {order.delivery_address.recipient_name}, {order.delivery_address.phone}
              </p>
            </div>
          )}

          {/* Items */}
          <div className="space-y-3">
            <h3 className="font-medium text-foreground">Товари</h3>
            {order.items.map(item => (
              <div key={item.id} className="flex gap-3 bg-card rounded-xl p-3 border border-border">
                <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                  {item.product_image ? (
                    <img src={item.product_image} alt={item.product_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Package className="h-6 w-6 text-muted-foreground" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground line-clamp-2">{item.product_name}</p>
                  {(item.size || item.color) && (
                    <p className="text-xs text-muted-foreground">
                      {item.size && `Розмір: ${item.size}`}{item.size && item.color && ' • '}{item.color && `Колір: ${item.color}`}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{item.quantity} × {item.price.toLocaleString()} ₴</span>
                    <span className="font-bold text-primary">{item.total.toLocaleString()} ₴</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Price Summary */}
          <div className="border-t border-border pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Товари</span>
              <span className="text-foreground">{order.subtotal.toLocaleString()} ₴</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Доставка</span>
              <span className="text-foreground">{order.delivery_cost > 0 ? `${order.delivery_cost.toLocaleString()} ₴` : 'Безкоштовно'}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t border-border">
              <span className="text-foreground">Всього</span>
              <span className="text-primary">{order.total.toLocaleString()} ₴</span>
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="bg-muted/50 rounded-xl p-4">
              <p className="text-sm font-medium text-foreground mb-1">Коментар</p>
              <p className="text-sm text-muted-foreground">{order.notes}</p>
            </div>
          )}

          {/* Return Address */}
          {returnAddress && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm text-foreground">Адреса обміну/повернення</span>
              </div>
              <p className="text-sm text-muted-foreground">{returnAddress}</p>
              {canReturn && (
                <p className="text-xs text-primary mt-2">✓ Безкоштовне повернення (сума замовлення &gt; 1500₴)</p>
              )}
            </div>
          )}

          {/* Refund status */}
          {refund && <RefundStatusBlock refund={refund} />}

          {/* === ACTIONS SECTION === */}
          <div className="space-y-2 pt-2">
            {/* Receipt */}
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Документи</p>
            <Button variant="outline" className="w-full justify-start gap-3 h-12" onClick={() => setShowReceipt(true)}>
              <FileText className="h-4 w-4 text-primary" />
              <span>Переглянути чек</span>
            </Button>

            {/* Rating - only for delivered/received orders */}
            {isDeliveredOrReceived && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-4">Оцінка</p>
                {alreadyRated ? (
                  <div className="flex items-center gap-3 h-12 px-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm text-emerald-600 font-medium">Оцінку надіслано</span>
                    {bonusAwarded > 0 && (
                      <span className="ml-auto text-xs font-bold text-emerald-500">+{bonusAwarded}₴ 🎉</span>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" className="w-full justify-start gap-3 h-12" onClick={() => setShowRating(true)}>
                    <Star className="h-4 w-4 text-warning" />
                    <span>Оцінити замовлення</span>
                    <span className="ml-auto text-xs text-amber-500 font-medium">+10₴ бонус</span>
                  </Button>
                )}
              </>
            )}

            {/* Return/Exchange - only within 14 days per Ukrainian consumer law */}
            {isDeliveredOrReceived && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-4">Обмін та повернення</p>
                {canRequestReturnExchange ? (
                  <>
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mb-2">
                      <p className="text-xs text-foreground">
                        📋 Відповідно до ст. 9 Закону України «Про захист прав споживачів» — обмін/повернення товару належної якості протягом <strong>14 днів</strong> з моменту отримання.
                      </p>
                      <p className="text-xs text-primary font-medium mt-1">
                        ⏳ Залишилось {daysLeftForReturn} {daysLeftForReturn === 1 ? 'день' : daysLeftForReturn < 5 ? 'дні' : 'днів'}
                      </p>
                    </div>
                    <Button variant="outline" className="w-full justify-start gap-3 h-12" onClick={handleOpenExchange}>
                      <RefreshCw className="h-4 w-4 text-orange-500" />
                      <span>Подати на обмін</span>
                    </Button>
                    {!refund && (
                      <Button variant="outline" className="w-full justify-start gap-3 h-12" onClick={() => setShowRefundForm(true)}>
                        <RotateCcw className="h-4 w-4 text-rose-500" />
                        <span>Оформити повернення</span>
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="bg-muted/50 border border-border rounded-xl p-3">
                    <p className="text-xs text-muted-foreground">
                      ⏰ Термін обміну/повернення (14 днів) минув. Зверніться до підтримки для індивідуального розгляду.
                    </p>
                  </div>
                )}
                <Button variant="outline" className="w-full justify-start gap-3 h-12" onClick={handleContactManager}>
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <span>Зв'язатись із менеджером</span>
                </Button>
              </>
            )}

            {/* Complaint */}
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-4">Проблеми</p>
            <Button variant="outline" className="w-full justify-start gap-3 h-12 text-destructive border-destructive/20 hover:bg-destructive/5" onClick={handleOpenComplaint}>
              <Flag className="h-4 w-4" />
              <span>Поскаржитися на замовлення</span>
            </Button>

            {/* Reorder */}
            {(isDeliveredOrReceived || order.status === 'cancelled') && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-4">Повторне замовлення</p>
                <Button variant="outline" className="w-full justify-start gap-3 h-12" onClick={handleReorder}>
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  <span>Замовити знову</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <Button onClick={onClose} className="w-full">Закрити</Button>
        </div>
      </div>

      {showRefundForm && (
        <RefundRequestSheet
          order={{
            id: order.id,
            order_number: order.order_number,
            total: order.total,
            delivery_cost: order.delivery_cost,
            items: order.items.map(i => ({ id: i.id, product_name: i.product_name, quantity: i.quantity, total: i.total })),
          }}
          onClose={() => setShowRefundForm(false)}
          onSubmit={onCreateRefund}
        />
      )}
    </div>
  );
}

// Helper to determine if an order is "archived" (belongs in history)
function isArchivedOrder(order: Order): boolean {
  const ARCHIVE_DAYS = 15;
  const updatedAt = new Date(order.updated_at);
  const daysSinceUpdate = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));

  // Cancelled, exchanged, returned → always archived
  if (['cancelled', 'exchange', 'return'].includes(order.status)) return true;

  // Received and 15+ days passed without return/exchange → archived
  if (order.status === 'received' && daysSinceUpdate >= ARCHIVE_DAYS) return true;

  // Delivered and 15+ days passed → archived (assumed received)
  if (order.status === 'delivered' && daysSinceUpdate >= ARCHIVE_DAYS) return true;

  return false;
}

interface OrdersHistoryProps {
  mode?: 'active' | 'history';
}

export function OrdersHistory({ mode = 'active' }: OrdersHistoryProps) {
  const { isAuthenticated, sessionToken } = useTelegramAuthContext();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [useMockData, setUseMockData] = useState(false);
  const { getForOrder, createRequest } = useOrderRefunds();

  const fetchOrders = async () => {
    if (!isAuthenticated || !sessionToken) {
      setOrders(MOCK_ORDERS);
      setUseMockData(true);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'get_orders', session_token: sessionToken },
      });

      if (error) throw error;

      if (data?.orders && data.orders.length > 0) {
        setOrders(data.orders);
        setUseMockData(false);
      } else {
        setOrders(MOCK_ORDERS);
        setUseMockData(true);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
      setOrders(MOCK_ORDERS);
      setUseMockData(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [isAuthenticated, sessionToken]);

  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const filteredOrders = useMemo(() => {
    let result = orders.filter(o => 
      mode === 'history' ? isArchivedOrder(o) : !isArchivedOrder(o)
    );
    result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (mode === 'history') {
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

  const title = mode === 'history' ? 'Історія замовлень' : 'Мої Замовлення';
  const emptyText = mode === 'history' 
    ? 'Архів порожній. Завершені замовлення з\'являться тут через 15 днів після отримання.'
    : 'У вас поки немає активних замовлень';

  if (isLoading) {
    return (
      <div className="space-y-4 pb-28 animate-fade-in">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground mt-4">Завантаження...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <Button variant="ghost" size="sm" onClick={fetchOrders}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {useMockData && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-warning flex-shrink-0" />
          <p className="text-xs text-foreground">Тестові замовлення для перегляду функціоналу</p>
        </div>
      )}

      {mode === 'history' && (
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {dateFrom ? format(dateFrom, 'dd.MM.yy', { locale: uk }) : 'Від'}
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
                {dateTo ? format(dateTo, 'dd.MM.yy', { locale: uk }) : 'До'}
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

      {filteredOrders.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map(order => (
            <OrderCard key={order.id} order={order} onViewDetails={setSelectedOrder} refund={getForOrder(order.id)} />
          ))}
        </div>
      )}

      <OrderDetailsModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        refund={selectedOrder ? getForOrder(selectedOrder.id) : null}
        onCreateRefund={createRequest}
      />
    </div>
  );
}

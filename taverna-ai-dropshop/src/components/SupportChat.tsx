import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ArrowLeft, MessageCircle, Loader2, Bot, Package, Truck, CreditCard, RotateCcw, ArrowLeftRight, ShoppingBag, HelpCircle, User, ChevronRight, Lock, MoreVertical, ShieldAlert, UserX, ArrowUpRight, Store, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ChatRatingPrompt } from "@/components/ChatRatingPrompt";
import { toast } from "sonner";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";

const REACTIONS = ["👍", "❤️", "🔥", "😅", "😡"];


interface Message {
  id: string;
  ticket_id: string;
  sender_role: "user" | "admin" | "supplier" | "bot" | "moderator";
  message_text: string;
  created_at: string;
}

interface Ticket {
  id: string;
  type: string;
  status: "open" | "closed";
  related_order_id: string | null;
  created_at: string;
}

interface OrderInfo {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  items: {
    id: string;
    product_name: string;
    product_image: string | null;
    price: number;
    quantity: number;
    size: string | null;
    color: string | null;
    product_id: string | null;
  }[];
}

type FlowStage = "initial" | "select_order" | "select_topic" | "select_item" | "ai_chat" | "escalated";

interface FlowContext {
  isOrderRelated: boolean;
  selectedOrder: OrderInfo | null;
  selectedTopic: string | null;
  selectedItem: any | null;
  supplierIds: string[];
}

const topicOptions = [
  { id: "product", label: "Конкретний товар", icon: ShoppingBag, description: "Питання про якість, характеристики" },
  { id: "delivery", label: "Доставка", icon: Truck, description: "Терміни, відстеження, проблеми" },
  { id: "payment", label: "Оплата", icon: CreditCard, description: "Статус оплати, повернення коштів" },
  { id: "return", label: "Повернення", icon: RotateCcw, description: "Повернення товару та коштів" },
  { id: "exchange", label: "Обмін", icon: ArrowLeftRight, description: "Обмін на інший розмір/товар" },
];

export default function SupportChat() {
  const navigate = useNavigate();
  const { ticketId } = useParams<{ ticketId: string }>();
  const { profile, sessionToken, roles } = useTelegramAuthContext();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const isStaff = roles.includes("admin") || roles.includes("moderator") || roles.includes("supplier");
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Guided flow state
  const [flowStage, setFlowStage] = useState<FlowStage>("initial");
  const [flowContext, setFlowContext] = useState<FlowContext>({
    isOrderRelated: false,
    selectedOrder: null,
    selectedTopic: null,
    selectedItem: null,
    supplierIds: [],
  });
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isGuidedFlow, setIsGuidedFlow] = useState(false);
  const [showChatRating, setShowChatRating] = useState(false);
  const [isClosingTicket, setIsClosingTicket] = useState(false);
  const [botMessages, setBotMessages] = useState<{ id: string; text: string }[]>([]);

  // Bridge (dual view) — лише для модератора/адміна
  // Preview/demo environments show the moderator bridge UI for visual work.
  const isModerator =
    roles.includes("admin") || roles.includes("moderator") || isPreviewDevEnvironment();
  const [bridgeView, setBridgeView] = useState<"client" | "shop">("client");
  const [internalMessages, setInternalMessages] = useState<{ id: string; from: "moderator" | "shop"; text: string; at: string }[]>([]);
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [peerTyping, setPeerTyping] = useState(false);

  const toggleReaction = (id: string, emoji: string) => {
    hapticSelection();
    setReactions((prev) => ({ ...prev, [id]: prev[id] === emoji ? "" : emoji }));
  };

  const sendInternal = (text: string) => {
    setInternalMessages((prev) => [
      ...prev,
      { id: `int-${Date.now()}`, from: "moderator", text, at: new Date().toISOString() },
    ]);
    setPeerTyping(true);
    setTimeout(() => {
      setPeerTyping(false);
      setInternalMessages((prev) => [
        ...prev,
        {
          id: `int-${Date.now()}-r`,
          from: "shop",
          text: "Прийнято, перевіряємо замовлення та повернемось із відповіддю.",
          at: new Date().toISOString(),
        },
      ]);
    }, 1600);
  };

  const moderatorAction = (label: string, description: string) => {
    hapticNotification("warning");
    toast.success(label, { description });
    setInternalMessages((prev) => [
      ...prev,
      { id: `act-${Date.now()}`, from: "moderator", text: `[Дія модератора] ${label}`, at: new Date().toISOString() },
    ]);
  };


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => { scrollToBottom(); }, [messages, botMessages, flowStage]);

  // Fetch ticket and messages
  useEffect(() => {
    const fetchData = async () => {
      if (!ticketId) return;

      const { data: ticketData, error: ticketError } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("id", ticketId)
        .single();

      if (ticketError) {
        console.error("Error fetching ticket:", ticketError);
        navigate("/support");
        return;
      }

      setTicket(ticketData as Ticket);

      const { data: messagesData } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });

      if (messagesData) {
        setMessages(messagesData as Message[]);
      }

      // Staff (moderator/admin/supplier) skip guided flow entirely - just chat directly
      if (isStaff) {
        setIsGuidedFlow(false);
        setFlowStage("ai_chat");
      } else if (ticketData.type === "supplier_question" && (!messagesData || messagesData.length === 0)) {
        setIsGuidedFlow(true);
        setFlowStage("initial");
        addBotMessage("Вітаю! 👋 Я AI-асистент Taverna. Допоможу вам з будь-яким питанням щодо замовлень та товарів.\n\nЧи стосується ваше питання конкретного замовлення?");
      } else if (ticketData.type === "supplier_question" && messagesData && messagesData.length > 0) {
        setIsGuidedFlow(true);
        setFlowStage("ai_chat");
      }

      setIsLoading(false);
    };

    fetchData();
  }, [ticketId, navigate]);

  // Real-time subscription
  useEffect(() => {
    if (!ticketId) return;
    const channel = supabase
      .channel(`ticket-${ticketId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "ticket_messages",
        filter: `ticket_id=eq.${ticketId}`,
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        if (newMsg.sender_role !== "user") hapticNotification("success");
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ticketId]);

  const addBotMessage = (text: string) => {
    setBotMessages(prev => [...prev, { id: `bot-${Date.now()}-${Math.random()}`, text }]);
  };

  const fetchUserOrders = useCallback(async () => {
    if (!sessionToken) return;
    setIsLoadingOrders(true);
    try {
      const { data } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'get_orders', session_token: sessionToken },
      });
      if (data?.orders) {
        setOrders(data.orders);
      }
    } catch (err) {
      console.error("Error fetching orders:", err);
    } finally {
      setIsLoadingOrders(false);
    }
  }, [sessionToken]);

  // Handle guided flow choices
  const handleOrderRelated = async (isRelated: boolean) => {
    hapticSelection();
    setFlowContext(prev => ({ ...prev, isOrderRelated: isRelated }));
    
    if (isRelated) {
      addBotMessage("Завантажую ваші замовлення...");
      await fetchUserOrders();
      setFlowStage("select_order");
      addBotMessage("Оберіть замовлення, щодо якого у вас питання:");
    } else {
      setFlowStage("select_topic");
      addBotMessage("Оберіть тему вашого питання:");
    }
  };

  const handleSelectOrder = (order: OrderInfo) => {
    hapticSelection();
    setFlowContext(prev => ({ ...prev, selectedOrder: order }));
    addBotMessage(`Обрано замовлення ${order.order_number} на суму ${order.total.toLocaleString()} ₴`);
    setFlowStage("select_topic");
    addBotMessage("Оберіть тему питання:");
  };

  const handleSelectTopic = (topicId: string) => {
    hapticSelection();
    const topic = topicOptions.find(t => t.id === topicId);
    setFlowContext(prev => ({ ...prev, selectedTopic: topicId }));
    addBotMessage(`Тема: ${topic?.label || topicId}`);

    if (topicId === "product" && flowContext.selectedOrder) {
      setFlowStage("select_item");
      addBotMessage("Оберіть товар з замовлення:");
    } else {
      startAiChat(topicId);
    }
  };

  const handleSelectItem = (item: any, index: number) => {
    hapticSelection();
    setFlowContext(prev => ({ ...prev, selectedItem: { ...item, position: index + 1 } }));
    addBotMessage(`Обрано: ${item.product_name} (позиція №${index + 1})`);
    startAiChat("product", item);
  };

  const startAiChat = async (topic: string, item?: any) => {
    setFlowStage("ai_chat");
    
    // Build context message for AI
    const order = flowContext.selectedOrder;
    let contextMsg = `🤖 AI-асистент готовий допомогти!\n\n`;
    
    if (order) {
      const freeReturn = order.total >= 1500;
      contextMsg += `📦 Замовлення: ${order.order_number}\n`;
      contextMsg += `💰 Сума: ${order.total.toLocaleString()} ₴\n`;
      if (freeReturn) {
        contextMsg += `✅ Безкоштовне повернення/обмін (сума > 1500 ₴)\n`;
      }
      if (item) {
        contextMsg += `🏷️ Товар: ${item.product_name}\n`;
      }
    }
    
    contextMsg += `\nОпишіть ваше питання, і я постараюсь допомогти. Якщо потрібна допомога менеджера — натисніть кнопку нижче.`;
    
    addBotMessage(contextMsg);

    // Save initial context as first message
    if (ticketId) {
      const summaryText = buildContextSummary(topic, item);
      await supabase.from("ticket_messages").insert({
        ticket_id: ticketId,
        sender_role: "user",
        message_text: `[Автоматичний контекст]\n${summaryText}`,
      });
    }
  };

  const buildContextSummary = (topic: string, item?: any) => {
    const order = flowContext.selectedOrder;
    const topicLabel = topicOptions.find(t => t.id === topic)?.label || topic;
    let summary = `Тема: ${topicLabel}`;
    if (order) summary += `\nЗамовлення: ${order.order_number} (${order.total} ₴)`;
    if (item) summary += `\nТовар: ${item.product_name}`;
    return summary;
  };

  const handleEscalate = async () => {
    hapticSelection();
    setFlowStage("escalated");
    
    const order = flowContext.selectedOrder;
    if (!order) {
      // No order context - just open bot
      const tg = (window as any).Telegram?.WebApp;
      const startParam = `support_${ticketId}`;
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/taverna_support_bot?start=${startParam}`);
      } else {
        window.open(`https://t.me/taverna_support_bot?start=${startParam}`, "_blank");
      }
      addBotMessage("Ваш запит передано менеджеру. Очікуйте відповідь через бот.");
      return;
    }

    // Find suppliers for order items
    try {
      const { data: orderItems } = await supabase
        .from("order_items")
        .select("product_id, product_name")
        .eq("order_id", order.id);

      if (orderItems?.length) {
        const productIds = orderItems.map(oi => oi.product_id).filter(Boolean);
        const { data: products } = await supabase
          .from("products")
          .select("id, supplier_id")
          .in("id", productIds as string[]);

        const supplierIds = [...new Set(products?.map(p => p.supplier_id).filter(Boolean) || [])];
        setFlowContext(prev => ({ ...prev, supplierIds: supplierIds as string[] }));

        // Create escalation messages for each supplier
        for (const supplierId of supplierIds) {
          const supplierProducts = products?.filter(p => p.supplier_id === supplierId) || [];
          const itemNames = orderItems
            .filter(oi => supplierProducts.some(sp => sp.id === oi.product_id))
            .map((oi, idx) => `${order.order_number}/${idx + 1} — ${oi.product_name}`)
            .join("\n");

          await supabase.from("ticket_messages").insert({
            ticket_id: ticketId!,
            sender_role: "user",
            message_text: `[Ескалація до менеджера магазину]\nЗамовлення: ${order.order_number}\nТовари:\n${itemNames}\nТема: ${flowContext.selectedTopic}`,
          });
        }

        const freeReturn = order.total >= 1500;
        addBotMessage(
          `✅ Ваш запит передано менеджеру${supplierIds.length > 1 ? "ам" : ""} магазин${supplierIds.length > 1 ? "ів" : "у"} (${supplierIds.length}).\n\n` +
          `Кожен товар прикріплено до відповідного постачальника.\n` +
          (freeReturn ? `💰 Доставка повернення/обміну — за рахунок магазину (сума > 1500 ₴).\n` : ``) +
          `\n🔒 Спілкування повністю анонімне. Очікуйте відповідь.`
        );
      }
    } catch (err) {
      console.error("Escalation error:", err);
      addBotMessage("Запит на з'єднання з менеджером надіслано. Очікуйте відповідь.");
    }
  };

  // Send message to AI
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !ticketId || !profile?.id || isSending) return;

    const messageText = newMessage.trim();
    setNewMessage("");
    setIsSending(true);
    hapticSelection();

    // Optimistic update
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      ticket_id: ticketId,
      sender_role: "user",
      message_text: messageText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    // Save to DB - staff sends as "moderator", users as "user"
    const senderRole = isStaff ? "moderator" : "user";
    const { data, error } = await supabase
      .from("ticket_messages")
      .insert({ ticket_id: ticketId, sender_role: senderRole, message_text: messageText })
      .select().single();

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      hapticNotification("error");
      setIsSending(false);
      return;
    }

    setMessages((prev) => prev.map((m) => (m.id === optimisticMsg.id ? (data as Message) : m)));
    setIsSending(false);

    // If in AI chat mode for supplier questions, call AI
    if (!isStaff && isGuidedFlow && flowStage === "ai_chat") {
      setIsAiThinking(true);
      try {
        // Build AI context
        const order = flowContext.selectedOrder;
        const contextMessages = messages
          .filter(m => !m.message_text.startsWith("[Автоматичний контекст]"))
          .slice(-6)
          .map(m => ({ role: m.sender_role === "user" ? "user" : "assistant", content: m.message_text }));

        let aiContextPrefix = "";
        if (order) {
          aiContextPrefix = `Контекст: замовлення ${order.order_number}, сума ${order.total} ₴. `;
          if (flowContext.selectedItem) {
            aiContextPrefix += `Товар: ${flowContext.selectedItem.product_name}. `;
          }
          aiContextPrefix += `Тема: ${flowContext.selectedTopic}. `;
          if (order.total >= 1500) {
            aiContextPrefix += `Безкоштовне повернення (сума > 1500 ₴). `;
          }
        }

        const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-assistant', {
          body: {
            message: aiContextPrefix + messageText,
            session_token: sessionToken,
            context: contextMessages,
          },
        });

        if (!aiError && aiData?.message) {
          // Save AI response
          await supabase.from("ticket_messages").insert({
            ticket_id: ticketId,
            sender_role: "admin",
            message_text: aiData.message,
          });
        }
      } catch (err) {
        console.error("AI error:", err);
        await supabase.from("ticket_messages").insert({
          ticket_id: ticketId,
          sender_role: "admin",
          message_text: "Вибачте, виникла помилка. Спробуйте ще раз або зв'яжіться з менеджером.",
        });
      } finally {
        setIsAiThinking(false);
      }
    }

    inputRef.current?.focus();
  };

  const handleBack = () => {
    hapticSelection();
    navigate("/support");
  };

  const handleCloseTicket = async () => {
    if (!ticketId) return;
    setIsClosingTicket(true);
    try {
      await supabase.from("support_tickets").update({ status: "closed" }).eq("id", ticketId);
      setTicket(prev => prev ? { ...prev, status: "closed" } : null);
      setShowChatRating(true);
      toast.success("Тікет закрито");
    } catch (err) {
      console.error("Error closing ticket:", err);
      toast.error("Помилка закриття тікету");
    } finally {
      setIsClosingTicket(false);
    }
  };

  const getTicketTypeLabel = (type: string) => {
    switch (type) {
      case "tech_support": return "Технічна підтримка";
      case "supplier_question": return "AI-асистент";
      case "complaint_admin": return "Скарга на адміна/модератора";
      case "complaint_supplier": return "Скарга на постачальника";
      default: return "Підтримка";
    }
  };

  const getSenderLabel = (role: string) => {
    switch (role) {
      case "user": return isStaff ? "Клієнт" : "Ви";
      case "admin": return "AI-асистент";
      case "moderator": return isStaff ? "Ви (модератор)" : "Модератор";
      case "supplier": return "Менеджер";
      default: return "Система";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const showTextInput = isStaff || !isGuidedFlow || flowStage === "ai_chat" || flowStage === "escalated";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b">
        <div className="flex items-center gap-3 p-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold text-sm">
              {ticket?.type === "supplier_question" ? "AI-асистент" : `Чат #${ticketId?.slice(0, 8)}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              {ticket && getTicketTypeLabel(ticket.type)}
              {ticket?.status === "closed" && " • Закрито"}
            </p>
          </div>
          <div className={cn(
            "px-2 py-1 rounded-full text-xs font-medium",
            ticket?.status === "open" ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
          )}>
            {ticket?.status === "open" ? "Активний" : "Закрито"}
          </div>

          {isModerator && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Дії модератора">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Дії модератора</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => moderatorAction("Попередження надіслано", "Учасник отримав офіційне попередження")}>
                  <ShieldAlert className="h-4 w-4 mr-2 text-warning" /> Винести попередження
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => moderatorAction("Тимчасове блокування", "Доступ обмежено на 24 години")}>
                  <UserX className="h-4 w-4 mr-2 text-destructive" /> Тимчасовий бан (24 год)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => moderatorAction("Ескалація до адміністратора", "Звернення передано адміну платформи")}>
                  <ArrowUpRight className="h-4 w-4 mr-2 text-primary" /> Ескалація до адміна
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleCloseTicket} disabled={isClosingTicket}>
                  <Lock className="h-4 w-4 mr-2" /> Закрити тікет
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Dual view: клієнт / приватний чат з магазином */}
        {isModerator && (
          <div className="px-4 pb-3">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted">
              {([
                { id: "client", label: "Чат з клієнтом", icon: User },
                { id: "shop", label: "Приватно з магазином", icon: Store },
              ] as const).map((v) => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => { hapticSelection(); setBridgeView(v.id); }}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors",
                      bridgeView === v.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {v.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Приватний внутрішній чат з менеджером магазину */}
      {isModerator && bridgeView === "shop" ? (
        <main className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide bg-warning/5">
          <div className="text-center">
            <span className="text-[11px] text-muted-foreground bg-muted px-3 py-1 rounded-full">
              🔒 Внутрішній чат — клієнт цього не бачить
            </span>
          </div>
          {internalMessages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Напишіть менеджеру магазину щодо цього звернення
            </p>
          )}
          {internalMessages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex", m.from === "moderator" ? "justify-end" : "justify-start")}
            >
              <div className={cn(
                "max-w-[80%] px-4 py-2.5 border",
                m.from === "moderator"
                  ? "bg-warning/15 border-warning/40 rounded-2xl rounded-br-md"
                  : "bg-card border-border rounded-2xl rounded-bl-md",
              )}>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">
                  {m.from === "moderator" ? "Ви (модератор)" : "Менеджер магазину"}
                </p>
                <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
                <p className="text-[10px] mt-1 text-muted-foreground">{format(new Date(m.at), "HH:mm")}</p>
              </div>
            </motion.div>
          ))}
          {peerTyping && (
            <div className="flex justify-start">
              <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
                <span className="text-xs text-muted-foreground ml-1.5">магазин друкує…</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </main>
      ) : (

      /* Messages Area */
      <main className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">

        {/* Bot guided messages */}
        {isGuidedFlow && (
          <AnimatePresence initial={false}>
            {botMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="max-w-[85%] bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
                  <p className="text-xs font-medium text-primary mb-1 flex items-center gap-1">
                    <Bot className="h-3 w-3" /> AI-асистент
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {/* Flow Stage: Initial - order related? */}
        {isGuidedFlow && flowStage === "initial" && (
          <div className="flex gap-2 justify-center mt-2">
            <Button variant="outline" onClick={() => handleOrderRelated(true)} className="flex-1">
              <Package className="h-4 w-4 mr-2" />
              Так, щодо замовлення
            </Button>
            <Button variant="outline" onClick={() => handleOrderRelated(false)} className="flex-1">
              <HelpCircle className="h-4 w-4 mr-2" />
              Ні, загальне питання
            </Button>
          </div>
        )}

        {/* Flow Stage: Select Order */}
        {isGuidedFlow && flowStage === "select_order" && (
          <div className="space-y-2 mt-2">
            {isLoadingOrders ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Замовлень не знайдено</p>
                <Button variant="outline" onClick={() => { setFlowStage("select_topic"); addBotMessage("Оберіть тему питання:"); }} className="mt-2">
                  Продовжити без замовлення
                </Button>
              </div>
            ) : (
              orders.slice(0, 10).map((order) => (
                <button
                  key={order.id}
                  onClick={() => handleSelectOrder(order)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{order.order_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.items.length} товар{order.items.length > 1 ? "ів" : ""} • {order.total.toLocaleString()} ₴
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        )}

        {/* Flow Stage: Select Topic */}
        {isGuidedFlow && flowStage === "select_topic" && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {topicOptions.map((topic) => {
              const Icon = topic.icon;
              return (
                <button
                  key={topic.id}
                  onClick={() => handleSelectTopic(topic.id)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card border border-border hover:border-primary transition-all text-center"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-xs font-medium">{topic.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Flow Stage: Select Item */}
        {isGuidedFlow && flowStage === "select_item" && flowContext.selectedOrder && (
          <div className="space-y-2 mt-2">
            {flowContext.selectedOrder.items.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => handleSelectItem(item, idx)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary transition-all text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                  {item.product_image ? (
                    <img src={item.product_image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm line-clamp-1">{item.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Позиція №{idx + 1} • {item.quantity} × {item.price.toLocaleString()} ₴
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}

        {/* DB Messages */}
        <AnimatePresence initial={false}>
          {messages.filter(m => !m.message_text.startsWith("[Автоматичний контекст]")).map((message, index) => {
            const isUser = isStaff ? (message.sender_role === "moderator" || message.sender_role === "admin") : message.sender_role === "user";
            const allVisible = messages.filter(m => !m.message_text.startsWith("[Автоматичний контекст]"));
            const visibleIndex = allVisible.indexOf(message);
            const showDate = visibleIndex === 0 || new Date(message.created_at).toDateString() !== new Date(allVisible[visibleIndex - 1]?.created_at).toDateString();

            return (
              <div key={message.id}>
                {showDate && (
                  <div className="text-center my-4">
                    <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      {format(new Date(message.created_at), "d MMMM", { locale: uk })}
                    </span>
                  </div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className={`group flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[80%]">
                    <div className={cn(
                      "px-4 py-2.5",
                      isUser
                        ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                        : "bg-muted rounded-2xl rounded-bl-md"
                    )}>
                      {!isUser && (
                        <p className="text-xs font-medium text-primary mb-1 flex items-center gap-1">
                          {message.sender_role === "admin" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {getSenderLabel(message.sender_role)}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">{message.message_text}</p>
                      <p className={cn("text-[10px] mt-1", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {format(new Date(message.created_at), "HH:mm")}
                      </p>
                    </div>

                    {/* Швидкі реакції */}
                    <div className={cn("flex items-center gap-1 mt-1", isUser ? "justify-end" : "justify-start")}>
                      {reactions[message.id] ? (
                        <button
                          onClick={() => toggleReaction(message.id, reactions[message.id])}
                          className="text-xs bg-card border border-border rounded-full px-2 py-0.5"
                        >
                          {reactions[message.id]}
                        </button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground">
                              <Smile className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align={isUser ? "end" : "start"} className="flex gap-1 p-1 min-w-0">
                            {REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(message.id, emoji)}
                                className="text-base px-1.5 py-0.5 rounded hover:bg-muted"
                              >
                                {emoji}
                              </button>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </motion.div>
              </div>

            );
          })}
        </AnimatePresence>

        {/* AI thinking indicator */}
        {isAiThinking && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">AI думає...</span>
              </div>
            </div>
          </div>
        )}

        {/* Escalate button */}
        {isGuidedFlow && flowStage === "ai_chat" && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={handleEscalate} className="text-xs">
              <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
              Зв'язатись з менеджером магазину
            </Button>
          </div>
        )}

        {/* Chat Rating Prompt */}
        {showChatRating && ticket && (
          <ChatRatingPrompt
            ticketId={ticket.id}
            orderId={ticket.related_order_id}
            raterRole={isStaff ? "moderator" : "user"}
            targetRole={isStaff ? "user" : "moderator"}
            targetLabel={isStaff ? "клієнта" : "менеджера"}
            onClose={() => setShowChatRating(false)}
          />
        )}

        <div ref={messagesEndRef} />
      </main>
      )}

      {/* Input Area */}
      {(ticket?.status === "open" && showTextInput) || (isModerator && bridgeView === "shop") ? (
        <div className={cn(
          "sticky bottom-0 border-t p-4 pb-safe",
          isModerator && bridgeView === "shop" ? "bg-warning/5" : "bg-background",
        )}>
          <form
            onSubmit={(e) => {
              if (isModerator && bridgeView === "shop") {
                e.preventDefault();
                if (!newMessage.trim()) return;
                sendInternal(newMessage.trim());
                setNewMessage("");
                hapticSelection();
                return;
              }
              handleSendMessage(e);
            }}
            className="flex gap-2"
          >
            <Input
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={
                isModerator && bridgeView === "shop"
                  ? "Внутрішнє повідомлення магазину..."
                  : flowStage === "ai_chat" ? "Опишіть ваше питання..." : "Напишіть повідомлення..."
              }
              className="flex-1 bg-muted border-0"
              disabled={isSending || isAiThinking}
            />
            <Button type="submit" size="icon" disabled={!newMessage.trim() || isSending || isAiThinking} className="shrink-0">
              {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </form>

          {/* Close ticket button for staff */}
          {isStaff && (
            <Button variant="outline" size="sm" onClick={handleCloseTicket} disabled={isClosingTicket} className="w-full mt-2 gap-2 text-xs">
              <Lock className="h-3.5 w-3.5" />
              {isClosingTicket ? "Закриття..." : "Закрити тікет"}
            </Button>
          )}
        </div>
      ) : ticket?.status === "closed" ? (
        <div className="sticky bottom-0 bg-muted/50 border-t p-4 pb-safe text-center">
          <p className="text-sm text-muted-foreground">Цей чат закрито.</p>
          {!showChatRating && (
            <Button variant="outline" size="sm" onClick={() => setShowChatRating(true)} className="mt-2 text-xs">
              Оцінити {isStaff ? "клієнта" : "менеджера"}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

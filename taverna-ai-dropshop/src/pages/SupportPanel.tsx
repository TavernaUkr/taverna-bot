import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  HandMetal,
  Loader2,
  MessageSquare,
  Package,
  Send,
  Store,
  Undo2,
  User,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import {
  BackendMessage,
  BackendTicket,
  assignTicket,
  closeTicket,
  getMyTickets,
  getTicketMessages,
  sendTicketMessage,
} from "@/lib/backendApi";

// Автооновлення списку тікетів (нові звернення клієнтів)
const REFRESH_TICKETS_MS = 20000;
// Скільки чекати перед першим намаганням підняти AI-звіт після закриття
const AI_SUMMARY_POLL_MS = 6000;
const AI_SUMMARY_POLL_ATTEMPTS = 5;

const TOPIC_LABELS: Record<string, string> = {
  delivery: "Доставка",
  refund: "Повернення коштів",
  question: "Питання",
  other: "Інше",
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  ai_handling: { label: "AI обробляє", className: "bg-primary/10 text-primary" },
  escalated: { label: "Ескалація", className: "bg-warning/10 text-warning" },
  closed: { label: "Закрито", className: "bg-muted text-muted-foreground" },
};

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return format(date, "HH:mm", { locale: uk });
  } catch {
    return "";
  }
}

function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "щойно";
    if (diffMin < 60) return `${diffMin} хв`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} год`;
    return format(date, "d MMM", { locale: uk });
  } catch {
    return "";
  }
}

export default function SupportPanel() {
  const navigate = useNavigate();
  const { isAuthenticated, roles, profile } = useTelegramAuthContext();

  // Внутрішній ID користувача у FastAPI (туди мапиться profile.id).
  // Порівнюємо з assigned_manager_id, щоб розуміти: тікет мій / нічий / чужий.
  const currentUserId = profile?.id ? Number(profile.id) : null;

  // --- Стан панелі ---
  const [tickets, setTickets] = useState<BackendTicket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTicketId, setActiveTicketId] = useState<number | null>(null);
  const [messages, setMessages] = useState<BackendMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [newMessageText, setNewMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");

  const isShopSide =
    roles.includes("supplier") || roles.includes("shop_manager") || roles.includes("admin");

  const activeTicket = tickets.find((t) => t.id === activeTicketId) ?? null;
  const isTicketClosed = activeTicket?.status === "closed";
  // Тікет нічий — жоден менеджер його ще не узяв (лише для сторони магазину)
  const isTicketUnclaimed =
    isShopSide && activeTicket != null && activeTicket.assigned_manager_id == null;
  // Тікет узяв я (порівнюємо внутрішні ID користувачів FastAPI)
  const isTicketMine =
    activeTicket?.assigned_manager_id != null &&
    currentUserId != null &&
    activeTicket.assigned_manager_id === currentUserId;
  // Клієнт завжди може писати у власний тікет (він автор);
  // менеджер — лише після взяття тікета в роботу.
  const canWrite = isShopSide ? isTicketMine : activeTicket != null;

  // --- Завантаження списку тікетів (manager: тікети своїх магазинів / customer: власні) ---
  const loadTickets = useCallback(async () => {
    if (!isShopSide && !isAuthenticated) {
      setIsLoadingTickets(false);
      return;
    }
    try {
      const data = await getMyTickets(isShopSide ? "manager" : "customer");
      setTickets(data);
      setLoadError(null);
    } catch (err) {
      console.error("Error loading tickets:", err);
      setLoadError(
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити тікети. Перевірте, чи запущений бекенд."
      );
    } finally {
      setIsLoadingTickets(false);
    }
  }, [isShopSide, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoadingTickets(false);
      return;
    }
    void loadTickets();
    const interval = setInterval(() => void loadTickets(), REFRESH_TICKETS_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated, loadTickets]);

  // --- Завантаження повідомлень активного тікета ---
  const loadMessages = useCallback(async (ticketId: number) => {
    try {
      const data = await getTicketMessages(ticketId);
      setMessages(data);
    } catch (err) {
      console.error("Error loading ticket messages:", err);
      toast.error("Не вдалося завантажити історію переписки");
    }
  }, []);

  useEffect(() => {
    if (activeTicketId == null) {
      setMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    void loadMessages(activeTicketId).finally(() => setIsLoadingMessages(false));

    // Пулінг нових повідомлень, поки тікет відкритий
    const interval = setInterval(() => {
      if (document.hidden) return;
      void loadMessages(activeTicketId);
    }, REFRESH_TICKETS_MS);
    return () => clearInterval(interval);
  }, [activeTicketId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- Після закриття: AI-звіт генерується у фоні на бекенді ---
  // Полимо /me кілька разів: як тілhько ai_summary з'явиться — покажемо.
  useEffect(() => {
    if (activeTicketId == null) return;
    const ticket = tickets.find((t) => t.id === activeTicketId);
    if (!ticket || ticket.status !== "closed" || ticket.ai_summary) return;

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      attempts += 1;
      await loadTickets();
      const updated = ticketsRef.current.find((t) => t.id === activeTicketId);
      if (updated?.ai_summary || attempts >= AI_SUMMARY_POLL_ATTEMPTS) return;
      timer = setTimeout(() => void poll(), AI_SUMMARY_POLL_MS);
    };
    timer = setTimeout(() => void poll(), AI_SUMMARY_POLL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeTicketId, tickets, loadTickets]);

  // Тримаємо останній список тікетів для пулінгу без ре-рендерів
  const ticketsRef = useRef<BackendTicket[]>([]);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  // --- Дії ---
  const handleSelectTicket = (ticketId: number) => {
    hapticSelection();
    setActiveTicketId(ticketId);
    setMobileView("chat");
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessageText.trim();
    if (!text || activeTicketId == null || isSending || isTicketClosed) return;

    hapticSelection();
    setIsSending(true);
    try {
      // Клієнт пише від себе; представник магазину — як 'manager'.
      const sent = await sendTicketMessage(
        activeTicketId,
        text,
        isShopSide ? "manager" : "customer"
      );
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setNewMessageText("");
      // Оновлюємо last_message_at у списку
      setTickets((prev) =>
        prev.map((t) =>
          t.id === activeTicketId
            ? {
                ...t,
                message_count: (t.message_count ?? 0) + 1,
                last_message_at: sent.created_at,
              }
            : t
        )
      );
    } catch (err) {
      console.error("Error sending message:", err);
      hapticNotification("error");
      toast.error(
        err instanceof Error ? err.message : "Не вдалося надіслати повідомлення"
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleCloseTicket = async () => {
    if (activeTicketId == null || isClosing || isTicketClosed) return;
    hapticSelection();
    setIsClosing(true);
    try {
      const closed = await closeTicket(activeTicketId);
      // Одразу оновлюємо стан тікета у списку (ai_summary ще null — генерується у фоні)
      setTickets((prev) =>
        prev.map((t) => (t.id === closed.id ? { ...t, ...closed, message_count: t.message_count } : t))
      );
      hapticNotification("success");
      toast.success("Тікет позначено як вирішене. AI генерує звіт...");
    } catch (err) {
      console.error("Error closing ticket:", err);
      hapticNotification("error");
      toast.error(err instanceof Error ? err.message : "Не вдалося закрити тікет");
    } finally {
      setIsClosing(false);
    }
  };

  const handleBackToList = () => {
    hapticSelection();
    setMobileView("list");
  };

  const handleAssignTicket = async () => {
    if (activeTicketId == null || isAssigning || !isTicketUnclaimed) return;
    hapticSelection();
    setIsAssigning(true);
    try {
      const updated = await assignTicket(activeTicketId);
      // Оновлюємо стан тікета у списку: тепер він мій, інпут відкриється
      setTickets((prev) =>
        prev.map((t) => (t.id === updated.id ? { ...t, ...updated, message_count: t.message_count } : t))
      );
      hapticNotification("success");
      toast.success("Тікет взято в роботу");
    } catch (err) {
      console.error("Error assigning ticket:", err);
      hapticNotification("error");
      toast.error(err instanceof Error ? err.message : "Не вдалося взяти тікет у роботу");
      // Хтось міг узяти тікет одночасно — підтягуємо актуальний список
      void loadTickets();
    } finally {
      setIsAssigning(false);
    }
  };

  // --- Гейт: лише авторизовані користувачі ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <PanelHeader title={isShopSide ? "Підтримка магазинів" : "Мої звернення"} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Авторизуйтесь через Telegram, щоб{isShopSide ? " відповідати клієнтам" : " бачити свої звернення"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const statusBadge = activeTicket ? STATUS_BADGES[activeTicket.status] : null;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Шапка панелі */}
      <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="flex items-center gap-2 px-3 py-2.5">
          {mobileView === "chat" && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={handleBackToList}
              aria-label="Назад до списку"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-foreground truncate">
              {isShopSide ? "Панель підтримки" : "Мої звернення"}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              {activeTicket
                ? `${TOPIC_LABELS[activeTicket.topic] ?? activeTicket.topic} • ${
                    activeTicket.assigned_manager_id == null
                      ? "Нічийний"
                      : isTicketMine
                        ? "У вас в роботі"
                        : `Менеджер #${activeTicket.assigned_manager_id}`
                  }`
                : `Тікетів: ${tickets.length}`}
            </p>
          </div>
          {activeTicket && isShopSide && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCloseTicket}
              disabled={isClosing || isTicketClosed}
              className="gap-1.5 text-xs"
            >
              {isClosing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              )}
              {isTicketClosed ? "Вирішено" : "Позначити як вирішено"}
            </Button>
          )}
        </div>
      </header>

      {/* Двопанельний лейаут */}
      <div className="flex-1 flex min-h-0">
        {/* ЛІВА ПАНЕЛЬ: список тікетів */}
        <aside
          className={cn(
            "w-full md:w-[340px] shrink-0 border-r border-border flex flex-col min-h-0",
            mobileView === "chat" ? "hidden md:flex" : "flex"
          )}
        >
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {isLoadingTickets ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="p-4 space-y-3 text-center">
                <AlertTriangle className="h-8 w-8 mx-auto text-warning" />
                <p className="text-sm text-muted-foreground">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => void loadTickets()}>
                  <Undo2 className="h-4 w-4 mr-1.5" />
                  Спробувати ще
                  </Button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-12 px-4 text-muted-foreground">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Звернень поки немає</p>
                {isShopSide ? (
                  <p className="text-xs mt-1 opacity-70">
                    Тут з'являться тікети клієнтів ваших магазинів
                  </p>
                ) : (
                  <p className="text-xs mt-1 opacity-70">
                    Створіть звернення на сторінці «Підтримка» — AI допоможе, а за потреби
                    підключить менеджера
                  </p>
                )}
              </div>
            ) : (
              tickets.map((ticket) => {
                const badge = STATUS_BADGES[ticket.status] ?? {
                  label: ticket.status,
                  className: "bg-muted text-muted-foreground",
                };
                const isActive = ticket.id === activeTicketId;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => handleSelectTicket(ticket.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 border-b border-border/60 transition-colors",
                      isActive
                        ? "bg-primary/10"
                        : "hover:bg-muted/50 active:bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-foreground truncate">
                        {TOPIC_LABELS[ticket.topic] ?? ticket.topic}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelative(ticket.last_message_at ?? ticket.updated_at ?? ticket.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full font-medium",
                          badge.className
                        )}
                      >
                        {badge.label}
                      </span>
                      {/* Мій тікет: узяв у роботу поточний менеджер (лише сторона магазину) */}
                      {isShopSide &&
                        ticket.assigned_manager_id != null &&
                        currentUserId != null &&
                        ticket.assigned_manager_id === currentUserId && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-500 flex items-center gap-1">
                            <UserCheck className="h-3 w-3" />
                            Мій
                          </span>
                        )}
                      {/* Нічийний тікет — можна взяти в роботу (лише сторона магазину) */}
                      {isShopSide && ticket.assigned_manager_id == null && ticket.status !== "closed" && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-teal-500/10 text-teal-500">
                          Нічийний
                        </span>
                      )}
                      {ticket.order_id != null && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          Замовлення #{ticket.order_id}
                        </span>
                      )}
                      {ticket.message_count != null && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {ticket.message_count}
                        </span>
                      )}
                    </div>
                    {ticket.ai_summary && (
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                        🤖 {ticket.ai_summary}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ПРАВА ПАНЕЛЬ: вікно чату */}
        <section
          className={cn(
            "flex-1 flex flex-col min-h-0 min-w-0",
            mobileView === "list" ? "hidden md:flex" : "flex"
          )}
        >
          {!activeTicket ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center space-y-3">
                <Store className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">
                  {isShopSide
                    ? "Оберіть тікет зі списку, щоб відповісти клієнту"
                    : "Оберіть звернення зі списку, щоб продовжити діалог"}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* AI-Звіт по закритому тікету */}
              {isTicketClosed && activeTicket.ai_summary && (
                <div className="shrink-0 m-3 p-3.5 rounded-xl border border-primary/30 bg-primary/5">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary mb-1">
                        🤖 AI-Звіт по тікету
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                        {activeTicket.ai_summary}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Повідомлення */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                {isLoadingMessages ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    Повідомлень поки немає
                  </p>
                ) : (
                  messages.map((message) => {
                    // Сторона магазину: свої (manager/supplier) та AI-бот — праворуч.
                    // Клієнт: свої (customer) — праворуч, менеджер та AI — ліворуч.
                    const isBot = message.sender_role === "ai_bot";
                    const isMine = isShopSide
                      ? message.sender_role === "manager" || message.sender_role === "supplier"
                      : message.sender_role === "customer";
                    const alignRight = isShopSide ? isMine || isBot : isMine;
                    const peerLabel = isShopSide ? "Клієнт" : "Менеджер";
                    return (
                      <div
                        key={message.id}
                        className={cn("flex", alignRight ? "justify-end" : "justify-start")}
                      >
                        <div className="max-w-[80%] min-w-0">
                          <div
                            className={cn(
                              "px-4 py-2.5 rounded-2xl break-words whitespace-pre-wrap",
                              alignRight
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted text-foreground rounded-bl-md"
                            )}
                          >
                            {!alignRight && (
                              <p className="text-[11px] font-medium text-primary mb-1 flex items-center gap-1">
                                {isBot ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                                {isBot ? "AI-бот" : peerLabel}
                              </p>
                            )}
                            {alignRight && isBot && (
                              <p className="text-[11px] font-medium text-primary-foreground/80 mb-1 flex items-center gap-1">
                                <Bot className="h-3 w-3" />
                                AI-бот
                              </p>
                            )}
                            <p className="text-sm">{message.text}</p>
                            <p
                              className={cn(
                                "text-[10px] mt-1",
                                alignRight ? "text-primary-foreground/70" : "text-muted-foreground"
                              )}
                            >
                              {formatTime(message.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Інпут / Claim-кнопка / плашка "закрито" */}
              {isTicketClosed ? (
                <div className="shrink-0 border-t border-border bg-muted/50 p-4 text-center">
                  <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    {isShopSide
                      ? `Тікет закрито. ${activeTicket.ai_summary ? "AI-звіт згенеровано." : "AI-звіт генерується..."}`
                      : "Звернення вирішено. Дякуємо за терпіння!"}
                  </p>
                  {isShopSide && !activeTicket.ai_summary && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Оновлюється автоматично — можете повернутись до списку
                    </p>
                  )}
                </div>
              ) : isTicketUnclaimed ? (
                /* НІЧИЙНИЙ тікет: інпут схований, натомість — Claim-кнопка.
                   Брати в роботу може будь-хто зі сторони магазину (менеджер/власник). */
                <div className="shrink-0 border-t border-border p-4">
                  <Button
                    onClick={handleAssignTicket}
                    disabled={isAssigning}
                    className="w-full h-12 text-base font-semibold gap-2"
                    size="lg"
                  >
                    {isAssigning ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <HandMetal className="h-5 w-5" />
                    )}
                    {isAssigning ? "Забираю..." : "Взяти тікет в роботу"}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Після взяття ви зможете відповідати клієнту, а при закритті
                    отримаєте винагороду за тарифом
                  </p>
                </div>
              ) : (
                <div className="shrink-0 border-t border-border p-3 pb-safe">
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <Input
                      value={newMessageText}
                      onChange={(e) => setNewMessageText(e.target.value)}
                      placeholder={
                        !canWrite
                          ? "Тікет у іншого менеджера — читання доступне, писати може лише він"
                          : isShopSide
                            ? "Напишіть відповідь клієнту..."
                            : "Напишіть повідомлення менеджеру..."
                      }
                      className="flex-1 bg-muted border-0"
                      disabled={isSending || !canWrite}
                      maxLength={4000}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!newMessageText.trim() || isSending || !canWrite}
                      className="shrink-0"
                      aria-label="Відправити"
                    >
                      {isSending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Send className="w-5 h-5" />
                      )}
                    </Button>
                  </form>
                  {isShopSide && isTicketMine && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <UserCheck className="h-3 w-3 text-emerald-500" />
                      Тікет у вас в роботі
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PanelHeader({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            hapticSelection();
            navigate(-1);
          }}
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold text-foreground">{title}</h1>
      </div>
    </header>
  );
}

import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  HelpCircle,
  MessageCircle,
  Package,
  RotateCcw,
  CreditCard,
  Truck,
  ChevronRight,
  Wrench,
  ShoppingBag,
  ArrowLeftRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Star,
  AlertTriangle,
  ArrowLeft,
  Shield,
  Store,
  BookOpen,
  Bot,
  Send,
  LifeBuoy,
  UserCheck,
} from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNavigation } from "@/components/BottomNavigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { SearchModal } from "@/components/SearchModal";
import { CartModal } from "@/components/CartModal";
import { WishlistModal } from "@/components/WishlistModal";
import { AppRatingModal } from "@/components/AppRatingModal";
import { CustomerGuideModal } from "@/components/CustomerGuideModal";
import { SupplierGuideModal } from "@/components/SupplierGuideModal";
import { ModeratorGuideModal } from "@/components/guides/ModeratorGuideModal";
import { ManagerGuideModal } from "@/components/guides/ManagerGuideModal";
import { toast } from "sonner";
import { hapticSelection, hapticNotification } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  BackendApiError,
  createBackendTicket,
  getPublicSuppliers,
  resolveSupportShopId,
  supportAiChat,
  type BackendPublicSupplier,
  type CreateTicketTopic,
  type SupportAiMessage,
  type SupportCategory,
} from "@/lib/backendApi";

const faqItems = [
  {
    id: "delivery",
    question: "Як здійснюється доставка?",
    answer:
      "Доставка здійснюється через Нову Пошту по всій Україні. Термін доставки 1-3 робочі дні. Ви можете обрати доставку до відділення або адресну доставку кур'єром.",
    icon: Truck,
  },
  {
    id: "payment",
    question: "Які способи оплати доступні?",
    answer:
      "Ми приймаємо оплату карткою онлайн, накладеним платежем при отриманні та криптовалютою (USDT). При передоплаті діє знижка 3%.",
    icon: CreditCard,
  },
  {
    id: "returns",
    question: "Як повернути або обміняти товар?",
    answer:
      "Повернення або обмін можливий протягом 14 днів з моменту отримання. Товар має бути в оригінальній упаковці та без слідів використання. Зверніться до служби підтримки для оформлення повернення.",
    icon: RotateCcw,
  },
  {
    id: "order-status",
    question: "Як відстежити замовлення?",
    answer:
      "Після відправлення замовлення ви отримаєте номер ТТН Нової Пошти. Відстежити статус можна в розділі 'Замовлення' у вашому профілі або на сайті Нової Пошти.",
    icon: Package,
  },
  {
    id: "warranty",
    question: "Чи є гарантія на товари?",
    answer:
      "Так, на всі товари надається гарантія від виробника. Термін гарантії залежить від категорії товару та вказаний на сторінці товару.",
    icon: HelpCircle,
  },
  {
    id: "free-return",
    question: "Хто оплачує повернення/обмін?",
    answer:
      "Якщо сума вашого замовлення перевищує 1500 ₴ — доставку обміну/повернення оплачує наш магазин. В іншому випадку — за рахунок покупця.",
    icon: ArrowLeftRight,
  },
];

const exchangeSteps = [
  { step: 1, title: "Оберіть категорію", description: "Натисніть «Зв'язатися з підтримкою» → «Питання до постачальника»", icon: MessageCircle },
  { step: 2, title: "Поспілкуйтесь з AI", description: "AI-асистент з'ясує деталі: номер замовлення, магазин, суть проблеми", icon: Bot },
  { step: 3, title: "Опишіть проблему", description: "AI запропонує рішення та за потреби підключить менеджера магазину", icon: HelpCircle },
  { step: 4, title: "Зв'язок з менеджером", description: "Якщо потрібна жива людина — створиться тікет і ви продовжите діалог уже з менеджером", icon: Shield },
  { step: 5, title: "Отримайте заміну або кошти", description: "Обмін 3-5 днів, повернення коштів — до 5 робочих днів", icon: CheckCircle2 },
];

// --- Екран 1: категорії флоу (ідентичні SUPPORT_CATEGORY_IDS на бекенді) ------

interface SupportCategoryDef {
  id: SupportCategory;
  title: string;
  subtitle: string;
  icon: typeof ShoppingBag;
  iconClassName: string;
}

const SUPPORT_CATEGORIES: SupportCategoryDef[] = [
  {
    id: "supplier",
    title: "Питання до постачальника",
    subtitle: "Замовлення, товари, доставка",
    icon: ShoppingBag,
    iconClassName: "bg-accent/20 text-accent",
  },
  {
    id: "tech",
    title: "Технічна підтримка",
    subtitle: "Проблеми з додатком, баги",
    icon: Wrench,
    iconClassName: "bg-primary/20 text-primary",
  },
  {
    id: "complaint",
    title: "Скарги",
    subtitle: "На модератора, адміна, продавця",
    icon: AlertTriangle,
    iconClassName: "bg-warning/20 text-warning",
  },
  {
    id: "rating",
    title: "Оцінки",
    subtitle: "Оцінити магазин або додаток",
    icon: Star,
    iconClassName: "bg-amber-500/10 text-amber-500",
  },
];

type FlowScreen = "categories" | "shop_select" | "chat";

/** Внутрішнє повідомлення AI-чату флоу. */
interface FlowMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Кнопка ескалації показується лише на останній відповіді AI. */
  escalate?: boolean;
}

const CHAT_INTRO: Record<SupportCategory, string> = {
  supplier:
    "Опишіть ваше питання — я допомогу з замовленням, товаром чи доставкою. Якщо знадобиться, підключу менеджера магазину.",
  tech: "Що саме не працює? Опишіть проблему з додатком — спробуємо вирішити разом, за потреби передам розробникам.",
  complaint:
    "Розкажіть, що сталося. Вкажіть, на кого скарга (модератор / адміністратор / продавець) та номер замовлення, якщо він є.",
  rating:
    "Дякуємо, що хочете оцінити нас! Скажіть, що бажаєте оцінити — магазин чи сам додаток — і я підкажу, як це зробити.",
};

const Support = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, roles } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState("support");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [isAppRatingOpen, setIsAppRatingOpen] = useState(false);
  const [showCustomerGuide, setShowCustomerGuide] = useState(false);
  const [showSupplierGuide, setShowSupplierGuide] = useState(false);
  const [showModeratorGuide, setShowModeratorGuide] = useState(false);
  const [showManagerGuide, setShowManagerGuide] = useState(false);

  const isAdmin = roles.includes("admin");
  const canSeeSupplierGuide = roles.includes("supplier") || isAdmin;
  const canSeeModeratorGuide = roles.includes("moderator") || isAdmin;
  const canSeeManagerGuide = roles.includes("shop_manager") || isAdmin;

  // --- Багатокроковий флоу: Категорії → AI-Чат → Тікет ----------------------
  const [flowOpen, setFlowOpen] = useState(false);
  const [screen, setScreen] = useState<FlowScreen>("categories");
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [messages, setMessages] = useState<FlowMessage[]>([]);
  const [input, setInput] = useState("");
  const [isAiTyping, setIsAiTyping] = useState(false);

  // Вибраний магазин для категорії «Питання до постачальника»
  const [selectedShop, setSelectedShop] = useState<BackendPublicSupplier | null>(null);
  const [shops, setShops] = useState<BackendPublicSupplier[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopSearch, setShopSearch] = useState("");

  // Ескалація: створення тікета
  const [pendingEscalation, setPendingEscalation] = useState<{
    topic: CreateTicketTopic;
    text: string;
  } | null>(null);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [createdTicketId, setCreatedTicketId] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { items: cartItems, updateQuantity, removeItem } = useCartContext();
  const { totalItems } = useCartContext();
  const { totalFavorites } = useFavoritesContext();

  // Deep-link /support?contact=1 → одразу відкриваємо екран категорій
  useEffect(() => {
    if (searchParams.get("contact") !== "1") return;
    setFlowOpen(true);
    setScreen("categories");
    const next = new URLSearchParams(searchParams);
    next.delete("contact");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAiTyping]);

  const handleTabChange = (tab: string) => {
    if (tab === "catalog") navigate("/");
    else if (tab === "suppliers") navigate("/suppliers");
    else if (tab === "support") setActiveTab(tab);
    else if (tab === "account") navigate("/?tab=account");
    else if (tab === "live") navigate("/?tab=live");
    else navigate("/");
  };

  const handleSearch = (query: string) => {
    setIsSearchOpen(false);
    navigate(`/catalog?q=${encodeURIComponent(query)}`);
  };

  // --- Флоу: Екран 1 → вибір магазину (supplier) або одразу чат ---------------

  const loadShops = async (search?: string) => {
    setShopsLoading(true);
    try {
      const list = await getPublicSuppliers({ search, limit: 30 });
      setShops(list);
    } catch (err) {
      console.error("Error loading shops:", err);
      toast.error("Не вдалося завантажити список магазинів");
    } finally {
      setShopsLoading(false);
    }
  };

  const startCategory = (cat: SupportCategory) => {
    hapticSelection();
    setCategory(cat);
    setMessages([]);
    setPendingEscalation(null);
    setCreatedTicketId(null);
    setInput("");
    setSelectedShop(null);
    if (cat === "supplier") {
      // Питання до конкретного постачальника: спершу обираємо магазин,
      // щоб ескалація потрапила саме менеджеру цього магазину.
      setScreen("shop_select");
      setShopSearch("");
      void loadShops();
    } else {
      setScreen("chat");
      setMessages([
        { id: `intro-${Date.now()}`, role: "assistant", content: CHAT_INTRO[cat] },
      ]);
    }
  };

  const startSupplierChat = (shop: BackendPublicSupplier) => {
    hapticSelection();
    setSelectedShop(shop);
    setScreen("chat");
    setMessages([
      {
        id: `intro-${Date.now()}`,
        role: "assistant",
        content: `Ви обрали магазин «${shop.store_name}». Опишіть ваше питання — я допомогу, а за потреби підключу менеджера цього магазину.`,
      },
    ]);
  };

  const backToCategories = () => {
    hapticSelection();
    setScreen("categories");
    setCategory(null);
    setMessages([]);
    setPendingEscalation(null);
    setCreatedTicketId(null);
    setIsAiTyping(false);
    setSelectedShop(null);
  };

  const closeFlow = () => {
    setFlowOpen(false);
    backToCategories();
  };

  // --- Флоу: надсилання повідомлення в контекстний AI-чат --------------------

  const sendToAi = async (text?: string) => {
    const messageText = (text ?? input).trim();
    if (!messageText || isAiTyping || !category) return;

    const userMsg: FlowMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: messageText,
    };
    // Історія для AI: усі повідомлення, КРІМ вітального тексту категорії
    const history: SupportAiMessage[] = [
      ...messages
        .filter((m) => !(m.role === "assistant" && m.content === CHAT_INTRO[category]))
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: messageText },
    ];

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsAiTyping(true);

    try {
      const result = await supportAiChat(category, history.slice(-12), {
        supplier_id: selectedShop?.id,
      });
      const aiMsg: FlowMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: result.reply,
        escalate: result.escalate,
      };
      setMessages((prev) => [...prev, aiMsg]);
      if (result.escalate && result.ticket_text) {
        setPendingEscalation({
          topic: (result.ticket_topic as CreateTicketTopic) || "other",
          text: result.ticket_text,
        });
      } else {
        setPendingEscalation(null);
      }
    } catch (err) {
      console.error("Support AI chat error:", err);
      const isAuth = err instanceof BackendApiError && (err.status === 401 || err.status === 403);
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: isAuth
            ? "AI-асистент тимчасово недоступний. Зверніться до підтримки пізніше або спробуйте ще раз."
            : "Виникла помилка з'єднання. Спробуйте ще раз.",
        },
      ]);
    } finally {
      setIsAiTyping(false);
    }
  };

  // --- Флоу: Екран 3 — ескалація (створення тікета через POST /api/v1/tickets/)

  const handleEscalate = async () => {
    if (!category || !pendingEscalation || isCreatingTicket) return;

    if (!isAuthenticated) {
      toast.error("Авторизуйтесь, щоб продовжити діалог з менеджером");
      return;
    }

    hapticSelection();
    setIsCreatingTicket(true);
    try {
      // supplier_id тікета: для категорії «Питання до постачальника» —
      // обраний магазин (ескалація йде менеджеру САМЕ цього магазину);
      // для tech/complaint — службовий магазин платформи «Taverna Support».
      let supplierId = selectedShop?.id ?? null;
      if (!supplierId) {
        supplierId = await resolveSupportShopId();
      }
      if (!supplierId) {
        throw new Error("Служба ескалації недоступна. Спробуйте пізніше.");
      }

      const ticket = await createBackendTicket({
        supplier_id: supplierId,
        topic: pendingEscalation.topic,
        text: pendingEscalation.text,
      });

      setCreatedTicketId(ticket.id);
      hapticNotification("success");
      toast.success("Звернення створено! Менеджер відповість вам найближчим часом.");
    } catch (err) {
      console.error("Error creating ticket:", err);
      hapticNotification("error");
      toast.error(
        err instanceof Error || err instanceof BackendApiError
          ? err.message
          : "Не вдалося створити звернення"
      );
    } finally {
      setIsCreatingTicket(false);
    }
  };

  const handleStoreRating = () => {
    toast.info("Оберіть магазин для оцінки");
    navigate("/suppliers");
  };

  const handleAppRating = () => {
    hapticSelection();
    setIsAppRatingOpen(true);
  };

  const categoryDef = category ? SUPPORT_CATEGORIES.find((c) => c.id === category) : null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        cartCount={totalItems}
        favoritesCount={totalFavorites}
        onCartClick={() => setIsCartOpen(true)}
        onSearchClick={() => setIsSearchOpen(true)}
        onNotificationsClick={() => toast.info("Сповіщення")}
        onFavoritesClick={() => setIsWishlistOpen(true)}
        onPromoClick={() => navigate("/promos")}
      />

      <main className="px-4 pt-3 pb-28">
        <div className="flex items-center gap-2 mb-4">
          <HelpCircle className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Підтримка</h1>
        </div>

        <Tabs defaultValue="faq" className="w-full">
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="exchange">Обмін</TabsTrigger>
            <TabsTrigger value="returns">Повернення</TabsTrigger>
          </TabsList>

          <TabsContent value="faq" className="space-y-4">
            <Accordion type="single" collapsible className="space-y-2">
              {faqItems.map((item) => {
                const IconComponent = item.icon;
                return (
                  <AccordionItem key={item.id} value={item.id} className="bg-card rounded-xl border border-border px-4">
                    <AccordionTrigger className="hover:no-underline py-4">
                      <div className="flex items-center gap-3 text-left min-w-0 w-full max-w-full overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <IconComponent className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium text-sm text-gray-900 dark:text-white break-words whitespace-normal">
                          {item.question}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4 pl-11 text-sm text-gray-700 dark:text-gray-300 break-words whitespace-normal">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </TabsContent>

          <TabsContent value="exchange" className="space-y-4">
            <div className="bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl p-4 border border-primary/20">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                  <ArrowLeftRight className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Обмін товару</h3>
                  <p className="text-xs text-muted-foreground">Протягом 14 днів з моменту отримання</p>
                </div>
              </div>
              <div className="bg-success/10 rounded-lg p-2.5 border border-success/30 mt-2">
                <p className="text-xs text-success font-medium">
                  💰 При замовленні від 1 500 ₴ — доставка обміну/повернення за наш рахунок!
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-foreground text-sm">Покрокова інструкція:</h4>
              {exchangeSteps.map((step, index) => {
                const IconComponent = step.icon;
                return (
                  <div key={step.step} className="bg-card rounded-xl p-4 border border-border flex gap-4">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                        {step.step}
                      </div>
                      {index < exchangeSteps.length - 1 && (
                        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-border" />
                      )}
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <IconComponent className="h-4 w-4 text-primary" />
                        <h5 className="font-medium text-foreground text-sm">{step.title}</h5>
                      </div>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-warning/10 rounded-xl p-4 border border-warning/30">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <h5 className="font-medium text-foreground text-sm mb-1">Важливо!</h5>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Товар має бути без слідів використання та в оригінальній упаковці</li>
                    <li>• Обмін на інший розмір/колір — різниця в ціні доплачується</li>
                    <li>• При замовленні від 1 500 ₴ — повернення безкоштовне</li>
                  </ul>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="returns" className="space-y-4">
            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-4">
                <RotateCcw className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">Політика повернення</h3>
              </div>

              <div className="text-sm text-muted-foreground space-y-4">
                <p>
                  Відповідно до Закону України "Про захист прав споживачів", ви маєте право
                  повернути або обміняти товар належної якості протягом <strong className="text-foreground">14 днів</strong>.
                </p>

                <div className="bg-success/10 rounded-xl p-3 border border-success/30">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <h4 className="font-medium text-foreground text-sm">Умови повернення:</h4>
                  </div>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    <li>✓ Товар в оригінальній упаковці</li>
                    <li>✓ Відсутні сліди використання</li>
                    <li>✓ Збережено всі бирки та етикетки</li>
                    <li>✓ Наявний чек або підтвердження замовлення</li>
                  </ul>
                </div>

                <div className="bg-primary/5 rounded-xl p-3 border border-primary/20">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowLeftRight className="h-4 w-4 text-primary" />
                    <h4 className="font-medium text-foreground text-sm">Безкоштовне повернення:</h4>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    При сумі замовлення <strong className="text-foreground">від 1 500 ₴</strong> — доставку
                    обміну або повернення оплачує наш магазин.
                  </p>
                </div>

                <div className="bg-destructive/10 rounded-xl p-3 border border-destructive/30">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <h4 className="font-medium text-foreground text-sm">Не підлягають поверненню:</h4>
                  </div>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    <li>✗ Натільна білизна та шкарпетки</li>
                    <li>✗ Товари особистої гігієни</li>
                    <li>✗ Ножі та гострі предмети</li>
                    <li>✗ Товари, виготовлені на замовлення</li>
                  </ul>
                </div>

                <div className="bg-muted/50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <h4 className="font-medium text-foreground text-sm">Терміни повернення коштів:</h4>
                  </div>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    <li>• Картка — 3-5 робочих днів</li>
                    <li>• Накладений платіж — до 7 робочих днів</li>
                    <li>• Криптовалюта — до 24 годин</li>
                  </ul>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold text-foreground px-1">Інструкції</h2>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              setShowCustomerGuide(true);
            }}
            className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <HelpCircle className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">Як користуватись</p>
              <p className="text-xs text-muted-foreground">Інструкція для покупців і гостей</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
          {canSeeSupplierGuide && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setShowSupplierGuide(true);
              }}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Інструкція постачальника</p>
                <p className="text-xs text-muted-foreground">Черга, націнки, реклама</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
          {canSeeModeratorGuide && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setShowModeratorGuide(true);
              }}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-orange-500" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Інструкція модератора</p>
                <p className="text-xs text-muted-foreground">Скарги, повернення, чати</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
          {canSeeManagerGuide && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setShowManagerGuide(true);
              }}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Store className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Інструкція менеджера</p>
                <p className="text-xs text-muted-foreground">Замовлення магазину та чати клієнтів</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Contact Support Button — відкриває багатокроковий флоу */}
        <div className="mt-6">
          <Button onClick={() => setFlowOpen(true)} className="w-full" size="lg">
            <MessageCircle className="h-5 w-5 mr-2" />
            Зв'язатися з підтримкою
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            AI-асистент відповідає миттєво • Менеджер — до 15 хвилин
          </p>
        </div>
      </main>

      {/* ================================================================
          БАГАТОКРОКОВИЙ ФЛОУ: Категорії → Контекстний AI-Чат → Тікет
          ================================================================ */}
      {flowOpen && (
        <div className="fixed inset-0 z-[80] bg-background flex flex-col">
          {/* === ЕКРАН 1: Категорії === */}
          {screen === "categories" && (
            <>
              <div className="shrink-0 border-b border-border bg-background">
                <div className="flex items-center gap-3 p-4">
                  <button
                    onClick={closeFlow}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    aria-label="Закрити"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-foreground">Чим можемо допомогти?</h2>
                    <p className="text-xs text-muted-foreground">Оберіть категорію — AI підкаже рішення</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {SUPPORT_CATEGORIES.map((cat) => {
                  const IconComponent = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => startCategory(cat.id)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary hover:bg-primary/5 transition-all text-left group"
                    >
                      <div className={cn("w-12 h-12 rounded-full flex items-center justify-center shrink-0", cat.iconClassName)}>
                        <IconComponent className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground">{cat.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{cat.subtitle}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  );
                })}

                {/* Оцінки: швидкі дії прямо з екрану категорій */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleStoreRating}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border hover:border-amber-500/50 transition-all"
                  >
                    <Store className="h-5 w-5 text-amber-500" />
                    <span className="text-xs font-medium text-foreground">Оцінити магазин</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAppRating}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border hover:border-amber-500/50 transition-all"
                  >
                    <Star className="h-5 w-5 text-amber-500" />
                    <span className="text-xs font-medium text-foreground">Оцінити додаток</span>
                  </button>
                </div>

                <p className="text-[11px] text-muted-foreground text-center pt-2">
                  Не знайшли відповіді? Спробуйте наш швидкий AI-помічник — він доступний 24/7
                </p>
              </div>
            </>
          )}

          {/* === ЕКРАН 1.5: Вибір магазину (категорія «Постачальник») === */}
          {screen === "shop_select" && (
            <>
              <div className="shrink-0 border-b border-border bg-background">
                <div className="flex items-center gap-3 p-4">
                  <button
                    onClick={backToCategories}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    aria-label="Назад до категорій"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-foreground">Оберіть магазин</h2>
                    <p className="text-xs text-muted-foreground">
                      До якого постачальника ваше питання?
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Пошук магазину */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadShops(shopSearch.trim() || undefined);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={shopSearch}
                    onChange={(e) => setShopSearch(e.target.value)}
                    placeholder="Пошук магазину за назвою…"
                    className="flex-1 h-10 px-4 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <Button type="submit" variant="outline" className="shrink-0" size="sm">
                    Знайти
                  </Button>
                </form>

                {shopsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </div>
                ) : shops.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">
                    Магазинів не знайдено. Спробуйте інший запит або поверніться назад.
                  </p>
                ) : (
                  shops.map((shop) => (
                    <button
                      key={shop.id}
                      type="button"
                      onClick={() => startSupplierChat(shop)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-card border border-border hover:border-primary hover:bg-primary/5 transition-all text-left group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 font-bold text-primary">
                        {(shop.store_name || "М").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm truncate">
                          {shop.store_name}
                        </p>
                        {typeof shop.product_count === "number" && (
                          <p className="text-xs text-muted-foreground">
                            {shop.product_count} товарів
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* === ЕКРАН 2: Контекстний AI-Чат === */}
          {screen === "chat" && category && categoryDef && (
            <>
              {/* Шапка чату з кнопкою «← Назад» до категорій */}
              <div className="shrink-0 border-b border-border bg-gradient-to-r from-primary to-accent text-primary-foreground">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={backToCategories}
                    className="h-9 px-3 rounded-xl bg-white/20 flex items-center gap-1.5 hover:bg-white/30 transition-colors text-primary-foreground text-sm font-medium shrink-0"
                    aria-label="Назад до категорій"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Назад
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0" />
                      <h2 className="font-semibold text-sm truncate">AI-підтримка</h2>
                    </div>
                    <p className="text-[11px] opacity-80 truncate">
                      {selectedShop ? `Магазин: ${selectedShop.store_name}` : categoryDef.title}
                    </p>
                  </div>
                  <button
                    onClick={closeFlow}
                    className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors shrink-0"
                    aria-label="Закрити чат"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Повідомлення */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-2.5",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </div>
                ))}

                {isAiTyping && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Ескалація: AI визначив, що потрібна людина */}
                {pendingEscalation && !isAiTyping && (
                  <div className="pt-2">
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <LifeBuoy className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            Підключаємо живу людину
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Створимо звернення — менеджер побачить всю історію вашого діалогу з AI та продовжить розмову.
                          </p>
                        </div>
                      </div>

                      {createdTicketId ? (
                        /* Тікет створено — показуємо кнопку переходу до панелі */
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            Звернення №{createdTicketId} створено
                          </div>
                          <Button
                            className="w-full gap-2"
                            onClick={() => {
                              hapticSelection();
                              navigate("/support/panel");
                            }}
                          >
                            <UserCheck className="h-4 w-4" />
                            Перейти до чату з менеджером
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="w-full gap-2"
                          onClick={handleEscalate}
                          disabled={isCreatingTicket}
                        >
                          {isCreatingTicket ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Створюємо звернення…
                            </>
                          ) : (
                            <>
                              <MessageCircle className="h-4 w-4" />
                              Створити звернення до менеджера
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Інпут */}
              <div className="shrink-0 border-t border-border p-3 pb-safe">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendToAi();
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Опишіть проблему…"
                    className="flex-1 h-11 px-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    disabled={isAiTyping}
                    maxLength={4000}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!input.trim() || isAiTyping}
                    className="h-11 w-11 rounded-xl shrink-0"
                    aria-label="Надіслати"
                  >
                    {isAiTyping ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </Button>
                </form>
                <p className="text-[10px] text-center text-muted-foreground mt-1.5">
                  Працює на базі Google Gemini AI • Відповіді не є статусами замовлень
                </p>
              </div>
            </>
          )}
        </div>
      )}

      <AppRatingModal isOpen={isAppRatingOpen} onClose={() => setIsAppRatingOpen(false)} type="app" />
      <CustomerGuideModal
        isOpen={showCustomerGuide}
        onClose={() => setShowCustomerGuide(false)}
      />
      <SupplierGuideModal
        isOpen={showSupplierGuide}
        onClose={() => setShowSupplierGuide(false)}
      />
      <ModeratorGuideModal
        isOpen={showModeratorGuide}
        onClose={() => setShowModeratorGuide(false)}
      />
      <ManagerGuideModal
        isOpen={showManagerGuide}
        onClose={() => setShowManagerGuide(false)}
      />

      <BottomNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} onSearch={handleSearch} />

      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeItem}
        onCheckout={() => { setIsCartOpen(false); navigate("/"); }}
      />

      <WishlistModal
        isOpen={isWishlistOpen}
        onClose={() => setIsWishlistOpen(false)}
        onProductClick={(id) => { setIsWishlistOpen(false); navigate(`/product/${id}`); }}
      />
    </div>
  );
};

export default Support;

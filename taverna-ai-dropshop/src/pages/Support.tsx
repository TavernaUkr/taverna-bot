import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  Phone,
  Loader2,
  Star,
  AlertTriangle,
  ArrowLeft,
  Shield,
  Store
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCartContext } from "@/contexts/CartContext";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { useSupportTickets, TicketType } from "@/hooks/useSupportTickets";
import { SearchModal } from "@/components/SearchModal";
import { CartModal } from "@/components/CartModal";
import { WishlistModal } from "@/components/WishlistModal";
import { AppRatingModal } from "@/components/AppRatingModal";
import { toast } from "sonner";
import { hapticSelection, hapticNotification } from "@/lib/haptics";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        openTelegramLink: (url: string) => void;
        sendData: (data: string) => void;
        close: () => void;
      };
    };
  }
}

const faqItems = [
  {
    id: "delivery",
    question: "Як здійснюється доставка?",
    answer: "Доставка здійснюється через Нову Пошту по всій Україні. Термін доставки 1-3 робочих дні. Ви можете обрати доставку до відділення або адресну доставку кур'єром.",
    icon: Truck,
  },
  {
    id: "payment",
    question: "Які способи оплати доступні?",
    answer: "Ми приймаємо оплату карткою онлайн, накладеним платежем при отриманні та криптовалютою (USDT). При передоплаті діє знижка 3%.",
    icon: CreditCard,
  },
  {
    id: "returns",
    question: "Як повернути або обміняти товар?",
    answer: "Повернення або обмін можливий протягом 14 днів з моменту отримання. Товар має бути в оригінальній упаковці та без слідів використання. Зверніться до служби підтримки для оформлення повернення.",
    icon: RotateCcw,
  },
  {
    id: "order-status",
    question: "Як відстежити замовлення?",
    answer: "Після відправлення замовлення ви отримаєте номер ТТН Нової Пошти. Відстежити статус можна в розділі 'Замовлення' у вашому профілі або на сайті Нової Пошти.",
    icon: Package,
  },
  {
    id: "warranty",
    question: "Чи є гарантія на товари?",
    answer: "Так, на всі товари надається гарантія від виробника. Термін гарантії залежить від категорії товару та вказаний на сторінці товару.",
    icon: HelpCircle,
  },
  {
    id: "free-return",
    question: "Хто оплачує повернення/обмін?",
    answer: "Якщо сума вашого замовлення перевищує 1500 ₴ — доставку обміну/повернення оплачує наш магазин. В іншому випадку — за рахунок покупця.",
    icon: ArrowLeftRight,
  },
];

const exchangeSteps = [
  { step: 1, title: "Зверніться до підтримки", description: "Натисніть 'Зв'язатися з підтримкою' → 'Питання до постачальника'", icon: MessageCircle },
  { step: 2, title: "Оберіть замовлення", description: "Бот допоможе вам обрати конкретне замовлення та товар", icon: Package },
  { step: 3, title: "Опишіть проблему", description: "AI-асистент з'ясує деталі та запропонує рішення", icon: HelpCircle },
  { step: 4, title: "Зв'язок з менеджером", description: "Якщо потрібен обмін — бот з'єднає вас з менеджером магазину анонімно", icon: Shield },
  { step: 5, title: "Отримайте заміну або кошти", description: "Обмін 3-5 днів, повернення коштів — до 5 робочих днів", icon: CheckCircle2 },
];

type ModalView = "main" | "complaints" | "ratings";

const Support = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useTelegramAuthContext();
  const { getOrCreateTicket, isLoading: ticketLoading } = useSupportTickets();
  const [activeTab, setActiveTab] = useState("support");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [modalView, setModalView] = useState<ModalView>("main");
  const [isAppRatingOpen, setIsAppRatingOpen] = useState(false);
  
  const { items: cartItems, totalItems, updateQuantity, removeItem } = useCartContext();
  const { totalFavorites } = useFavoritesContext();

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
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const handleOpenSupportModal = () => {
    setModalView("main");
    setIsSupportModalOpen(true);
  };

  const handleStartChat = async (type: TicketType) => {
    hapticSelection();
    
    if (!isAuthenticated) {
      toast.error("Авторизуйтесь для створення звернення");
      setIsSupportModalOpen(false);
      return;
    }

    const ticket = await getOrCreateTicket(type);
    
    if (ticket) {
      hapticNotification("success");
      setIsSupportModalOpen(false);
      navigate(`/support/chat/${ticket.id}`);
    } else {
      hapticNotification("error");
      toast.error("Не вдалося створити звернення");
    }
  };

  const handleComplaint = (type: "complaint_admin" | "complaint_supplier") => {
    handleStartChat(type as TicketType);
  };

  const handleStoreRating = () => {
    setIsSupportModalOpen(false);
    navigate("/suppliers");
    toast.info("Оберіть магазин для оцінки");
  };

  const handleAppRating = () => {
    setIsSupportModalOpen(false);
    setIsAppRatingOpen(true);
  };

  const ModalBackButton = () => (
    <button
      onClick={() => setModalView("main")}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
    >
      <ArrowLeft className="h-4 w-4" />
      Назад
    </button>
  );

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
      
      <main className="px-4 py-4 pb-28">
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
                      <div className="flex items-center gap-3 text-left">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <IconComponent className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium text-sm">{item.question}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4 pl-11 text-sm text-muted-foreground">
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

        {/* Contact Support Button */}
        <div className="mt-6">
          <Button onClick={handleOpenSupportModal} className="w-full" size="lg">
            <MessageCircle className="h-5 w-5 mr-2" />
            Зв'язатися з підтримкою
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            AI-асистент відповідає миттєво • Менеджер — до 15 хвилин
          </p>
        </div>
      </main>

      {/* Support Type Selection Modal */}
      <Dialog open={isSupportModalOpen} onOpenChange={setIsSupportModalOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              {modalView === "main" && "Оберіть тип запиту"}
              {modalView === "complaints" && "Скарги"}
              {modalView === "ratings" && "Оцінки"}
            </DialogTitle>
            <DialogDescription>
              {modalView === "main" && "Оберіть категорію, щоб ми могли швидше вам допомогти"}
              {modalView === "complaints" && "Оберіть тип скарги"}
              {modalView === "ratings" && "Що бажаєте оцінити?"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 mt-2">
            {modalView === "main" && (
              <>
                {/* Supplier Query */}
                <button
                  onClick={() => handleStartChat("supplier_question")}
                  disabled={ticketLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary hover:bg-primary/5 transition-all text-left group disabled:opacity-50"
                >
                  <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center group-hover:bg-accent/30 transition-colors">
                    {ticketLoading ? (
                      <Loader2 className="h-6 w-6 text-accent animate-spin" />
                    ) : (
                      <ShoppingBag className="h-6 w-6 text-accent" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Питання до постачальника</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Замовлення, товари, доставка, обмін, повернення
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </button>

                {/* Technical Support */}
                <button
                  onClick={() => handleStartChat("tech_support")}
                  disabled={ticketLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary hover:bg-primary/5 transition-all text-left group disabled:opacity-50"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                    {ticketLoading ? (
                      <Loader2 className="h-6 w-6 text-primary animate-spin" />
                    ) : (
                      <Wrench className="h-6 w-6 text-primary" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Технічна підтримка</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Проблеми з додатком, помилки, пропозиції
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </button>

                {/* Complaints */}
                <button
                  onClick={() => setModalView("complaints")}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-warning/50 hover:bg-warning/5 transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center group-hover:bg-warning/30 transition-colors">
                    <AlertTriangle className="h-6 w-6 text-warning" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Скарги</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      На модератора, адміна або постачальника
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-warning transition-colors" />
                </button>

                {/* Ratings */}
                <button
                  onClick={() => setModalView("ratings")}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-warning/50 hover:bg-warning/5 transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center group-hover:bg-warning/20 transition-colors">
                    <Star className="h-6 w-6 text-warning" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Оцінки</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Оцініть магазин або додаток
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-warning transition-colors" />
                </button>
              </>
            )}

            {/* Complaints Sub-menu */}
            {modalView === "complaints" && (
              <>
                <ModalBackButton />
                <button
                  onClick={() => handleComplaint("complaint_admin")}
                  disabled={ticketLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-destructive/50 hover:bg-destructive/5 transition-all text-left group disabled:opacity-50"
                >
                  <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-destructive" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Скарга на модератора/адміна</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Неправомірні дії з боку персоналу
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>

                <button
                  onClick={() => handleComplaint("complaint_supplier")}
                  disabled={ticketLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-warning/50 hover:bg-warning/5 transition-all text-left group disabled:opacity-50"
                >
                  <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                    <Store className="h-6 w-6 text-warning" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Скарга на постачальника</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Якість товару, обслуговування, обман
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>

                <div className="bg-muted/50 rounded-xl p-3 mt-2">
                  <p className="text-xs text-muted-foreground text-center">
                    🔒 Всі скарги анонімні та розглядаються керівництвом платформи
                  </p>
                </div>
              </>
            )}

            {/* Ratings Sub-menu */}
            {modalView === "ratings" && (
              <>
                <ModalBackButton />
                <button
                  onClick={handleStoreRating}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-warning/50 hover:bg-warning/5 transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                    <Store className="h-6 w-6 text-warning" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Оцінка магазину</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Оцініть якість обслуговування магазину
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>

                <button
                  onClick={handleAppRating}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Star className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Оцінка додатку</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Допоможіть нам стати кращими
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>
              </>
            )}
          </div>

          {modalView === "main" && (
            <div className="mt-2 pt-3 border-t border-border">
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />
                <span>Гаряча лінія: +380 (44) 123-45-67</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AppRatingModal isOpen={isAppRatingOpen} onClose={() => setIsAppRatingOpen(false)} type="app" />

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

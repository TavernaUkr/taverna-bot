import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ShoppingCart, 
  Truck, 
  CreditCard, 
  HeartHandshake,
  Shield,
  Package,
  Sparkles,
  CheckCircle,
  Users,
  Gift,
  ChevronRight,
  MessageCircle,
  Star,
  Zap,
  ArrowRight
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface CustomerGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerGuideModal = ({ isOpen, onClose }: CustomerGuideModalProps) => {
  const navigate = useNavigate();

  const handleBecomePartner = () => {
    onClose();
    navigate('/partner');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Як користуватись Taverna
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <div className="p-4 pt-2">
            <Tabs defaultValue="howto" className="w-full">
              <TabsList className="w-full grid grid-cols-4 mb-4">
                <TabsTrigger value="howto" className="text-xs">
                  <ShoppingCart className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="delivery" className="text-xs">
                  <Truck className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="partner" className="text-xs">
                  <Users className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="tech" className="text-xs">
                  <Sparkles className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>

              {/* How to Order Tab */}
              <TabsContent value="howto" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                    Як зробити замовлення?
                  </h3>

                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">1</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Оберіть товар</h4>
                        <p className="text-xs text-muted-foreground">
                          Перегляньте каталог або скористайтесь пошуком
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">2</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Оберіть розмір/колір</h4>
                        <p className="text-xs text-muted-foreground">
                          Виберіть потрібний варіант товару
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">3</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Додайте в кошик</h4>
                        <p className="text-xs text-muted-foreground">
                          Можете додати кілька товарів
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">4</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Оформіть замовлення</h4>
                        <p className="text-xs text-muted-foreground">
                          Вкажіть адресу доставки та спосіб оплати
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-success/10 border border-success/20 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Gift className="h-4 w-4 text-success mt-0.5" />
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Гостьове замовлення</h4>
                        <p className="text-xs text-muted-foreground">
                          Можна замовити без авторизації! Просто вкажіть ваші контакти при оформленні.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Delivery Tab */}
              <TabsContent value="delivery" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Truck className="h-4 w-4 text-primary" />
                    Доставка та оплата
                  </h3>

                  <div className="space-y-2">
                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#E62E2E]/20 flex items-center justify-center">
                          <Package className="h-5 w-5 text-[#E62E2E]" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Нова Пошта</h4>
                          <p className="text-xs text-muted-foreground">На відділення або поштомат</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Truck className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Адресна доставка</h4>
                          <p className="text-xs text-muted-foreground">Кур'єром до дверей</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <h4 className="font-medium text-foreground text-sm mt-4 flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Способи оплати:
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg text-sm">
                      <CheckCircle className="h-4 w-4 text-success" />
                      Оплата при отриманні (накладений платіж)
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg text-sm">
                      <CheckCircle className="h-4 w-4 text-success" />
                      Telegram Wallet (TON/USDT)
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg text-sm">
                      <CheckCircle className="h-4 w-4 text-success" />
                      Банківська картка (скоро)
                    </div>
                  </div>

                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Shield className="h-4 w-4 text-primary mt-0.5" />
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Гарантії</h4>
                        <p className="text-xs text-muted-foreground">
                          14 днів на повернення або обмін товару згідно ЗУ "Про захист прав споживачів"
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Become Partner Tab */}
              <TabsContent value="partner" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Users className="h-4 w-4 text-accent" />
                    Як стати партнером?
                  </h3>

                  <p className="text-sm text-muted-foreground">
                    Ви маєте товари і хочете їх продавати через Taverna? Це просто!
                  </p>

                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0">1</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Реєстрація ФОП/ТОВ</h4>
                        <p className="text-xs text-muted-foreground">
                          Потрібен код ЄДРПОУ та офіційна реєстрація
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0">2</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Заповніть форму</h4>
                        <p className="text-xs text-muted-foreground">
                          Вкажіть контакти та посилання на XML-фід товарів
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0">3</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">AI-перевірка</h4>
                        <p className="text-xs text-muted-foreground">
                          Наш AI перевірить асортимент на унікальність
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-muted rounded-xl">
                      <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0">4</span>
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Модерація</h4>
                        <p className="text-xs text-muted-foreground">
                          Адмін схвалить заявку — і ви в системі!
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-success/10 border border-success/20 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Star className="h-4 w-4 text-success mt-0.5" />
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Що отримуєте:</h4>
                        <ul className="text-xs text-muted-foreground space-y-1 mt-1">
                          <li>• Безкоштовну рекламу на 10+ платформах</li>
                          <li>• AI-генерацію описів для маркетплейсів</li>
                          <li>• Панель управління замовленнями</li>
                          <li>• Пріоритетний постинг перші 7 днів</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <Button 
                    onClick={handleBecomePartner}
                    className="w-full gap-2"
                  >
                    Подати заявку
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </TabsContent>

              {/* Technology Tab */}
              <TabsContent value="tech" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent" />
                    Що ми використовуємо?
                  </h3>

                  <p className="text-sm text-muted-foreground">
                    Taverna Group побудована на сучасних технологіях:
                  </p>

                  <div className="space-y-2">
                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#0088CC]/20 flex items-center justify-center">
                          <MessageCircle className="h-4 w-4 text-[#0088CC]" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Telegram Mini App</h4>
                          <p className="text-xs text-muted-foreground">
                            Повноцінний магазин прямо в Telegram
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                          <Sparkles className="h-4 w-4 text-accent" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Gemini AI</h4>
                          <p className="text-xs text-muted-foreground">
                            Генерація описів та категоризація товарів
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-success/20 flex items-center justify-center">
                          <Shield className="h-4 w-4 text-success" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Supabase</h4>
                          <p className="text-xs text-muted-foreground">
                            Захищена база даних з RLS-політиками
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#E62E2E]/20 flex items-center justify-center">
                          <Truck className="h-4 w-4 text-[#E62E2E]" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Nova Poshta API</h4>
                          <p className="text-xs text-muted-foreground">
                            Автоматичний розрахунок доставки та трекінг
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Zap className="h-4 w-4 text-primary mt-0.5" />
                      <div>
                        <h4 className="font-medium text-foreground text-sm">AI-помічник</h4>
                        <p className="text-xs text-muted-foreground">
                          Наш чат-бот допоможе знайти товар, перевірити статус замовлення 
                          або проаналізувати фото для підбору розміру.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
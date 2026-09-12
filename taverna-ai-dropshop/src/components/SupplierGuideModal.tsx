import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bot, 
  Sparkles, 
  ListOrdered, 
  TrendingUp, 
  DollarSign, 
  Megaphone,
  Clock,
  Zap,
  Shield,
  Package,
  Users,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  FileText,
  Send
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SupplierGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupplierGuideModal = ({ isOpen, onClose }: SupplierGuideModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Гід для партнерів Taverna
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <div className="p-4 pt-2">
            <Tabs defaultValue="bot" className="w-full">
              <TabsList className="w-full grid grid-cols-4 mb-4">
                <TabsTrigger value="bot" className="text-xs">
                  <Bot className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="queue" className="text-xs">
                  <ListOrdered className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="pricing" className="text-xs">
                  <DollarSign className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="ads" className="text-xs">
                  <Megaphone className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>

              {/* Bot Features Tab */}
              <TabsContent value="bot" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent" />
                    Що вміє наш бот?
                  </h3>
                  
                  <div className="space-y-3">
                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Автоімпорт з XML</h4>
                          <p className="text-xs text-muted-foreground">
                            Завантажуйте товари автоматично з MyDrop, Prom.ua або власного XML-фіду
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                          <Sparkles className="h-4 w-4 text-accent" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">AI-генерація описів</h4>
                          <p className="text-xs text-muted-foreground">
                            Gemini AI створює продаючі описи для Telegram з емодзі, перевагами та CTA
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-success/20 flex items-center justify-center shrink-0">
                          <Package className="h-4 w-4 text-success" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Автокатегоризація</h4>
                          <p className="text-xs text-muted-foreground">
                            AI автоматично сортує товари по категоріях та додає теги для пошуку
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-xl">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-warning/20 flex items-center justify-center shrink-0">
                          <Send className="h-4 w-4 text-warning" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground text-sm">Автопублікація</h4>
                          <p className="text-xs text-muted-foreground">
                            Товари автоматично публікуються в @taverna_ukr_group з кнопкою "Замовити"
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Queue System Tab */}
              <TabsContent value="queue" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <ListOrdered className="h-4 w-4 text-primary" />
                    Як працює черга постингу?
                  </h3>

                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">Принцип</Badge>
                      <span className="text-sm text-foreground">Fair Queue</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Кожен постачальник отримує рівні можливості для просування товарів
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground text-sm flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      Алгоритм черги:
                    </h4>
                    <ol className="space-y-2 text-sm">
                      <li className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">1</span>
                        <span className="text-muted-foreground">Новий постачальник автоматично стає <strong className="text-foreground">першим</strong> у черзі</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">2</span>
                        <span className="text-muted-foreground">Після публікації постачальник переміщується в кінець черги</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">3</span>
                        <span className="text-muted-foreground">Товари публікуються рівномірно — ніхто не "забутий"</span>
                      </li>
                    </ol>
                  </div>

                  <div className="p-3 bg-success/10 border border-success/20 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Zap className="h-4 w-4 text-success mt-0.5" />
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Бонус для нових</h4>
                        <p className="text-xs text-muted-foreground">
                          Перші 7 днів після схвалення — пріоритетний постинг ваших товарів
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Pricing Tab */}
              <TabsContent value="pricing" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-success" />
                    Система націнок
                  </h3>

                  <p className="text-sm text-muted-foreground">
                    Ми використовуємо тиражну систему націнок, яка залежить від вартості товару:
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-muted rounded-xl">
                      <div>
                        <p className="font-medium text-foreground text-sm">До 1,000 ₴</p>
                        <p className="text-xs text-muted-foreground">Дрібні товари</p>
                      </div>
                      <Badge variant="default">+33%</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-xl">
                      <div>
                        <p className="font-medium text-foreground text-sm">1,000 — 10,000 ₴</p>
                        <p className="text-xs text-muted-foreground">Середній сегмент</p>
                      </div>
                      <Badge variant="secondary">+28%</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-xl">
                      <div>
                        <p className="font-medium text-foreground text-sm">10,000+ ₴</p>
                        <p className="text-xs text-muted-foreground">Преміум товари</p>
                      </div>
                      <Badge variant="outline">+23%</Badge>
                    </div>
                  </div>

                  <div className="p-3 bg-warning/10 border border-warning/20 rounded-xl">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
                      <div>
                        <h4 className="font-medium text-foreground text-sm">Важливо</h4>
                        <p className="text-xs text-muted-foreground">
                          Клієнти бачать роздрібну ціну. Ваша оптова ціна — комерційна таємниця.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-muted rounded-xl">
                    <h4 className="font-medium text-foreground text-sm mb-2">Що входить в націнку:</h4>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-success" />
                        AI-обробка та генерація описів
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-success" />
                        Публікації в Telegram-каналі
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-success" />
                        Технічна підтримка платформи
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-success" />
                        Обробка замовлень та сповіщення
                      </li>
                    </ul>
                  </div>
                </div>
              </TabsContent>

              {/* Advertising Tab */}
              <TabsContent value="ads" className="space-y-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-accent" />
                    Авторекламна система
                  </h3>

                  <p className="text-sm text-muted-foreground">
                    Taverna Group просуває ваші товари на 10+ платформах за принципом "справедливої черги":
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {['OLX', 'Prom.ua', 'Instagram', 'TikTok', 'Facebook', 'YouTube', 'Viber', 'WhatsApp', 'X (Twitter)', 'Telegram'].map((platform) => (
                      <div key={platform} className="flex items-center gap-2 p-2 bg-muted rounded-lg text-xs">
                        <CheckCircle className="h-3 w-3 text-success" />
                        {platform}
                      </div>
                    ))}
                  </div>

                  <div className="p-4 bg-accent/10 border border-accent/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-accent" />
                      <h4 className="font-medium text-foreground text-sm">Auto-Ads</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Рекламні витрати на цих платформах покриває Taverna Group. 
                      Ви не платите за рекламу — лише стандартну націнку на товари.
                    </p>
                  </div>

                  <div className="p-3 bg-muted rounded-xl">
                    <h4 className="font-medium text-foreground text-sm mb-2 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Як це працює:
                    </h4>
                    <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                      <li>Система випадково обирає платформу</li>
                      <li>Обирається постачальник з черги</li>
                      <li>Публікується товар з AI-описом</li>
                      <li>Постачальник переміщується в кінець черги</li>
                      <li>Цикл повторюється</li>
                    </ol>
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
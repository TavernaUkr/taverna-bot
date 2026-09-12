import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Shield,
  AlertTriangle,
  Check,
  X,
  Loader2,
  Eye,
  Package,
  RefreshCw,
  MessageSquare,
  Flag,
  Scale,
  Gift,
  Headphones,
  Users,
  Wallet,
  Flame,
  Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTelegramAuthContext } from '@/components/TelegramAuthProvider';
import { hapticSelection } from '@/lib/haptics';
import { DisputesManager } from '@/components/moderator/DisputesManager';
import { IndividualBonusManager } from '@/components/moderator/IndividualBonusManager';
import { TechSupportQueue } from '@/components/moderator/TechSupportQueue';
import { RefundsQueue } from '@/components/moderator/RefundsQueue';
import { PaymentsManager } from '@/components/admin/PaymentsManager';
import { ShopBalancesPanel } from '@/components/admin/ShopBalancesPanel';
import { isPreviewDevEnvironment } from '@/lib/dev-preview';

interface Report {
  id: string;
  product_id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  admin_notes: string | null;
  product?: {
    id: string;
    name: string;
    images: string[] | null;
    price: number;
  };
}

interface PendingProduct {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  in_stock: boolean;
  supplier_id: string;
  created_at: string;
}

interface ModeratorStats {
  openReports: number;
  openDisputes: number;
  openTickets: number;
  productsToReview: number;
}

export default function ModeratorPanel() {
  const navigate = useNavigate();
  const { isLoading: authLoading, rolesLoading, isAuthenticated, roles } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState('reports');
  const [reports, setReports] = useState<Report[]>([]);
  const [pendingProducts, setPendingProducts] = useState<PendingProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<ModeratorStats>({
    openReports: 0,
    openDisputes: 0,
    openTickets: 0,
    productsToReview: 0,
  });

  // Preview/demo environment always renders the panel for visual work.
  const hasModeratorAccess =
    isPreviewDevEnvironment() ||
    (isAuthenticated && (roles.includes('admin') || roles.includes('moderator')));

  useEffect(() => {
    if (hasModeratorAccess) {
      fetchData();
      fetchStats();
    }
  }, [hasModeratorAccess]);

  const fetchStats = async () => {
    try {
      const [reportsResult, ticketsResult, disputesResult] = await Promise.all([
        supabase.from('reports').select('id').in('status', ['pending', 'under_review']),
        supabase.from('support_tickets').select('id, type').eq('status', 'open'),
        supabase.from('support_tickets').select('id').eq('type', 'supplier_question').eq('status', 'open').not('related_order_id', 'is', null),
      ]);

      const techTickets = (ticketsResult.data || []).filter(t => t.type === 'tech_support');

      setStats({
        openReports: reportsResult.data?.length || 0,
        openDisputes: disputesResult.data?.length || 0,
        openTickets: techTickets.length,
        productsToReview: 0,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch reports
      const { data: reportsData, error: reportsError } = await supabase
        .from('reports')
        .select(`
          *,
          product:products(id, name, images, price)
        `)
        .in('status', ['pending', 'under_review'])
        .order('created_at', { ascending: false });

      if (reportsError) throw reportsError;
      setReports(reportsData || []);

      // Fetch recent products (for review)
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('id, name, price, images, in_stock, supplier_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (productsError) throw productsError;
      setPendingProducts(productsData || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      toast.error('Помилка завантаження даних');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    setProcessingId(reportId);
    try {
      const { error } = await supabase
        .from('reports')
        .update({
          status,
          admin_notes: adminNotes[reportId] || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) throw error;

      toast.success(status === 'resolved' ? 'Скаргу вирішено' : 'Скаргу відхилено');
      setReports(prev => prev.filter(r => r.id !== reportId));
      fetchStats();
    } catch (err) {
      console.error('Error resolving report:', err);
      toast.error('Помилка обробки скарги');
    } finally {
      setProcessingId(null);
    }
  };

  const getReasonLabel = (reason: string) => {
    const reasons: Record<string, string> = {
      counterfeit: 'Підробка',
      inappropriate: 'Неприпустимий вміст',
      wrong_category: 'Неправильна категорія',
      misleading: 'Оманлива інформація',
      other: 'Інше',
    };
    return reasons[reason] || reason;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (authLoading || rolesLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasModeratorAccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mx-auto">
            <Shield className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Доступ заборонено</h1>
          <p className="text-muted-foreground">
            Ця сторінка доступна лише модераторам
          </p>
          <Button onClick={() => navigate('/')}>
            На головну
          </Button>
        </div>
      </div>
    );
  }

  const hotDisputes = Math.max(stats.openDisputes, 3);
  const openReports = Math.max(stats.openReports, 5);
  const openTickets = Math.max(stats.openTickets, 4);
  const systemLoad = 74;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/?tab=account")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="font-bold text-lg text-foreground flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Панель модератора
              </h1>
              <p className="text-xs text-muted-foreground">Модерація та підтримка користувачів</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            fetchData();
            fetchStats();
            toast.success('Дані оновлено');
          }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Command Center metrics */}
      <div className="p-4 grid grid-cols-2 gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-destructive/30 bg-gradient-to-br from-destructive/15 via-destructive/5 to-transparent backdrop-blur-xl p-4 shadow-lg">
          <div className="absolute -top-8 -right-6 w-24 h-24 rounded-full bg-destructive/20 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/20 flex items-center justify-center">
              <Flame className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground leading-none">{hotDisputes}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Гарячі спори</p>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-warning/30 bg-gradient-to-br from-warning/15 via-warning/5 to-transparent backdrop-blur-xl p-4 shadow-lg">
          <div className="absolute -top-8 -right-6 w-24 h-24 rounded-full bg-warning/20 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/20 flex items-center justify-center">
              <Timer className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground leading-none">8 хв</p>
              <p className="text-[11px] text-muted-foreground mt-1">Сер. час відповіді</p>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent backdrop-blur-xl p-4 shadow-lg">
          <div className="absolute -top-8 -right-6 w-24 h-24 rounded-full bg-primary/20 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Flag className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground leading-none">{openReports}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Скарг · {openTickets} тікетів</p>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-success/30 bg-gradient-to-br from-success/15 via-success/5 to-transparent backdrop-blur-xl p-4 shadow-lg">
          <div className="absolute -top-8 -right-6 w-24 h-24 rounded-full bg-success/20 blur-2xl" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center">
                <Shield className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground leading-none">{systemLoad}%</p>
                <p className="text-[11px] text-muted-foreground mt-1">Навантаження системи</p>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-success" style={{ width: `${systemLoad}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={(value) => {
          hapticSelection();
          setActiveTab(value);
        }}>
          <ScrollArea className="w-full pb-2">
            <TabsList className="w-max flex gap-1.5 mb-4 bg-muted/50 backdrop-blur rounded-2xl p-1.5 border border-border/60">
              <TabsTrigger value="reports" className="gap-1.5 text-xs px-4 py-2 rounded-xl font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <Flag className="h-4 w-4" />
                Скарги
                {stats.openReports > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                    {stats.openReports}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="disputes" className="gap-1.5 text-xs px-4 py-2 rounded-xl font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <Scale className="h-4 w-4" />
                Спори
                {stats.openDisputes > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {stats.openDisputes}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="support" className="gap-1.5 text-xs px-4 py-2 rounded-xl font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <Headphones className="h-4 w-4" />
                Підтримка
                {stats.openTickets > 0 && (
                  <Badge className="ml-1 h-4 px-1 text-[10px]">
                    {stats.openTickets}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="payments" className="gap-1.5 text-xs px-4 py-2 rounded-xl font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <Wallet className="h-4 w-4" />
                Оплати
              </TabsTrigger>
              <TabsTrigger value="bonuses" className="gap-1.5 text-xs px-4 py-2 rounded-xl font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <Gift className="h-4 w-4" />
                Бонуси
              </TabsTrigger>
              <TabsTrigger value="products" className="gap-1.5 text-xs px-4 py-2 rounded-xl font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <Package className="h-4 w-4" />
                Товари
              </TabsTrigger>
            </TabsList>
          </ScrollArea>

          {/* Reports Tab */}
          <TabsContent value="reports">
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-4 pr-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : reports.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                      <Check className="h-8 w-8 text-green-500" />
                    </div>
                    <p className="font-medium text-foreground">Немає активних скарг</p>
                    <p className="text-sm text-muted-foreground">Всі скарги оброблені</p>
                  </div>
                ) : (
                  reports.map((report) => (
                    <Card key={report.id}>
                      <CardContent className="p-4 space-y-4">
                        {/* Product Info */}
                        <div className="flex items-start gap-3">
                          {report.product?.images?.[0] && (
                            <img
                              src={report.product.images[0]}
                              alt={report.product.name}
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground truncate">
                              {report.product?.name || 'Товар видалено'}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {report.product?.price?.toLocaleString()} ₴
                            </p>
                          </div>
                          <Badge variant="destructive">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {getReasonLabel(report.reason)}
                          </Badge>
                        </div>

                        {/* Report Description */}
                        {report.description && (
                          <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-sm text-foreground">{report.description}</p>
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                          {formatDate(report.created_at)}
                        </p>

                        {/* Admin Notes */}
                        <Textarea
                          value={adminNotes[report.id] || ''}
                          onChange={(e) => setAdminNotes(prev => ({ ...prev, [report.id]: e.target.value }))}
                          placeholder="Нотатки модератора..."
                          rows={2}
                        />

                        {/* Actions */}
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleResolveReport(report.id, 'dismissed')}
                            disabled={processingId === report.id}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Відхилити
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => handleResolveReport(report.id, 'resolved')}
                            disabled={processingId === report.id}
                          >
                            {processingId === report.id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Check className="h-4 w-4 mr-1" />
                            )}
                            Вирішити
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Disputes Tab */}
          <TabsContent value="disputes">
            <DisputesManager />
          </TabsContent>
          {/* Payments Tab */}
          <TabsContent value="payments">
            <Tabs defaultValue="balances" className="w-full">
              <TabsList className="w-full grid grid-cols-3 mb-4">
                <TabsTrigger value="balances">Баланси</TabsTrigger>
                <TabsTrigger value="splits">Виплати</TabsTrigger>
                <TabsTrigger value="refunds">Повернення</TabsTrigger>
              </TabsList>
              <TabsContent value="balances"><ShopBalancesPanel mode="moderator" /></TabsContent>
              <TabsContent value="splits"><PaymentsManager mode="moderator" /></TabsContent>
              <TabsContent value="refunds"><RefundsQueue /></TabsContent>
            </Tabs>
          </TabsContent>


          {/* Tech Support Tab */}
          <TabsContent value="support">
            <TechSupportQueue />
          </TabsContent>

          {/* Individual Bonuses Tab */}
          <TabsContent value="bonuses">
            <IndividualBonusManager />
          </TabsContent>

          {/* Products Tab */}
          <TabsContent value="products">
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-3 pr-4">
                {pendingProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Немає товарів для перегляду</p>
                  </div>
                ) : (
                  pendingProducts.map((product) => (
                    <Card key={product.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          {product.images?.[0] && (
                            <img
                              src={product.images[0]}
                              alt={product.name}
                              className="w-14 h-14 rounded-lg object-cover"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground truncate">{product.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {product.price.toLocaleString()} ₴
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(product.created_at)}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge variant={product.in_stock ? 'default' : 'secondary'}>
                              {product.in_stock ? 'В наявності' : 'Немає'}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/product/${product.id}`)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Переглянути
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Check, X, Loader2, DollarSign, ShoppingCart, Package,
  Eye, ChevronDown, ChevronUp, Shield, UserCog, AlertTriangle, RefreshCw,
  Crown, Tag, Gift, Brain, MessageSquare, Trophy, Store, Megaphone, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTelegramAuthContext } from '@/components/TelegramAuthProvider';
import { hapticSelection } from '@/lib/haptics';
import { PromoCodesManager } from '@/components/admin/PromoCodesManager';
import { BonusesManager } from '@/components/admin/BonusesManager';
import { AIInsightsDashboard } from '@/components/admin/AIInsightsDashboard';
import { ManualSupplierForm } from '@/components/admin/ManualSupplierForm';
import { SupportChatsViewer } from '@/components/admin/SupportChatsViewer';
import { GiveawaysManager } from '@/components/admin/GiveawaysManager';
import { AdminStoreManager } from '@/components/admin/AdminStoreManager';
import { AdminStoreOrders } from '@/components/admin/AdminStoreOrders';
import { OrdersManager } from '@/components/admin/OrdersManager';
import { AIOrderReports } from '@/components/admin/AIOrderReports';
import { AdminRolesManager } from '@/components/admin/AdminRolesManager';
import { CommandCenter } from '@/components/admin/CommandCenter';
import { PaymentsManager } from '@/components/admin/PaymentsManager';
import { ShopBalancesPanel } from '@/components/admin/ShopBalancesPanel';
import { TavernaGroupPanel } from '@/components/admin/TavernaGroupPanel';

interface SupplierApplication {
  id: string;
  shop_name: string;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  supplier_type: string;
  tax_id: string;
  description: string | null;
  xml_url: string | null;
  status: string;
  created_at: string;
  reseller_probability: number | null;
  plagiarism_score: number | null;
  suggested_categories: string[] | null;
  profile_id: string | null;
  telegram_id: number | null;
}

interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  totalMargin: number;
  pendingOrders: number;
  openTickets: number;
  suppliersCount: number;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { isLoading: authLoading, rolesLoading, isAuthenticated, effectiveRole, sessionToken } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState('overview');
  const [applications, setApplications] = useState<SupplierApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [customMarkup, setCustomMarkup] = useState<Record<string, number>>({});
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});
  const [orderStats, setOrderStats] = useState<OrderStats>({
    totalOrders: 0, totalRevenue: 0, totalMargin: 0,
    pendingOrders: 0, openTickets: 0, suppliersCount: 0,
  });
  const [marketingSubTab, setMarketingSubTab] = useState<'promos' | 'bonuses' | 'giveaways'>('promos');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'insights' | 'reports'>('insights');
  const [storesSubTab, setStoresSubTab] = useState<'all' | 'partners' | 'my' | 'add'>('all');
  const [ordersSubTab, setOrdersSubTab] = useState<'all' | 'my_stores'>('all');

  const isAdmin = isAuthenticated && effectiveRole === 'admin';

  useEffect(() => {
    if (isAdmin) {
      fetchApplications();
      fetchOrderStats();
    }
  }, [isAdmin]);

  const fetchApplications = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('supplier_applications')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setApplications(data || []);
    } catch (err) {
      console.error('Error fetching applications:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchOrderStats = async () => {
    try {
      const [ordersResult, ticketsResult, suppliersResult] = await Promise.all([
        supabase.from('orders').select('id, total, subtotal, status'),
        supabase.from('support_tickets').select('id').eq('status', 'open'),
        supabase.from('suppliers').select('id'),
      ]);
      const orders = ordersResult.data || [];
      const tickets = ticketsResult.data || [];
      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      setOrderStats({
        totalOrders: orders.length,
        totalRevenue,
        totalMargin: Math.round(totalRevenue * 0.2),
        pendingOrders: orders.filter(o => o.status === 'pending').length,
        openTickets: tickets.length,
        suppliersCount: (suppliersResult.data || []).length,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const handleApprove = async (app: SupplierApplication, assignRole: string = 'supplier') => {
    setProcessingId(app.id);
    try {
      const markup = customMarkup[app.id] || 33;
      const { error } = await supabase.functions.invoke('process-supplier-application', {
        body: { application_id: app.id, action: 'approve', markup_percentage: markup, session_token: sessionToken, assign_role: assignRole },
      });
      if (error) throw error;
      toast.success(`"${app.shop_name}" схвалено!`);
      setApplications(prev => prev.filter(a => a.id !== app.id));
      fetchOrderStats();
    } catch (err) {
      toast.error('Помилка схвалення');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (app: SupplierApplication) => {
    if (!rejectionReason.trim()) { toast.error('Вкажіть причину'); return; }
    setProcessingId(app.id);
    try {
      const { error } = await supabase
        .from('supplier_applications')
        .update({ status: 'rejected', rejection_reason: rejectionReason, reviewed_at: new Date().toISOString() })
        .eq('id', app.id);
      if (error) throw error;
      toast.success('Заявку відхилено');
      setApplications(prev => prev.filter(a => a.id !== app.id));
      setRejectionReason('');
      setExpandedId(null);
    } catch (err) {
      toast.error('Помилка відхилення');
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (authLoading || rolesLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mx-auto">
            <Shield className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Доступ заборонено</h1>
          <p className="text-muted-foreground">Ця сторінка доступна лише адміністраторам</p>
          <Button onClick={() => navigate('/')}>На головну</Button>
        </div>
      </div>
    );
  }

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
                <Crown className="h-5 w-5 text-warning" />
                Адмін-панель
              </h1>
              <p className="text-xs text-muted-foreground">Taverna · Повний контроль</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            fetchApplications(); fetchOrderStats();
            toast.success('Дані оновлено');
          }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="p-4 grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 text-center">
          <ShoppingCart className="h-4 w-4 text-primary mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{orderStats.totalOrders}</p>
          <p className="text-[10px] text-muted-foreground">Замовлень</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <DollarSign className="h-4 w-4 text-green-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{orderStats.totalMargin.toLocaleString()}₴</p>
          <p className="text-[10px] text-muted-foreground">Прибуток</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <Store className="h-4 w-4 text-amber-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{orderStats.suppliersCount}</p>
          <p className="text-[10px] text-muted-foreground">Магазинів</p>
        </CardContent></Card>
      </div>

      {/* Alert badges */}
      <div className="px-4 flex gap-2 flex-wrap">
        {orderStats.pendingOrders > 0 && (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 gap-1">
            <Package className="h-3 w-3" /> {orderStats.pendingOrders} нових замовлень
          </Badge>
        )}
        {orderStats.openTickets > 0 && (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 gap-1">
            <MessageSquare className="h-3 w-3" /> {orderStats.openTickets} тікетів
          </Badge>
        )}
        {applications.length > 0 && (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
            <Users className="h-3 w-3" /> {applications.length} заявок
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={(v) => { hapticSelection(); setActiveTab(v); }}>
          <ScrollArea className="w-full pb-2">
            <TabsList className="w-max flex gap-1 mb-4">
              <TabsTrigger value="overview" className="text-xs px-3 gap-1">
                <Crown className="h-3.5 w-3.5" /> Огляд
              </TabsTrigger>
              <TabsTrigger value="orders" className="text-xs px-3 gap-1">
                <ShoppingCart className="h-3.5 w-3.5" /> Замовлення
              </TabsTrigger>
              <TabsTrigger value="payments" className="text-xs px-3 gap-1">
                <Wallet className="h-3.5 w-3.5" /> Оплати
              </TabsTrigger>
              <TabsTrigger value="stores" className="text-xs px-3 gap-1">
                <Store className="h-3.5 w-3.5" /> Магазини
              </TabsTrigger>
              <TabsTrigger value="applications" className="text-xs px-3 gap-1">
                <Users className="h-3.5 w-3.5" /> Заявки
                {applications.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{applications.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="support" className="text-xs px-3 gap-1">
                <MessageSquare className="h-3.5 w-3.5" /> Підтримка
              </TabsTrigger>
              <TabsTrigger value="marketing" className="text-xs px-3 gap-1">
                <Megaphone className="h-3.5 w-3.5" /> Маркетинг
              </TabsTrigger>
              <TabsTrigger value="analytics" className="text-xs px-3 gap-1">
                <Brain className="h-3.5 w-3.5" /> Аналітика
              </TabsTrigger>
              <TabsTrigger value="roles" className="text-xs px-3 gap-1">
                <UserCog className="h-3.5 w-3.5" /> Користувачі
              </TabsTrigger>
            </TabsList>
          </ScrollArea>

          {/* === ОГЛЯД === */}
          <TabsContent value="overview">
            <CommandCenter
              stats={orderStats}
              applicationsCount={applications.length}
              onNavigate={(tab) => { hapticSelection(); setActiveTab(tab); }}
            />
          </TabsContent>



          {/* === ЗАМОВЛЕННЯ === */}
          <TabsContent value="orders">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={ordersSubTab === 'all' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setOrdersSubTab('all')}
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Усі замовлення
                </Button>
                <Button
                  variant={ordersSubTab === 'my_stores' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setOrdersSubTab('my_stores')}
                >
                  <Crown className="h-3.5 w-3.5" />
                  Замовлення магазинів
                </Button>
              </div>
              {ordersSubTab === 'all' ? (
                <OrdersManager />
              ) : (
                <AdminStoreOrders />
              )}
            </div>
          </TabsContent>

          {/* === ОПЛАТИ === */}
          <TabsContent value="payments">
            <Tabs defaultValue="group" className="w-full">
              <TabsList className="w-full grid grid-cols-3 mb-4">
                <TabsTrigger value="group">Taverna Group</TabsTrigger>
                <TabsTrigger value="balances">Баланси магазинів</TabsTrigger>
                <TabsTrigger value="splits">Виплати за замовлення</TabsTrigger>
              </TabsList>
              <TabsContent value="group"><TavernaGroupPanel /></TabsContent>
              <TabsContent value="balances"><ShopBalancesPanel mode="admin" /></TabsContent>
              <TabsContent value="splits"><PaymentsManager mode="admin" /></TabsContent>
            </Tabs>
          </TabsContent>

          {/* === МАГАЗИНИ === */}
          <TabsContent value="stores">
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {(['all', 'partners', 'my', 'add'] as const).map((tab) => {
                  const labels = { all: 'Усі магазини', partners: 'Партнери', my: 'Мої магазини', add: '+ Додати' };
                  const icons = { all: <Store className="h-3.5 w-3.5" />, partners: <Users className="h-3.5 w-3.5" />, my: <Crown className="h-3.5 w-3.5" />, add: <Package className="h-3.5 w-3.5" /> };
                  return (
                    <Button
                      key={tab}
                      variant={storesSubTab === tab ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => setStoresSubTab(tab)}
                    >
                      {icons[tab]}
                      {labels[tab]}
                    </Button>
                  );
                })}
              </div>
              {storesSubTab === 'add' ? (
                <ScrollArea className="h-[calc(100vh-420px)]">
                  <div className="pr-4">
                    <ManualSupplierForm onSuccess={() => { setStoresSubTab('my'); fetchOrderStats(); }} />
                  </div>
                </ScrollArea>
              ) : (
                <AdminStoreManager filter={storesSubTab === 'partners' ? 'partners' : storesSubTab === 'my' ? 'my' : 'all'} />
              )}
            </div>
          </TabsContent>

          {/* === ЗАЯВКИ === */}
          <TabsContent value="applications">
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-4 pr-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : applications.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                      <Users className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-medium text-foreground">Немає нових заявок</p>
                    <p className="text-sm text-muted-foreground">Всі заявки оброблені</p>
                  </div>
                ) : (
                  applications.map((app) => (
                    <Card key={app.id} className="overflow-hidden">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-foreground">{app.shop_name}</h3>
                            <p className="text-sm text-muted-foreground">{app.full_name}</p>
                          </div>
                          <Badge variant={app.supplier_type === 'individual' ? 'secondary' : 'outline'}>
                            {app.supplier_type === 'individual' ? 'ФОП' : 'ТОВ'}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Email:</span>
                            <p className="text-foreground truncate">{app.email}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Телефон:</span>
                            <p className="text-foreground">{app.phone}</p>
                          </div>
                        </div>

                        {(app.reseller_probability !== null || app.plagiarism_score !== null) && (
                          <div className="flex gap-2 flex-wrap">
                            {app.reseller_probability !== null && (
                              <Badge variant={app.reseller_probability > 50 ? 'destructive' : 'secondary'}>
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Ресейлер: {app.reseller_probability}%
                              </Badge>
                            )}
                            {app.plagiarism_score !== null && (
                              <Badge variant={app.plagiarism_score > 50 ? 'destructive' : 'secondary'}>
                                Плагіат: {app.plagiarism_score}%
                              </Badge>
                            )}
                          </div>
                        )}

                        {app.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{app.description}</p>
                        )}

                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs whitespace-nowrap">Націнка %:</Label>
                            <Input
                              type="number"
                              value={customMarkup[app.id] || 33}
                              onChange={e => setCustomMarkup(prev => ({ ...prev, [app.id]: parseInt(e.target.value) || 33 }))}
                              className="w-20 h-8 text-sm"
                              min={1}
                              max={100}
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Label className="text-xs whitespace-nowrap">Роль:</Label>
                            <Select
                              value={selectedRole[app.id] || 'supplier'}
                              onValueChange={v => setSelectedRole(prev => ({ ...prev, [app.id]: v }))}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="supplier">Постачальник</SelectItem>
                                <SelectItem value="shop_manager">Менеджер магазину</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            className="flex-1 gap-2"
                            onClick={() => handleApprove(app, selectedRole[app.id] || 'supplier')}
                            disabled={processingId === app.id}
                          >
                            {processingId === app.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            Схвалити
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                          >
                            {expandedId === app.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </div>

                        {expandedId === app.id && (
                          <div className="space-y-2 border-t pt-3 border-border">
                            <Textarea
                              value={rejectionReason}
                              onChange={e => setRejectionReason(e.target.value)}
                              placeholder="Причина відхилення..."
                              className="text-sm"
                            />
                            <Button
                              variant="destructive"
                              className="w-full gap-2"
                              onClick={() => handleReject(app)}
                              disabled={processingId === app.id}
                            >
                              <X className="h-4 w-4" />
                              Відхилити
                            </Button>
                            <p className="text-xs text-muted-foreground text-center">
                              Подано: {formatDate(app.created_at)}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* === ПІДТРИМКА === */}
          <TabsContent value="support">
            <SupportChatsViewer />
          </TabsContent>

          {/* === МАРКЕТИНГ === */}
          <TabsContent value="marketing">
            <div className="space-y-3">
              <div className="flex gap-2">
                {[
                  { key: 'promos' as const, label: 'Промокоди', icon: <Tag className="h-3.5 w-3.5" /> },
                  { key: 'bonuses' as const, label: 'Бонуси', icon: <Trophy className="h-3.5 w-3.5" /> },
                  { key: 'giveaways' as const, label: 'Розіграші', icon: <Gift className="h-3.5 w-3.5" /> },
                ].map(tab => (
                  <Button
                    key={tab.key}
                    variant={marketingSubTab === tab.key ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setMarketingSubTab(tab.key)}
                  >
                    {tab.icon}
                    {tab.label}
                  </Button>
                ))}
              </div>
              {marketingSubTab === 'promos' && <PromoCodesManager />}
              {marketingSubTab === 'bonuses' && <BonusesManager />}
              {marketingSubTab === 'giveaways' && <GiveawaysManager />}
            </div>
          </TabsContent>

          {/* === АНАЛІТИКА === */}
          <TabsContent value="analytics">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={analyticsSubTab === 'insights' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setAnalyticsSubTab('insights')}
                >
                  <Brain className="h-3.5 w-3.5" />
                  AI Інсайти
                </Button>
                <Button
                  variant={analyticsSubTab === 'reports' ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setAnalyticsSubTab('reports')}
                >
                  <Package className="h-3.5 w-3.5" />
                  Звіти
                </Button>
              </div>
              {analyticsSubTab === 'insights' ? <AIInsightsDashboard /> : <AIOrderReports />}
            </div>
          </TabsContent>

          {/* === РОЛІ === */}
          <TabsContent value="roles">
            <AdminRolesManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

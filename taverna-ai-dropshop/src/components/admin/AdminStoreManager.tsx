import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Settings, Loader2, UserPlus, Send, Shield, Eye,
  Bot, Package, Crown, AlertTriangle, Users, Wallet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useToast } from "@/hooks/use-toast";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { BackendApiError, fetchAdminStores, transferSupplierOwnership } from "@/lib/backendApi";

interface AdminSupplier {
  id: string;
  shop_name: string;
  company_name: string;
  contact_name: string;
  is_active: boolean;
  markup_percentage: number | null;
  created_at: string;
  logo_url: string | null;
  cover_image_url: string | null;
  manager_telegram: string | null;
  allow_bot_chat: boolean | null;
  tax_code: string | null;
  xml_url: string | null;
  description: string | null;
  product_count?: number;
  user_id?: number | null;
  telegram_id?: number | null;
}

export function AdminStoreManager({ filter = 'all' }: { filter?: 'all' | 'partners' | 'my' }) {
  const navigate = useNavigate();
  const { toast: uiToast } = useToast();
  const { profile } = useTelegramAuthContext();
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([]);
  const [mySupplierIds, setMySupplierIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [transferDialog, setTransferDialog] = useState<{ supplier: AdminSupplier } | null>(null);
  const [transferUsername, setTransferUsername] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [editManagerDialog, setEditManagerDialog] = useState<{ supplier: AdminSupplier } | null>(null);
  const [managerTelegram, setManagerTelegram] = useState("");
  const [isSavingManager, setIsSavingManager] = useState(false);

  const adminTelegramId =
    profile?.telegram_id ||
    (typeof window !== "undefined"
      ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
      : null);

  useEffect(() => {
    fetchSuppliers();
  }, [filter, adminTelegramId]);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const rows = await fetchAdminStores(
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      const allSuppliers: AdminSupplier[] = rows.map((row) => ({
        id: String(row.id),
        shop_name: row.shop_name,
        company_name: row.company_name || "",
        contact_name: row.contact_name || "",
        is_active: row.is_active,
        markup_percentage: row.markup_percentage ?? null,
        created_at: row.created_at || "",
        logo_url: null,
        cover_image_url: null,
        manager_telegram: row.manager_telegram || null,
        allow_bot_chat: null,
        tax_code: null,
        xml_url: row.xml_url || null,
        description: row.description || null,
        product_count: row.product_count || 0,
        user_id: row.user_id ?? null,
        telegram_id: row.telegram_id ?? null,
      }));

      const myIdsSet = new Set<string>();
      const adminTg = adminTelegramId ? Number(adminTelegramId) : null;
      allSuppliers.forEach((supplier) => {
        const isAdminOwned =
          supplier.user_id == null ||
          (adminTg != null && Number(supplier.telegram_id) === adminTg);
        if (isAdminOwned) myIdsSet.add(supplier.id);
      });

      const myIds = Array.from(myIdsSet);
      setMySupplierIds(myIds);

      const filteredSuppliers = allSuppliers.filter((supplier) => {
        if (filter === "my") return myIdsSet.has(supplier.id);
        if (filter === "partners") return !myIdsSet.has(supplier.id);
        return true;
      });

      setSuppliers(filteredSuppliers);
    } catch (err) {
      console.error("Error fetching suppliers:", err);
      toast.error("Помилка завантаження магазинів");
      setSuppliers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferDialog || !transferUsername.trim()) {
      uiToast({
        variant: "destructive",
        title: "Вкажіть @username користувача Telegram",
      });
      return;
    }

    setIsTransferring(true);
    try {
      await transferSupplierOwnership(
        Number(transferDialog.supplier.id),
        transferUsername.trim(),
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      uiToast({
        title: "Права передано",
        className: "bg-green-600 text-white border-green-700",
      });
      setTransferDialog(null);
      setTransferUsername("");
      await fetchSuppliers();
    } catch (err: any) {
      console.error("Transfer error:", err);
      if (err instanceof BackendApiError && err.status === 404) {
        uiToast({
          variant: "destructive",
          title: "Користувача не знайдено",
        });
        return;
      }
      uiToast({
        variant: "destructive",
        title: err.message || "Помилка передачі магазину",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  const handleSaveManager = async () => {
    if (!editManagerDialog) return;
    setIsSavingManager(true);
    try {
      const { error } = await supabase
        .from("suppliers")
        .update({
          manager_telegram: managerTelegram.trim() || null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", editManagerDialog.supplier.id);
      if (error) throw error;
      toast.success("Менеджера оновлено");
      setEditManagerDialog(null);
      fetchSuppliers();
    } catch (err: any) {
      toast.error(err.message || "Помилка");
    } finally {
      setIsSavingManager(false);
    }
  };

  const handleToggleStatus = async (supplier: AdminSupplier) => {
    try {
      const { error } = await supabase
        .from("suppliers")
        .update({ is_active: !supplier.is_active } as any)
        .eq("id", supplier.id);
      if (error) throw error;
      toast.success(supplier.is_active ? "Магазин деактивовано" : "Магазин активовано");
      fetchSuppliers();
    } catch (err) {
      toast.error("Помилка зміни статусу");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isMyStores = filter === 'my';
  const isPartners = filter === 'partners';

  const infoText = isMyStores
    ? "Магазини, які ви додали через «+ Додати» або закріплені за вами. Ви маєте повний контроль: налаштування, товари, замовлення."
    : isPartners
    ? "Партнерські магазини (самореєстрація або передані права). Доступ лише для перегляду та активації/деактивації."
    : "Всі магазини платформи. Повне керування доступне лише для ваших магазинів.";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-300">{suppliers.length} магазинів</p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            {isMyStores ? <Crown className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" /> :
             isPartners ? <Users className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" /> :
             <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />}
            <p className="text-xs text-slate-600 dark:text-slate-300">{infoText}</p>
          </div>
        </CardContent>
      </Card>

      <ScrollArea className="h-[calc(100vh-480px)]">
        <div className="space-y-3 pr-4">
          {suppliers.length === 0 ? (
            <div className="text-center py-12">
              <Store className="h-12 w-12 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
              <p className="font-semibold text-slate-900 dark:text-white">
                {isMyStores ? "У вас немає власних магазинів" : isPartners ? "Немає партнерських магазинів" : "Магазинів ще немає"}
              </p>
              {isMyStores && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Створіть магазин через вкладку «+ Додати»
                </p>
              )}
              {isPartners && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Партнерські магазини з'являться тут після реєстрації або передачі прав
                </p>
              )}
              {!isMyStores && !isPartners && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Зареєструйте свій перший магазин
                </p>
              )}
            </div>
          ) : (
            suppliers.map((supplier) => (
              <Card key={supplier.id} className="overflow-hidden">
                {supplier.cover_image_url && (
                  <div className="h-16 w-full overflow-hidden">
                    <img src={supplier.cover_image_url} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12 border-2 border-background shadow">
                      <AvatarImage src={supplier.logo_url || ""} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {supplier.shop_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground truncate">{supplier.shop_name}</h3>
                        {isMyStores && <Crown className="h-3.5 w-3.5 text-warning flex-shrink-0" />}
                        <Badge variant={supplier.is_active ? "default" : "secondary"} className="text-xs flex-shrink-0">
                          {supplier.is_active ? "Активний" : "Неактивний"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{supplier.company_name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Націнка: {supplier.markup_percentage || 33}%</span>
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {supplier.product_count || 0} товарів
                        </span>
                        {supplier.manager_telegram && (
                          <span className="text-primary">
                            <Bot className="h-3 w-3 inline mr-0.5" />
                            {supplier.manager_telegram}
                          </span>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={supplier.is_active}
                      onCheckedChange={() => handleToggleStatus(supplier)}
                    />
                  </div>

                  {/* Actions differ by filter */}
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
                    {(() => {
                      const isMine = mySupplierIds.includes(supplier.id);

                      if (isMyStores || (filter === 'all' && isMine)) {
                        return (
                          <>
                            <Button variant="default" size="sm" className="flex-1 gap-1.5 text-xs"
                              onClick={() => navigate(`/store-management/${supplier.id}`)}>
                              <Settings className="h-3.5 w-3.5" /> Керувати
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                              onClick={() => { setEditManagerDialog({ supplier }); setManagerTelegram(supplier.manager_telegram || ""); }}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs border-indigo-300 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
                              onClick={() => { setTransferDialog({ supplier }); setTransferUsername(""); }}
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                              Передати права
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                              onClick={() => navigate(`/wallet/${supplier.id}`)}>
                              <Wallet className="h-3.5 w-3.5" /> Рахунок
                            </Button>
                            <Button variant="ghost" size="sm" className="gap-1.5 text-xs"
                              onClick={() => navigate(`/supplier/${supplier.id}`)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        );
                      }

                      return (
                        <>
                          <Button variant="ghost" size="sm" className="flex-1 gap-1.5 text-xs"
                            onClick={() => navigate(`/supplier/${supplier.id}`)}>
                            <Eye className="h-3.5 w-3.5" /> Переглянути
                          </Button>
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                            onClick={() => navigate(`/wallet/${supplier.id}`)}>
                            <Wallet className="h-3.5 w-3.5" /> Рахунок
                          </Button>
                        </>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Transfer Ownership Dialog */}
      <Dialog open={!!transferDialog} onOpenChange={() => { if (!isTransferring) setTransferDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-indigo-600" />
              Передача прав на магазин
            </DialogTitle>
            <DialogDescription>
              Введіть @username користувача Telegram, якому хочете передати цей магазин. Користувач повинен мати аккаунт у боті.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-destructive">Увага! Ця дія незворотна</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Після передачі ви втратите право керування цим магазином.
                    Новий власник отримає повний контроль.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Telegram username</Label>
              <Input
                value={transferUsername}
                onChange={e => setTransferUsername(e.target.value)}
                placeholder="@username"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(null)} disabled={isTransferring}>Скасувати</Button>
            <Button
              onClick={handleTransferOwnership}
              disabled={isTransferring || !transferUsername.trim()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isTransferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Передати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Manager Dialog */}
      <Dialog open={!!editManagerDialog} onOpenChange={() => setEditManagerDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Менеджер магазину
            </DialogTitle>
            <DialogDescription>
              Вкажіть Telegram нікнейм менеджера для «{editManagerDialog?.supplier.shop_name}». 
              Менеджер отримуватиме сповіщення про замовлення.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Telegram менеджера</Label>
              <Input
                value={managerTelegram}
                onChange={e => setManagerTelegram(e.target.value)}
                placeholder="@username"
              />
              <p className="text-xs text-muted-foreground">
                Залиште порожнім — замовлення будуть приходити вам в адмін-панель.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditManagerDialog(null)}>Скасувати</Button>
            <Button onClick={handleSaveManager} disabled={isSavingManager} className="gap-2">
              {isSavingManager ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Зберегти
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

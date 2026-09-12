import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Settings, Loader2, UserPlus, Send, Shield, Eye, ArrowRightLeft,
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
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

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
}

const isUuid = (value: string | null | undefined) =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function AdminStoreManager({ filter = 'all' }: { filter?: 'all' | 'partners' | 'my' }) {
  const navigate = useNavigate();
  const { realProfile, profile, effectiveRole } = useTelegramAuthContext();
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([]);
  const [mySupplierIds, setMySupplierIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [transferDialog, setTransferDialog] = useState<{ supplier: AdminSupplier } | null>(null);
  const [transferTelegramId, setTransferTelegramId] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [editManagerDialog, setEditManagerDialog] = useState<{ supplier: AdminSupplier } | null>(null);
  const [managerTelegram, setManagerTelegram] = useState("");
  const [isSavingManager, setIsSavingManager] = useState(false);

  const currentProfileId = realProfile?.id ?? (typeof profile?.id === 'string' ? profile.id : null);

  useEffect(() => {
    fetchSuppliers();
  }, [filter, currentProfileId, effectiveRole]);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const { data: allRows, error } = await supabase
        .from("suppliers")
        .select("id, shop_name, company_name, contact_name, is_active, markup_percentage, created_at, logo_url, cover_image_url, manager_telegram, allow_bot_chat, tax_code, xml_url, description")
        .order("created_at", { ascending: false });

      if (error) throw error;

      let allSuppliers: AdminSupplier[] = allRows || [];
      const myIdsSet = new Set<string>();

      if (isUuid(currentProfileId)) {
        const { data: links } = await supabase
          .from("shop_manager_links")
          .select("supplier_id")
          .eq("profile_id", currentProfileId);

        (links || []).forEach((link) => myIdsSet.add(link.supplier_id));
      }

      if (effectiveRole === 'admin') {
        allSuppliers
          .filter((supplier) => !supplier.manager_telegram)
          .forEach((supplier) => myIdsSet.add(supplier.id));
      }

      const myIds = Array.from(myIdsSet);
      setMySupplierIds(myIds);

      const filteredSuppliers = allSuppliers.filter((supplier) => {
        if (filter === 'my') return myIdsSet.has(supplier.id);
        if (filter === 'partners') return !myIdsSet.has(supplier.id);
        return true;
      });

      const supplierIds = filteredSuppliers.map((s) => s.id);
      if (supplierIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("supplier_id")
          .in("supplier_id", supplierIds);

        const countMap: Record<string, number> = {};
        (products || []).forEach((product) => {
          if (product.supplier_id) countMap[product.supplier_id] = (countMap[product.supplier_id] || 0) + 1;
        });

        setSuppliers(filteredSuppliers.map((supplier) => ({ ...supplier, product_count: countMap[supplier.id] || 0 })));
      } else {
        setSuppliers([]);
      }
    } catch (err) {
      console.error("Error fetching suppliers:", err);
      toast.error("Помилка завантаження магазинів");
      setSuppliers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferDialog || !transferTelegramId.trim()) {
      toast.error("Вкажіть Telegram ID нового власника");
      return;
    }

    setIsTransferring(true);
    try {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, telegram_id, first_name, last_name")
        .eq("telegram_id", parseInt(transferTelegramId))
        .limit(1);

      if (!profiles?.length) {
        toast.error("Користувача з таким Telegram ID не знайдено. Попросіть його спочатку відкрити додаток.");
        setIsTransferring(false);
        return;
      }

      const targetProfile = profiles[0];

      // Add supplier role to user
      await supabase
        .from("user_roles")
        .upsert(
          { user_id: targetProfile.id, role: "supplier" as any },
          { onConflict: "user_id,role" }
        );

      // Update supplier: set manager_telegram to mark as transferred
      await supabase
        .from("suppliers")
        .update({
          manager_telegram: `@tg_${transferTelegramId}`,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", transferDialog.supplier.id);

      // Remove admin's shop_manager_link for this store (admin loses management)
      if (realProfile?.id) {
        await supabase
          .from("shop_manager_links")
          .delete()
          .eq("supplier_id", transferDialog.supplier.id)
          .eq("profile_id", realProfile.id);
      }

      // Create shop_manager_link for new owner
      await supabase
        .from("shop_manager_links")
        .upsert(
          { supplier_id: transferDialog.supplier.id, profile_id: targetProfile.id, assigned_by: realProfile?.id || null },
          { onConflict: "supplier_id,profile_id" } as any
        );

      toast.success(
        `Магазин "${transferDialog.supplier.shop_name}" передано користувачу ${targetProfile.first_name || ""} ${targetProfile.last_name || ""}`
      );

      setTransferDialog(null);
      setTransferTelegramId("");
      fetchSuppliers();
    } catch (err: any) {
      console.error("Transfer error:", err);
      toast.error(err.message || "Помилка передачі магазину");
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
        <p className="text-sm text-muted-foreground">{suppliers.length} магазинів</p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            {isMyStores ? <Crown className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" /> :
             isPartners ? <Users className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" /> :
             <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />}
            <p className="text-xs text-muted-foreground">{infoText}</p>
          </div>
        </CardContent>
      </Card>

      <ScrollArea className="h-[calc(100vh-480px)]">
        <div className="space-y-3 pr-4">
          {suppliers.length === 0 ? (
            <div className="text-center py-12">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {isMyStores ? "У вас немає власних магазинів" : isPartners ? "Немає партнерських магазинів" : "Немає магазинів"}
              </p>
              {isMyStores && (
                <p className="text-xs text-muted-foreground mt-1">
                  Створіть магазин через вкладку «+ Додати»
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
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                              onClick={() => { setTransferDialog({ supplier }); setTransferTelegramId(""); }}>
                              <ArrowRightLeft className="h-3.5 w-3.5" />
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
      <Dialog open={!!transferDialog} onOpenChange={() => setTransferDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Передача магазину
            </DialogTitle>
            <DialogDescription>
              Передайте право власності магазину «{transferDialog?.supplier.shop_name}» іншому користувачу.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-destructive">Увага! Ця дія незворотна</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Після передачі ви втратите право керування цим магазином. 
                    Новий власник отримає повний контроль.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Як отримати Telegram ID:</strong><br />
                Попросіть нового власника відкрити бота @taverna_ukr_bot — він отримає свій ID.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Telegram ID нового власника</Label>
              <Input
                value={transferTelegramId}
                onChange={e => setTransferTelegramId(e.target.value.replace(/\D/g, ""))}
                placeholder="123456789"
                type="text"
                inputMode="numeric"
              />
            </div>

            <div className="p-3 bg-primary/5 rounded-lg">
              <p className="text-xs text-muted-foreground"><strong>Що відбудеться:</strong></p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5 list-disc pl-4">
                <li>Новому власнику надається роль «supplier»</li>
                <li>Магазин переходить до розділу «Партнери»</li>
                <li>Ви втрачаєте право керування цим магазином</li>
                <li>Новий власник зможе призначати свого менеджера</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(null)}>Скасувати</Button>
            <Button
              variant="destructive"
              onClick={handleTransferOwnership}
              disabled={isTransferring || !transferTelegramId.trim()}
              className="gap-2"
            >
              {isTransferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Передати назавжди
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

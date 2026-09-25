import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, UserCog, Settings2, Trash2, X,
  Link2, Share2, Copy, Shield, Wallet, MessageSquare,
  BookOpen, CheckCircle2, XCircle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { triggerHapticFeedback, hapticSelection } from "@/lib/haptics";
import {
  getSupplierById,
  getStoreManagers,
  generateInviteLink,
  removeManager,
  updateManagerContract,
  getMyManagerContract,
  type BackendSupplierManager,
  type BackendMyManagerContract,
  type ManagerPermissions,
  type ManagerContractRates,
  type ManagerCommSettings,
} from "@/lib/backendApi";

/**
 * Сторінка «Менеджери магазину» (мультитенантна, B2B).
 * supplierId береться з URL: /store-managers/:supplierId.
 *
 * РОЗДІЛЕННЯ UI ЗА РОЛЕЮ:
 * - Власник (owner): список менеджерів, інвайт-посилання,
 *   модалка контракту (права RBAC + тарифи + комунікація).
 * - Менеджер (manager): через getMyManagerContract(supplierId)
 *   бачить СВОЇ права (read-only), тариф і інструкцію роботи з тікетами.
 */
export default function StoreManagers() {
  const navigate = useNavigate();
  const { supplierId } = useParams<{ supplierId?: string }>();

  const [shopName, setShopName] = useState<string>("");
  const [myRole, setMyRole] = useState<"owner" | "manager">("owner");
  const [isLoading, setIsLoading] = useState(true);

  const [shopManagers, setShopManagers] = useState<BackendSupplierManager[]>([]);
  const [isManagersLoading, setIsManagersLoading] = useState(false);
  const [isRemovingManager, setIsRemovingManager] = useState<number | null>(null);
  // RBAC: власний контракт поточного менеджера (read-only для manager)
  const [myContract, setMyContract] = useState<BackendMyManagerContract | null>(null);
  const [isContractLoading, setIsContractLoading] = useState(false);
  // Модалка «Керування менеджером» (лише власник)
  const [permissionsDialogFor, setPermissionsDialogFor] = useState<BackendSupplierManager | null>(null);
  const [permissionsDraft, setPermissionsDraft] = useState<ManagerPermissions | null>(null);
  // B2B: тарифи (у гривнях для UI; копійки конвертуємо при load/save)
  const [ratesDraft, setRatesDraft] = useState<{ order: string; dispute: string }>({ order: "0", dispute: "0" });
  // Omnichannel: канал комунікації + сповіщення
  const [commDraft, setCommDraft] = useState<ManagerCommSettings>({ chat_channel: "webapp", receive_notifications: true });
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  /** Завантажує назву магазину + роль, потім дані за роллю. */
  const loadContext = async () => {
    if (!supplierId) {
      navigate("/my-shops", { replace: true });
      return;
    }
    setIsLoading(true);
    setMyContract(null);
    try {
      const s = await getSupplierById(supplierId);
      setShopName(s.store_name || "");
      setMyRole(s.role === "manager" ? "manager" : "owner");
      // Розділення UI: власнику — список менеджерів, менеджеру — свій контракт.
      if (s.role === "manager") {
        await loadMyContract();
      } else {
        await loadManagers();
      }
    } catch (err: any) {
      console.error("Error loading supplier:", err);
      if (err?.status === 403) {
        toast.error("Немає доступу до цього магазину");
        navigate("/my-shops", { replace: true });
        return;
      }
      toast.error(err?.message || "Помилка завантаження");
    } finally {
      setIsLoading(false);
    }
  };

  /** Контракт поточного менеджера: права (read-only) + тарифи + комунікація. */
  const loadMyContract = async () => {
    if (!supplierId) return;
    setIsContractLoading(true);
    try {
      const contract = await getMyManagerContract(Number(supplierId));
      setMyContract(contract);
    } catch (err: any) {
      console.error("Error loading my manager contract:", err);
      if (err?.status === 403) {
        toast.error("Ви не є менеджером цього магазину");
        navigate("/my-shops", { replace: true });
        return;
      }
      toast.error(err?.message || "Не вдалося завантажити ваш контракт");
    } finally {
      setIsContractLoading(false);
    }
  };

  const loadManagers = async () => {
    if (!supplierId) return;
    setIsManagersLoading(true);
    try {
      const managers = await getStoreManagers(Number(supplierId));
      setShopManagers(managers);
    } catch (err: any) {
      console.error("Error loading managers:", err);
      toast.error(err?.message || "Не вдалося завантажити менеджерів");
    } finally {
      setIsManagersLoading(false);
    }
  };

  /** Генерує НОВЕ унікальне посилання-запрошення (кожен виклик = новий токен). */
  const handleGenerateInvite = async () => {
    if (isGeneratingInvite || !supplierId) return;
    setIsGeneratingInvite(true);
    try {
      const response = await generateInviteLink(Number(supplierId));
      const url = response?.link || (response as any)?.invite_url;
      if (!url) {
        throw new Error("Бекенд не повернув посилання");
      }
      setInviteLink(url);
      triggerHapticFeedback("notification", "success");
      toast.success("Посилання-запрошення згенеровано!");
    } catch (err: any) {
      console.error("Error generating invite link:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося згенерувати посилання");
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  /** Відкриває модалку керування менеджером: права + тарифи + комунікація. */
  const openPermissionsDialog = (m: BackendSupplierManager) => {
    setPermissionsDialogFor(m);
    setPermissionsDraft({
      can_edit_info: m.permissions?.can_edit_info ?? false,
      can_manage_products: m.permissions?.can_manage_products ?? true,
      can_view_balance: m.permissions?.can_view_balance ?? false,
      can_resolve_disputes: m.permissions?.can_resolve_disputes ?? false,
    });
    // Бекенд віддає КОПІЙКИ — у стейті UI тримаємо гривні (÷100).
    setRatesDraft({
      order: String((m.rates?.rate_per_order ?? 0) / 100),
      dispute: String((m.rates?.rate_per_dispute ?? 0) / 100),
    });
    setCommDraft({
      chat_channel: m.comm_settings?.chat_channel === "telegram" ? "telegram" : "webapp",
      receive_notifications: m.comm_settings?.receive_notifications ?? true,
    });
  };

  /**
   * Зберігає весь «контракт» менеджера: права + тарифи + комунікація —
   * одним запитом PATCH /suppliers/{supplierId}/managers/{user_id}.
   * Гривні в UI → копійки для бекенду (Math.round(v * 100)).
   */
  const handleSavePermissions = async () => {
    if (!supplierId || !permissionsDialogFor || !permissionsDraft || isSavingPermissions) return;
    setIsSavingPermissions(true);
    try {
      const rates: ManagerContractRates = {
        rate_per_order: Math.max(0, Math.round((parseFloat(ratesDraft.order) || 0) * 100)),
        rate_per_dispute: Math.max(0, Math.round((parseFloat(ratesDraft.dispute) || 0) * 100)),
      };
      await updateManagerContract(Number(supplierId), permissionsDialogFor.user_id, {
        rates,
        permissions: permissionsDraft,
        comm_settings: commDraft,
      });
      triggerHapticFeedback("notification", "success");
      toast.success("Контракт менеджера оновлено");
      setPermissionsDialogFor(null);
      setPermissionsDraft(null);
      await loadManagers();
    } catch (err: any) {
      console.error("Error updating manager contract:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося оновити контракт менеджера");
    } finally {
      setIsSavingPermissions(false);
    }
  };

  /** Видаляє менеджера (з модалки або зі списку). */
  const handleRemoveManager = async (userId: number) => {
    if (!supplierId || isRemovingManager) return;
    setIsRemovingManager(userId);
    try {
      await removeManager(Number(supplierId), userId);
      triggerHapticFeedback("notification", "success");
      toast.success("Менеджера видалено");
      setPermissionsDialogFor(null);
      await loadManagers();
    } catch (err: any) {
      console.error("Error removing manager:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося видалити менеджера");
    } finally {
      setIsRemovingManager(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // === UI для МЕНЕДЖЕРА: власні права (read-only) + тариф + інструкція ===
  if (myRole === "manager") {
    return (
      <div className="min-h-screen bg-background pb-24">
        {/* Header */}
        <div className="sticky top-0 z-40 bg-card border-b border-border">
          <div className="flex items-center gap-3 p-4">
            <button
              onClick={() => navigate(-1)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-foreground">Для мене</h1>
              <p className="text-sm text-muted-foreground">{shopName || "Мій магазин"}</p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {isContractLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !myContract ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Shield className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Контракт не завантажено
              </p>
              <Button variant="outline" onClick={() => navigate("/my-shops")}>Назад</Button>
            </div>
          ) : (
            <>
              {/* === Мої права (read-only) === */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Мої права в магазині
                  </CardTitle>
                  <CardDescription>
                    Права призначає власник магазину. Щоб їх змінити — зверніться до нього.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {([
                    { key: "can_edit_info", label: "Редагування інфо магазину" },
                    { key: "can_manage_products", label: "Керування товарами" },
                    { key: "can_view_balance", label: "Перегляд балансу" },
                    { key: "can_resolve_disputes", label: "Вирішення спорів" },
                  ] as const).map((perm) => (
                    <div
                      key={perm.key}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30"
                    >
                      <p className="text-sm font-medium text-foreground">{perm.label}</p>
                      {myContract.permissions?.[perm.key] ? (
                        <Badge className="gap-1 text-[10px] shrink-0">
                          <CheckCircle2 className="h-3 w-3" />
                          Дозволено
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-[10px] shrink-0">
                          <XCircle className="h-3 w-3" />
                          Немає
                        </Badge>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* === Мій тариф (B2B) === */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    Мій тариф
                  </CardTitle>
                  <CardDescription>
                    Винагорода нараховується за фактом обробленої дії (суми в гривнях).
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl border border-border bg-muted/30">
                    <p className="text-xs text-muted-foreground">За обробку замовлення</p>
                    <p className="text-lg font-bold text-foreground">
                      {((myContract.rates?.rate_per_order ?? 0) / 100).toFixed(2)} ₴
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-border bg-muted/30">
                    <p className="text-xs text-muted-foreground">За вирішення спору</p>
                    <p className="text-lg font-bold text-foreground">
                      {((myContract.rates?.rate_per_dispute ?? 0) / 100).toFixed(2)} ₴
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* === Комунікація (read-only) === */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Комунікація
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30">
                    <p className="text-sm font-medium text-foreground">Канал для чату з клієнтами</p>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {myContract.comm_settings?.chat_channel === "telegram"
                        ? "Telegram Бот"
                        : "Mini App"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30">
                    <p className="text-sm font-medium text-foreground">Сповіщення про нові події</p>
                    <Badge variant="secondary" className="gap-1 text-[10px] shrink-0">
                      {myContract.comm_settings?.receive_notifications ? (
                        <>
                          <CheckCircle2 className="h-3 w-3" />
                          Увімкнено
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3" />
                          Вимкнено
                        </>
                      )}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* === Інструкція для менеджера === */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    Інструкція для менеджера
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                    <p className="text-foreground font-medium">Як працювати з тікетами:</p>
                    <p>
                      1. Увійдіть у розділ «Замовлення / Комунікація» — там усі звернення
                      клієнтів вашого магазину (тікети). Нові тікети позначені статусом
                      «Обробляється ШІ» — бот уже зібрав контекст замовлення.
                    </p>
                    <p>
                      2. Натисніть «Взяти тікет у роботу», щоб закріпити його за собою.
                      Після цього клієнт бачить, що звернення прийнято, а винагорода
                      за закриття нараховується саме вам.
                    </p>
                    <p>
                      3. Відповідайте клієнту в тому ж тікеті. Якщо канал комунікації —
                      Telegram, копія повідомлень приходить вам у бот.
                    </p>
                    <p>
                      4. Коли питання вирішено — закрийте тікет кнопкою «Закрити».
                      За кожне закрите звернення нараховується тариф, указаний у
                      розділі «Мій тариф».
                    </p>
                    <p className="text-foreground font-medium pt-2">Правила платформи:</p>
                    <p className="flex items-start gap-2">
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                      Не передавайте особисті дані клієнтів третім особам і не виводьте
                      комунікацію за межі платформи.
                    </p>
                    <p className="flex items-start gap-2">
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                      Спори щодо повернення коштів вирішуйте лише через тікети —
                      так фіксується історія рішень.
                    </p>
                    <p className="flex items-start gap-2">
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                      Винагорода виплачується на ваш внутрішній рахунок автоматично
                      після закриття тікета. Вивід коштів — зі сторінки «Гаманець».
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    );
  }

  // === UI для ВЛАСНИКА ===

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Менеджери магазину</h1>
            <p className="text-sm text-muted-foreground">{shopName || "Мій магазин"}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* === Список менеджерів === */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserCog className="h-4 w-4 text-primary" />
              Поточні менеджери
            </CardTitle>
            <CardDescription>
              Менеджери бачать замовлення магазину та відповідатимуть клієнтам у додатку
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isManagersLoading ? (
              <p className="text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Завантаження менеджерів…
              </p>
            ) : shopManagers.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg">
                Менеджерів ще немає. Надішліть запрошення нижче — після переходу за посиланням менеджер отримає доступ до магазину.
              </p>
            ) : (
              <div className="space-y-2">
                {shopManagers.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {(m.full_name || m.first_name || "М").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {m.full_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || "Менеджер"}
                      </p>
                      {m.telegram_id && (
                        <p className="text-xs text-muted-foreground">ID: {m.telegram_id}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">Менеджер</Badge>
                    {/* Клік по кнопці відкриває модалку прав */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
                      title="Налаштувати права"
                      onClick={() => openPermissionsDialog(m)}
                    >
                      <Settings2 className="h-4 w-4" />
                      <span className="sr-only">Налаштувати права менеджера</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 shrink-0"
                      title="Видалити менеджера"
                      disabled={isRemovingManager === m.user_id}
                      onClick={() => handleRemoveManager(m.user_id)}
                    >
                      {isRemovingManager === m.user_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span className="sr-only">Видалити менеджера</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === Посилання-запрошення (новий механізм замість @username) === */}
        <Card>
          <CardContent className="pt-6">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">Запросити менеджера</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Згенеруйте посилання і надішліть менеджеру — він отримає доступ до магазину після переходу.
              </p>
              {inviteLink ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input value={inviteLink} readOnly className="flex-1 h-9 text-xs font-mono" />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(inviteLink).then(() => toast.success("Скопійовано!"));
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 gap-2"
                      onClick={() => {
                        const tg = (window as any).Telegram?.WebApp;
                        const shareUrl =
                          `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}` +
                          `&text=${encodeURIComponent("Запрошення стати менеджером магазину")}`;
                        if (tg?.openTelegramLink) {
                          tg.openTelegramLink(shareUrl);
                        } else {
                          window.open(shareUrl, "_blank");
                        }
                      }}
                    >
                      <Share2 className="h-4 w-4" />
                      Поділитись
                    </Button>
                    {/* Кожен клік = НОВИЙ унікальний токен для наступного менеджера */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      disabled={isGeneratingInvite}
                      onClick={() => {
                        // Очищаємо старий лінк, щоб кнопка «Згенерувати»
                        // знову стала активною, і одразу генеруємо новий.
                        setInviteLink(null);
                        handleGenerateInvite();
                      }}
                    >
                      {isGeneratingInvite ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Link2 className="h-4 w-4" />
                      )}
                      Нове посилання
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setInviteLink(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Кожне посилання діє 24 години і працює один раз. Для запрошення другого менеджера натисніть «Нове посилання».
                  </p>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={isGeneratingInvite}
                  onClick={handleGenerateInvite}
                >
                  {isGeneratingInvite ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Генеруємо…
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4" />
                      Згенерувати посилання-запрошення
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* === Модалка «Керування менеджером» (RBAC + B2B-контракт) === */}
      <Dialog
        open={permissionsDialogFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPermissionsDialogFor(null);
            setPermissionsDraft(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-primary" />
              Керування менеджером
            </DialogTitle>
            <DialogDescription>
              {permissionsDialogFor?.full_name ||
                [permissionsDialogFor?.first_name, permissionsDialogFor?.last_name]
                  .filter(Boolean).join(" ") ||
                "Менеджер"}
              {permissionsDialogFor?.telegram_id ? ` • ID: ${permissionsDialogFor.telegram_id}` : ""}
            </DialogDescription>
          </DialogHeader>

          {permissionsDraft && (
            <Tabs defaultValue="permissions" className="w-full">
              <TabsList className="grid h-auto grid-cols-3 w-full">
                <TabsTrigger value="permissions" className="text-xs px-2 py-2">
                  <Shield className="h-3.5 w-3.5 mr-1" />
                  Дозволи
                </TabsTrigger>
                <TabsTrigger value="rates" className="text-xs px-2 py-2">
                  <Wallet className="h-3.5 w-3.5 mr-1" />
                  Оплата
                </TabsTrigger>
                <TabsTrigger value="communication" className="text-xs px-2 py-2">
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  Комунікація
                </TabsTrigger>
              </TabsList>

              {/* === Вкладка 1: Дозволи (RBAC) === */}
              <TabsContent value="permissions" className="mt-3">
                <div className="space-y-3">
                  {([
                    {
                      key: "can_edit_info",
                      label: "Редагування інфо",
                      hint: "Назва та опис магазину",
                    },
                    {
                      key: "can_manage_products",
                      label: "Керування товарами",
                      hint: "Додавати, редагувати та видаляти товари",
                    },
                    {
                      key: "can_view_balance",
                      label: "Перегляд балансу",
                      hint: "Бачити надходження та виплати магазину",
                    },
                    {
                      key: "can_resolve_disputes",
                      label: "Вирішення спорів",
                      hint: "Відповідати на скарги та запити клієнтів",
                    },
                  ] as const).map((perm) => (
                    <div
                      key={perm.key}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{perm.label}</p>
                        <p className="text-xs text-muted-foreground">{perm.hint}</p>
                      </div>
                      <Switch
                        checked={permissionsDraft[perm.key]}
                        onCheckedChange={(v) => {
                          hapticSelection();
                          setPermissionsDraft({ ...permissionsDraft, [perm.key]: v });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* === Вкладка 2: Оплата праці (B2B, гривні в UI / копійки в API) === */}
              <TabsContent value="rates" className="mt-3">
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
                    Тарифи, які сплачує постачальник за роботу менеджера. Вказуйте суму в гривнях —
                    списання відбудеться за фактом обробленої дії.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="rate_per_order">
                      За обробку замовлення (₴)
                    </Label>
                    <Input
                      id="rate_per_order"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={ratesDraft.order}
                      onChange={(e) => setRatesDraft({ ...ratesDraft, order: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rate_per_dispute">
                      За вирішення спору (₴)
                    </Label>
                    <Input
                      id="rate_per_dispute"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={ratesDraft.dispute}
                      onChange={(e) => setRatesDraft({ ...ratesDraft, dispute: e.target.value })}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* === Вкладка 3: Комунікація (Omnichannel) === */}
              <TabsContent value="communication" className="mt-3">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Канал для чату з клієнтами</Label>
                    <Select
                      value={commDraft.chat_channel}
                      onValueChange={(v) => {
                        hapticSelection();
                        setCommDraft({ ...commDraft, chat_channel: v as "webapp" | "telegram" });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Оберіть канал" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="webapp">Через Mini App</SelectItem>
                        <SelectItem value="telegram">Через Telegram Бот</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Де менеджер отримуватиме повідомлення від покупців магазину.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">Сповіщення про нові події</p>
                      <p className="text-xs text-muted-foreground">
                        Замовлення, спори, скарги — миттєво сповіщаємо менеджера
                      </p>
                    </div>
                    <Switch
                      checked={commDraft.receive_notifications}
                      onCheckedChange={(v) => {
                        hapticSelection();
                        setCommDraft({ ...commDraft, receive_notifications: v });
                      }}
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full gap-2"
              disabled={isSavingPermissions || !permissionsDraft}
              onClick={handleSavePermissions}
            >
              {isSavingPermissions ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Зберігаємо…
                </>
              ) : (
                <>
                  <Settings2 className="h-4 w-4" />
                  Зберегти контракт
                </>
              )}
            </Button>
            <Button
              variant="destructive"
              className="w-full gap-2"
              disabled={isRemovingManager !== null || permissionsDialogFor === null}
              onClick={() => {
                if (permissionsDialogFor) {
                  handleRemoveManager(permissionsDialogFor.user_id);
                }
              }}
            >
              {isRemovingManager === permissionsDialogFor?.user_id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Видалити менеджера
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

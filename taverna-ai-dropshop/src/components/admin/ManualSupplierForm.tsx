import { useState } from "react";
import { Store, Loader2, Package, Link2, Bot, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface ManualSupplierFormProps {
  onSuccess?: () => void;
}

export function ManualSupplierForm({ onSuccess }: ManualSupplierFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMyDrop, setIsMyDrop] = useState(false);
  const [formData, setFormData] = useState({
    shop_name: "",
    telegram_channel_url: "",
    manager_telegram: "",
    xml_url: "",
    payment_iban: "",
    payment_card_holder: "",
    payment_bank_name: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.shop_name) {
      toast.error("Вкажіть назву магазину");
      return;
    }

    if (!isMyDrop && !formData.xml_url) {
      toast.error("Для не-MyDrop магазину необхідно вказати XML-файл");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: supplier, error: supplierError } = await supabase
        .from("suppliers")
        .insert({
          shop_name: formData.shop_name,
          company_name: formData.shop_name,
          contact_name: "Адмін",
          contact_phone: "-",
          legal_type: "individual",
          xml_url: formData.xml_url || null,
          telegram_channel_url: formData.telegram_channel_url || null,
          manager_telegram: formData.manager_telegram || null,
          markup_percentage: 33,
          is_active: true,
          payment_iban: formData.payment_iban || null,
          payment_card_holder: formData.payment_card_holder || null,
          payment_bank_name: formData.payment_bank_name || null,
        } as any)
        .select()
        .single();

      if (supplierError) throw supplierError;

      // Auto-link manager
      if (formData.manager_telegram && supplier) {
        const cleanUsername = formData.manager_telegram.replace('@', '').trim();
        // Try to find existing profile by telegram_username
        const { data: managerProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('telegram_username', cleanUsername)
          .single();
        
        if (managerProfile) {
          // Assign shop_manager role and link
          await supabase.from('user_roles')
            .upsert({ user_id: managerProfile.id, role: 'shop_manager' as any }, { onConflict: 'user_id,role' });
          await supabase.from('shop_manager_links')
            .insert({ profile_id: managerProfile.id, supplier_id: supplier.id });
          toast.success(`Менеджера @${cleanUsername} призначено`);
        } else {
          toast.info(`Менеджер @${cleanUsername} буде автоматично підключений при першому вході в додаток`);
        }
      }

      // If no manager specified, auto-link admin as manager
      if (!formData.manager_telegram && supplier) {
        // Get current admin profile via session
        const { data: sessionData } = await supabase.functions.invoke('telegram-auth', {
          body: { action: 'validate', session_token: localStorage.getItem('session_token') },
        });
        if (sessionData?.profile?.id) {
          await supabase.from('shop_manager_links')
            .upsert({ 
              profile_id: sessionData.profile.id, 
              supplier_id: supplier.id 
            }, { onConflict: 'profile_id,supplier_id' } as any);
        }
      }

      // Trigger XML import if URL provided
      if (formData.xml_url && supplier) {
        await supabase.functions.invoke("parse-xml", {
          body: {
            xml_url: formData.xml_url,
            supplier_id: supplier.id,
          },
        });
        toast.success("Імпорт товарів запущено");
      }

      hapticNotification("success");
      toast.success(`Магазин "${formData.shop_name}" створено!${!formData.manager_telegram ? ' Ви автоматично призначені менеджером.' : ''}`);

      setFormData({ shop_name: "", telegram_channel_url: "", manager_telegram: "", xml_url: "", payment_iban: "", payment_card_holder: "", payment_bank_name: "" });
      onSuccess?.();
    } catch (err: any) {
      console.error("Error creating supplier:", err);
      toast.error(err.message || "Помилка створення магазину");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="h-5 w-5" />
          Додати магазин (дропшипінг)
        </CardTitle>
        <CardDescription>
          Спрощена реєстрація. Повні дані власник заповнює самостійно після передачі прав у вкладці «Магазини».
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* MyDrop Toggle */}
          <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <div>
                <span className="text-sm font-medium">Постачальник з MyDrop</span>
                <p className="text-xs text-muted-foreground">Підключення через API MyDrop</p>
              </div>
            </div>
            <Switch checked={isMyDrop} onCheckedChange={setIsMyDrop} />
          </div>

          {/* Shop Name */}
          <div className="space-y-2">
            <Label>Назва магазину *</Label>
            <Input
              value={formData.shop_name}
              onChange={(e) => setFormData(prev => ({ ...prev, shop_name: e.target.value }))}
              placeholder="Назва магазину з MyDrop або Prom"
            />
          </div>

          {/* XML URL */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              XML-файл товарів {!isMyDrop && <span className="text-destructive">*</span>}
            </Label>
            <Input
              value={formData.xml_url}
              onChange={(e) => setFormData(prev => ({ ...prev, xml_url: e.target.value }))}
              placeholder={isMyDrop
                ? "https://mydrop.com.ua/export/... (якщо API не знайшло магазин)"
                : "https://prom.ua/export/... (обов'язково для Prom)"
              }
            />
            {isMyDrop && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Залиште порожнім — магазин підключиться автоматично через API MyDrop
              </p>
            )}
          </div>

          {/* Telegram Channel */}
          <div className="space-y-2">
            <Label>Telegram-канал магазину</Label>
            <Input
              value={formData.telegram_channel_url}
              onChange={(e) => setFormData(prev => ({ ...prev, telegram_channel_url: e.target.value }))}
              placeholder="https://t.me/mychannel або @mychannel"
            />
          </div>

          {/* Manager Telegram */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Менеджер магазину (Telegram)
            </Label>
            <Input
              value={formData.manager_telegram}
              onChange={(e) => setFormData(prev => ({ ...prev, manager_telegram: e.target.value }))}
              placeholder="@manager_username"
            />
            <p className="text-xs text-muted-foreground">
              Отримуватиме сповіщення про замовлення та звернення клієнтів через бота
            </p>
          </div>

          {/* Payment IBAN */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              💳 IBAN рахунок для виплат
            </Label>
            <Input
              value={formData.payment_iban}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                setFormData(prev => ({ ...prev, payment_iban: val }));
              }}
              placeholder="UA123456789012345678901234567"
              maxLength={29}
            />
            <p className="text-xs text-muted-foreground">
              Для автоматичних виплат дроп-ціни постачальнику через Monobank API
            </p>
          </div>

          {/* Card Holder */}
          <div className="space-y-2">
            <Label>ПІБ власника рахунку</Label>
            <Input
              value={formData.payment_card_holder}
              onChange={(e) => setFormData(prev => ({ ...prev, payment_card_holder: e.target.value }))}
              placeholder="Іваненко Іван Іванович"
            />
          </div>

          {/* Bank Name */}
          <div className="space-y-2">
            <Label>Назва банку</Label>
            <Input
              value={formData.payment_bank_name}
              onChange={(e) => setFormData(prev => ({ ...prev, payment_bank_name: e.target.value }))}
              placeholder="Monobank / ПриватБанк / тощо"
            />
          </div>

          {/* Info box */}
          <div className="p-3 bg-muted/40 rounded-lg border text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">ℹ️ Після створення магазину:</p>
            <p>• Якщо менеджер <strong>вказаний</strong> — він автоматично підключиться при вході в додаток</p>
            <p>• Якщо менеджер <strong>НЕ вказаний</strong> — ви стаєте менеджером автоматично</p>
            <p>• Передача прав власнику — у вкладці <strong>«Магазини»</strong></p>
            <p>• Націнка однакова для всіх: <strong>33%</strong></p>
            <p>• При повній предоплаті дроп-ціна автоматично переказується постачальнику</p>
            <p>• При наложеному платежі — постачальник має перевести маржу за 14 днів</p>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Store className="h-4 w-4 mr-2" />
            )}
            Створити магазин
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}


import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Check, X, Loader2, Tag, Calendar, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface PromoCode {
  id: string;
  code: string;
  discount_percent: number | null;
  discount_amount: number | null;
  is_active: boolean;
  max_uses: number | null;
  current_uses: number | null;
  valid_from: string | null;
  valid_until: string | null;
  min_order_amount: number | null;
  created_at: string | null;
}

export function PromoCodesManager() {
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCode | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    discount_percent: "",
    discount_amount: "",
    max_uses: "",
    min_order_amount: "",
    valid_until: "",
  });

  useEffect(() => {
    fetchPromoCodes();
  }, []);

  const fetchPromoCodes = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPromoCodes(data || []);
    } catch (err) {
      console.error("Error fetching promo codes:", err);
      toast.error("Помилка завантаження промокодів");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDialog = (promo?: PromoCode) => {
    if (promo) {
      setEditingPromo(promo);
      setFormData({
        code: promo.code,
        discount_percent: promo.discount_percent?.toString() || "",
        discount_amount: promo.discount_amount?.toString() || "",
        max_uses: promo.max_uses?.toString() || "",
        min_order_amount: promo.min_order_amount?.toString() || "",
        valid_until: promo.valid_until?.split("T")[0] || "",
      });
    } else {
      setEditingPromo(null);
      setFormData({
        code: "",
        discount_percent: "",
        discount_amount: "",
        max_uses: "",
        min_order_amount: "",
        valid_until: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.code.trim()) {
      toast.error("Введіть код промокоду");
      return;
    }

    if (!formData.discount_percent && !formData.discount_amount) {
      toast.error("Вкажіть знижку (% або суму)");
      return;
    }

    setIsSaving(true);
    try {
      const promoData = {
        code: formData.code.toUpperCase().trim(),
        discount_percent: formData.discount_percent ? parseInt(formData.discount_percent) : null,
        discount_amount: formData.discount_amount ? parseFloat(formData.discount_amount) : null,
        max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
        min_order_amount: formData.min_order_amount ? parseFloat(formData.min_order_amount) : null,
        valid_until: formData.valid_until || null,
        is_active: true,
      };

      if (editingPromo) {
        const { error } = await supabase
          .from("promo_codes")
          .update(promoData)
          .eq("id", editingPromo.id);

        if (error) throw error;
        toast.success("Промокод оновлено");
      } else {
        const { error } = await supabase
          .from("promo_codes")
          .insert(promoData);

        if (error) throw error;
        hapticNotification("success");
        toast.success("Промокод створено");
      }

      setIsDialogOpen(false);
      fetchPromoCodes();
    } catch (err: any) {
      console.error("Error saving promo:", err);
      if (err.code === "23505") {
        toast.error("Промокод з таким кодом вже існує");
      } else {
        toast.error("Помилка збереження");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from("promo_codes")
        .update({ is_active: !isActive })
        .eq("id", id);

      if (error) throw error;
      
      setPromoCodes((prev) =>
        prev.map((p) => (p.id === id ? { ...p, is_active: !isActive } : p))
      );
      toast.success(isActive ? "Промокод деактивовано" : "Промокод активовано");
    } catch (err) {
      console.error("Error toggling promo:", err);
      toast.error("Помилка зміни статусу");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("promo_codes")
        .delete()
        .eq("id", id);

      if (error) throw error;
      
      setPromoCodes((prev) => prev.filter((p) => p.id !== id));
      toast.success("Промокод видалено");
    } catch (err) {
      console.error("Error deleting promo:", err);
      toast.error("Помилка видалення");
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("uk-UA");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Tag className="h-5 w-5" />
          Промокоди
        </h3>
        <Button size="sm" onClick={() => handleOpenDialog()}>
          <Plus className="h-4 w-4 mr-1" />
          Створити
        </Button>
      </div>

      <ScrollArea className="h-[400px]">
        <div className="space-y-3 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : promoCodes.length === 0 ? (
            <div className="text-center py-12">
              <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Немає промокодів</p>
            </div>
          ) : (
            promoCodes.map((promo) => (
              <Card key={promo.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                          {promo.code}
                        </code>
                        <Badge variant={promo.is_active ? "default" : "secondary"}>
                          {promo.is_active ? "Активний" : "Неактивний"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-sm text-muted-foreground">
                        {promo.discount_percent && (
                          <span className="flex items-center gap-1">
                            <Percent className="h-3 w-3" />
                            {promo.discount_percent}%
                          </span>
                        )}
                        {promo.discount_amount && (
                          <span>-{promo.discount_amount} ₴</span>
                        )}
                        {promo.max_uses && (
                          <span>
                            Використано: {promo.current_uses || 0}/{promo.max_uses}
                          </span>
                        )}
                        {promo.valid_until && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            до {formatDate(promo.valid_until)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={promo.is_active}
                        onCheckedChange={() => handleToggleActive(promo.id, promo.is_active)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDialog(promo)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(promo.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPromo ? "Редагувати промокод" : "Новий промокод"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Код *</Label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="SALE2024"
                className="font-mono uppercase"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Знижка (%)</Label>
                <Input
                  type="number"
                  value={formData.discount_percent}
                  onChange={(e) => setFormData((prev) => ({ ...prev, discount_percent: e.target.value }))}
                  placeholder="15"
                  min={1}
                  max={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Знижка (₴)</Label>
                <Input
                  type="number"
                  value={formData.discount_amount}
                  onChange={(e) => setFormData((prev) => ({ ...prev, discount_amount: e.target.value }))}
                  placeholder="100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ліміт використань</Label>
                <Input
                  type="number"
                  value={formData.max_uses}
                  onChange={(e) => setFormData((prev) => ({ ...prev, max_uses: e.target.value }))}
                  placeholder="100"
                />
              </div>
              <div className="space-y-2">
                <Label>Мін. сума замовлення</Label>
                <Input
                  type="number"
                  value={formData.min_order_amount}
                  onChange={(e) => setFormData((prev) => ({ ...prev, min_order_amount: e.target.value }))}
                  placeholder="500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Дійсний до</Label>
              <Input
                type="date"
                value={formData.valid_until}
                onChange={(e) => setFormData((prev) => ({ ...prev, valid_until: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Скасувати
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editingPromo ? "Зберегти" : "Створити"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Gift, Plus, Loader2, Calendar, Users, Trophy, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface Giveaway {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  prize_description: string | null;
  participants_count: number;
  is_active: boolean;
  created_at: string;
}

export function GiveawaysManager() {
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGiveaway, setEditingGiveaway] = useState<Giveaway | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    start_date: "",
    end_date: "",
    prize_description: "",
    is_active: true,
  });

  useEffect(() => {
    fetchGiveaways();
  }, []);

  const fetchGiveaways = async () => {
    setIsLoading(true);
    try {
      // Since we don't have a giveaways table yet, we'll mock the data
      // In production, this would fetch from the database
      setGiveaways([
        {
          id: "1",
          title: "Чорна п'ятниця 2026",
          description: "Великий розіграш до Чорної п'ятниці",
          start_date: "2026-11-20",
          end_date: "2026-11-29",
          prize_description: "iPhone 16 Pro + сертифікат на 10 000₴",
          participants_count: 1250,
          is_active: false,
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          title: "Новорічний розіграш",
          description: "Подарунки до Нового року",
          start_date: "2026-12-15",
          end_date: "2026-12-31",
          prize_description: "Подарункові сертифікати на 50 000₴",
          participants_count: 0,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.error("Error fetching giveaways:", err);
      toast.error("Помилка завантаження розіграшів");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDialog = (giveaway?: Giveaway) => {
    if (giveaway) {
      setEditingGiveaway(giveaway);
      setFormData({
        title: giveaway.title,
        description: giveaway.description || "",
        start_date: giveaway.start_date,
        end_date: giveaway.end_date,
        prize_description: giveaway.prize_description || "",
        is_active: giveaway.is_active,
      });
    } else {
      setEditingGiveaway(null);
      setFormData({
        title: "",
        description: "",
        start_date: "",
        end_date: "",
        prize_description: "",
        is_active: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.title || !formData.start_date || !formData.end_date) {
      toast.error("Заповніть обов'язкові поля");
      return;
    }

    setIsSaving(true);
    try {
      // In production, this would save to the database
      hapticNotification("success");
      toast.success(editingGiveaway ? "Розіграш оновлено" : "Розіграш створено");
      setIsDialogOpen(false);
      fetchGiveaways();
    } catch (err) {
      console.error("Error saving giveaway:", err);
      toast.error("Помилка збереження");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      // In production, this would delete from the database
      hapticNotification("success");
      toast.success("Розіграш видалено");
      setDeleteId(null);
      fetchGiveaways();
    } catch (err) {
      console.error("Error deleting giveaway:", err);
      toast.error("Помилка видалення");
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const isUpcoming = (startDate: string) => new Date(startDate) > new Date();
  const isOngoing = (startDate: string, endDate: string) => {
    const now = new Date();
    return new Date(startDate) <= now && now <= new Date(endDate);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Trophy className="h-5 w-5 text-warning" />
          Розіграші та акції
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
          ) : giveaways.length === 0 ? (
            <div className="text-center py-12">
              <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Немає активних розіграшів</p>
              <Button className="mt-4" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-1" />
                Створити перший розіграш
              </Button>
            </div>
          ) : (
            giveaways.map((giveaway) => {
              const upcoming = isUpcoming(giveaway.start_date);
              const ongoing = isOngoing(giveaway.start_date, giveaway.end_date);

              return (
                <Card key={giveaway.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-foreground">{giveaway.title}</h4>
                          {ongoing && <Badge className="bg-green-500">Триває</Badge>}
                          {upcoming && <Badge variant="secondary">Заплановано</Badge>}
                          {!ongoing && !upcoming && <Badge variant="outline">Завершено</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{giveaway.description}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(giveaway)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(giveaway.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>{formatDate(giveaway.start_date)} - {formatDate(giveaway.end_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>{giveaway.participants_count} учасників</span>
                      </div>
                    </div>

                    {giveaway.prize_description && (
                      <div className="mt-3 p-2 bg-warning/10 rounded-lg">
                        <div className="flex items-center gap-2 text-warning">
                          <Gift className="h-4 w-4" />
                          <span className="text-sm font-medium">{giveaway.prize_description}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingGiveaway ? "Редагувати розіграш" : "Новий розіграш"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Назва *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Чорна п'ятниця 2026"
              />
            </div>

            <div className="space-y-2">
              <Label>Опис</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Опис розіграшу..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Початок *</Label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Закінчення *</Label>
                <Input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Призи</Label>
              <Textarea
                value={formData.prize_description}
                onChange={(e) => setFormData(prev => ({ ...prev, prize_description: e.target.value }))}
                placeholder="iPhone 16 Pro + сертифікат на 10 000₴"
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Активний</Label>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Скасувати
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingGiveaway ? "Зберегти" : "Створити"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити розіграш?</AlertDialogTitle>
            <AlertDialogDescription>
              Цю дію неможливо скасувати. Всі дані про учасників будуть втрачені.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Видалити
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

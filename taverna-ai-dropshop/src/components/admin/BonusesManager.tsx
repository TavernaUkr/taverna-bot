import { useState, useEffect } from "react";
import { Gift, Plus, Loader2, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface UserBonus {
  id: string;
  profile_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  profile?: {
    first_name: string | null;
    last_name: string | null;
  } | null;
}

export function BonusesManager() {
  const [bonuses, setBonuses] = useState<UserBonus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserBonus | null>(null);
  const [bonusAmount, setBonusAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchBonuses();
  }, []);

  const fetchBonuses = async () => {
    setIsLoading(true);
    try {
      // Fetch bonuses
      const { data: bonusesData, error: bonusesError } = await supabase
        .from("user_bonuses")
        .select("*")
        .order("balance", { ascending: false });

      if (bonusesError) throw bonusesError;

      // Fetch profiles separately
      const profileIds = (bonusesData || []).map(b => b.profile_id);
      const { data: profilesData } = await supabase
        .from("profiles_safe" as any)
        .select("id, first_name, last_name")
        .in("id", profileIds);

      // Merge data
      const bonusesWithProfiles = (bonusesData || []).map(bonus => ({
        ...bonus,
        profile: ((profilesData || []) as any[]).find((p: any) => p.id === bonus.profile_id) || null,
      }));
      setBonuses(bonusesWithProfiles as unknown as UserBonus[]);
    } catch (err) {
      console.error("Error fetching bonuses:", err);
      toast.error("Помилка завантаження бонусів");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBonus = async () => {
    if (!selectedUser || !bonusAmount) {
      toast.error("Вкажіть суму бонусів");
      return;
    }

    const amount = parseInt(bonusAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error("Введіть коректну суму");
      return;
    }

    setIsSaving(true);
    try {
      const newBalance = (selectedUser.balance || 0) + amount;
      const newTotalEarned = amount > 0 
        ? (selectedUser.total_earned || 0) + amount 
        : selectedUser.total_earned;

      const { error } = await supabase
        .from("user_bonuses")
        .update({
          balance: newBalance,
          total_earned: newTotalEarned,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedUser.id);

      if (error) throw error;

      hapticNotification("success");
      toast.success(
        amount > 0 
          ? `Додано ${amount} бонусів` 
          : `Списано ${Math.abs(amount)} бонусів`
      );
      setIsDialogOpen(false);
      setBonusAmount("");
      fetchBonuses();
    } catch (err) {
      console.error("Error adding bonus:", err);
      toast.error("Помилка зміни бонусів");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredBonuses = bonuses.filter((b) => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      b.profile?.first_name?.toLowerCase().includes(search) ||
      b.profile?.last_name?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Gift className="h-5 w-5" />
          Бонуси користувачів
        </h3>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Пошук користувача..."
          className="pl-10"
        />
      </div>

      <ScrollArea className="h-[400px]">
        <div className="space-y-3 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredBonuses.length === 0 ? (
            <div className="text-center py-12">
              <Gift className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchQuery ? "Користувачів не знайдено" : "Немає бонусних рахунків"}
              </p>
            </div>
          ) : (
            filteredBonuses.map((bonus) => (
              <Card key={bonus.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {bonus.profile?.first_name || ""} {bonus.profile?.last_name || ""}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          ID: {bonus.profile_id.slice(0, 8)}…
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <Badge variant="default" className="text-lg px-3">
                          {bonus.balance || 0} ₴
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          Всього: {bonus.total_earned || 0} ₴
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedUser(bonus);
                          setIsDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add Bonus Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Змінити бонуси</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {selectedUser && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium">
                  {selectedUser.profile?.first_name} {selectedUser.profile?.last_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Поточний баланс: <strong>{selectedUser.balance || 0} ₴</strong>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Сума бонусів</Label>
              <Input
                type="number"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                placeholder="100 (додати) або -50 (списати)"
              />
              <p className="text-xs text-muted-foreground">
                Використовуйте від'ємне число для списання бонусів
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Скасувати
            </Button>
            <Button onClick={handleAddBonus} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Застосувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Gift, Search, Plus, Loader2, User, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface UserProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bonus_balance?: number;
}

interface BonusAction {
  id: string;
  user_name: string;
  amount: number;
  reason: string;
  type: "add" | "subtract";
  created_at: string;
}

export function IndividualBonusManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusReason, setBonusReason] = useState("");
  const [bonusType, setBonusType] = useState<"add" | "subtract">("add");
  const [isSaving, setIsSaving] = useState(false);
  const [recentActions, setRecentActions] = useState<BonusAction[]>([]);

  useEffect(() => {
    // Mock recent actions
    setRecentActions([
      {
        id: "1",
        user_name: "Іван Петренко",
        amount: 100,
        reason: "Компенсація за затримку",
        type: "add",
        created_at: new Date().toISOString(),
      },
      {
        id: "2",
        user_name: "Марія Коваленко",
        amount: 50,
        reason: "Реферальний бонус",
        type: "add",
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
    ]);
  }, []);

  const searchUsers = useCallback(async () => {
    if (!searchQuery.trim()) {
      setUsers([]);
      return;
    }

    setIsSearching(true);
    try {
      const { data: profiles, error } = await supabase
        .from("profiles_safe" as any)
        .select("id, first_name, last_name")
        .or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`)
        .limit(10);

      if (error) throw error;

      // Fetch bonuses for found users
      const userIds = ((profiles || []) as any[]).map((p: any) => p.id);
      const { data: bonuses } = await supabase
        .from("user_bonuses")
        .select("profile_id, balance")
        .in("profile_id", userIds);

      const usersWithBonuses: UserProfile[] = ((profiles || []) as any[]).map((p: any) => ({
        ...p,
        bonus_balance: bonuses?.find(b => b.profile_id === p.id)?.balance || 0,
      }));

      setUsers(usersWithBonuses);
    } catch (err) {
      console.error("Error searching users:", err);
      toast.error("Помилка пошуку");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(searchUsers, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchUsers]);

  const handleOpenBonusDialog = (user: UserProfile) => {
    setSelectedUser(user);
    setBonusAmount("");
    setBonusReason("");
    setBonusType("add");
    setIsDialogOpen(true);
  };

  const handleApplyBonus = async () => {
    if (!selectedUser || !bonusAmount) {
      toast.error("Вкажіть суму");
      return;
    }

    const amount = parseInt(bonusAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Введіть коректну суму");
      return;
    }

    setIsSaving(true);
    try {
      // Get or create user bonus record
      const { data: existingBonus } = await supabase
        .from("user_bonuses")
        .select("*")
        .eq("profile_id", selectedUser.id)
        .single();

      const currentBalance = existingBonus?.balance || 0;
      const currentEarned = existingBonus?.total_earned || 0;
      const currentSpent = existingBonus?.total_spent || 0;

      const newBalance = bonusType === "add" 
        ? currentBalance + amount 
        : Math.max(0, currentBalance - amount);

      if (existingBonus) {
        await supabase
          .from("user_bonuses")
          .update({
            balance: newBalance,
            total_earned: bonusType === "add" ? currentEarned + amount : currentEarned,
            total_spent: bonusType === "subtract" ? currentSpent + amount : currentSpent,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingBonus.id);
      } else {
        await supabase
          .from("user_bonuses")
          .insert({
            profile_id: selectedUser.id,
            balance: bonusType === "add" ? amount : 0,
            total_earned: bonusType === "add" ? amount : 0,
            total_spent: 0,
          });
      }

      // Add to recent actions
      setRecentActions(prev => [{
        id: Date.now().toString(),
        user_name: `${selectedUser.first_name || ""} ${selectedUser.last_name || ""}`.trim() || "Користувач",
        amount,
        reason: bonusReason || (bonusType === "add" ? "Нарахування" : "Списання"),
        type: bonusType,
        created_at: new Date().toISOString(),
      }, ...prev.slice(0, 9)]);

      hapticNotification("success");
      toast.success(
        bonusType === "add" 
          ? `Нараховано ${amount} бонусів` 
          : `Списано ${amount} бонусів`
      );
      setIsDialogOpen(false);
      searchUsers(); // Refresh user list
    } catch (err) {
      console.error("Error applying bonus:", err);
      toast.error("Помилка застосування бонусів");
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          Індивідуальні бонуси
        </h3>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Пошук користувача (ім'я, телеграм, телефон)..."
          className="pl-10"
        />
      </div>

      {/* Search Results */}
      {users.length > 0 && (
        <Card>
          <CardContent className="p-2">
            <div className="space-y-1">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer"
                  onClick={() => handleOpenBonusDialog(user)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {user.first_name || ""} {user.last_name || ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ID: {user.id.slice(0, 8)}…
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{user.bonus_balance || 0} ₴</Badge>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isSearching && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Recent Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Останні дії
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {recentActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{action.user_name}</p>
                    <p className="text-xs text-muted-foreground">{action.reason}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={action.type === "add" ? "default" : "destructive"}>
                      {action.type === "add" ? "+" : "-"}{action.amount} ₴
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(action.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Bonus Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Змінити бонуси</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {selectedUser && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium">
                  {selectedUser.first_name || ""} {selectedUser.last_name || ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  Поточний баланс: <strong>{selectedUser.bonus_balance || 0} ₴</strong>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Тип операції</Label>
              <Select value={bonusType} onValueChange={(v: "add" | "subtract") => setBonusType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Нарахувати бонуси</SelectItem>
                  <SelectItem value="subtract">Списати бонуси</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Сума</Label>
              <Input
                type="number"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                placeholder="100"
              />
            </div>

            <div className="space-y-2">
              <Label>Причина</Label>
              <Textarea
                value={bonusReason}
                onChange={(e) => setBonusReason(e.target.value)}
                placeholder="Компенсація за затримку доставки..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Скасувати
            </Button>
            <Button onClick={handleApplyBonus} disabled={isSaving}>
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

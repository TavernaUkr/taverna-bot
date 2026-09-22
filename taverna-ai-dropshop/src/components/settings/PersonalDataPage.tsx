import { useState, useEffect } from "react";
import { ArrowLeft, User, Phone, Mail, Edit2, Save, X, Loader2, AtSign } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  UA_PHONE_PREFIX,
  applyUaPhoneMask,
  blocksPrefixDeletion,
  insertUaPrefixOnFocus,
  isValidUaPhone,
  normalizeUaPhone,
  UA_PHONE_ERROR,
} from "@/lib/uaValidation";

interface Profile {
  id: string;
  telegram_id?: number;
  telegram_username?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  avatar_url?: string;
}

interface PersonalDataPageProps {
  profile: Profile | null;
  onBack: () => void;
  onUpdateProfile: (updates: Partial<Profile>) => Promise<any>;
}

export function PersonalDataPage({ profile, onBack, onUpdateProfile }: PersonalDataPageProps) {
  const telegramUser = (() => {
    try {
      return (window as any).Telegram?.WebApp?.initDataUnsafe?.user || null;
    } catch {
      return null;
    }
  })();

  const defaultsFromTelegram = {
    first_name: profile?.first_name || telegramUser?.first_name || "",
    last_name: profile?.last_name || telegramUser?.last_name || "",
    telegram_username: profile?.telegram_username || telegramUser?.username || "",
    phone: normalizeUaPhone(profile?.phone || ""),
    email: profile?.email || "",
  };

  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editData, setEditData] = useState(defaultsFromTelegram);

  useEffect(() => {
    setEditData({
      first_name: profile?.first_name || telegramUser?.first_name || "",
      last_name: profile?.last_name || telegramUser?.last_name || "",
      telegram_username: profile?.telegram_username || telegramUser?.username || "",
      phone: normalizeUaPhone(profile?.phone || ""),
      email: profile?.email || "",
    });
  }, [
    profile?.first_name,
    profile?.last_name,
    profile?.telegram_username,
    profile?.phone,
    profile?.email,
    telegramUser?.first_name,
    telegramUser?.last_name,
    telegramUser?.username,
  ]);

  const [phoneError, setPhoneError] = useState("");

  const handleSave = async () => {
    if (editData.phone && !isValidUaPhone(editData.phone)) {
      setPhoneError(UA_PHONE_ERROR);
      toast.error(UA_PHONE_ERROR);
      return;
    }
    setPhoneError("");
    setIsLoading(true);
    try {
      const result = await onUpdateProfile(editData);
      if (result) {
        toast.success('Дані успішно збережено');
        setIsEditing(false);
      } else {
        toast.error('Помилка збереження');
      }
    } catch (error) {
      toast.error('Помилка збереження');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setEditData({
      first_name: profile?.first_name || telegramUser?.first_name || "",
      last_name: profile?.last_name || telegramUser?.last_name || "",
      telegram_username: profile?.telegram_username || telegramUser?.username || "",
      phone: normalizeUaPhone(profile?.phone || ""),
      email: profile?.email || "",
    });
    setPhoneError("");
    setIsEditing(false);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="font-bold text-lg text-foreground">Мої дані</h2>
            <p className="text-xs text-muted-foreground">Особиста інформація</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Profile Card */}
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              {profile?.avatar_url ? (
                <img 
                  src={profile.avatar_url} 
                  className="w-16 h-16 rounded-full object-cover" 
                  alt="Avatar"
                />
              ) : (
                <User className="h-8 w-8 text-primary" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">
                {editData.first_name} {editData.last_name}
              </h3>
              {editData.telegram_username && (
                <p className="text-sm text-muted-foreground">
                  @{editData.telegram_username}
                </p>
              )}
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Ім'я
                </Label>
                <Input
                  id="first_name"
                  value={editData.first_name}
                  onChange={(e) => setEditData(prev => ({ ...prev, first_name: e.target.value }))}
                  disabled={!isEditing}
                  placeholder="Введіть ім'я"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="last_name">Прізвище</Label>
                <Input
                  id="last_name"
                  value={editData.last_name}
                  onChange={(e) => setEditData(prev => ({ ...prev, last_name: e.target.value }))}
                  disabled={!isEditing}
                  placeholder="Введіть прізвище"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram_username" className="flex items-center gap-2">
                <AtSign className="h-4 w-4 text-muted-foreground" />
                Username
              </Label>
              <Input
                id="telegram_username"
                value={editData.telegram_username ? `@${editData.telegram_username.replace(/^@/, '')}` : ""}
                disabled
                placeholder="@username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                Телефон
              </Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                maxLength={13}
                value={editData.phone}
                onFocus={(e) => {
                  if (isEditing) {
                    insertUaPrefixOnFocus(e, (value) => setEditData(prev => ({ ...prev, phone: value })), UA_PHONE_PREFIX);
                  }
                }}
                onKeyDown={(e) => {
                  if (blocksPrefixDeletion(e, UA_PHONE_PREFIX)) e.preventDefault();
                }}
                onChange={(e) => {
                  if (!isEditing) return;
                  const masked = applyUaPhoneMask(e.target.value);
                  e.target.value = masked;
                  setEditData(prev => ({ ...prev, phone: masked }));
                  setPhoneError(masked && !isValidUaPhone(masked) && masked.length >= UA_PHONE_PREFIX.length ? UA_PHONE_ERROR : "");
                }}
                disabled={!isEditing}
                placeholder="+380671234567"
                className={phoneError ? "border-destructive" : ""}
              />
              {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={editData.email}
                onChange={(e) => setEditData(prev => ({ ...prev, email: e.target.value }))}
                disabled={!isEditing}
                placeholder="email@example.com"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {isEditing ? (
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Скасувати
            </Button>
            <Button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Зберегти
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => setIsEditing(true)}
            className="w-full"
          >
            <Edit2 className="h-4 w-4 mr-2" />
            Редагувати дані
          </Button>
        )}

        {/* Info Note */}
        <div className="p-4 bg-muted/50 rounded-xl border border-border">
          <p className="text-sm text-muted-foreground">
            💡 Ваші дані використовуються для швидкого оформлення замовлень та зв'язку з підтримкою.
            Telegram ім'я синхронізується автоматично.
          </p>
        </div>
      </div>
    </div>
  );
}

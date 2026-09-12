import { ArrowLeft, User, MapPin, ChevronRight, Map, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";

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

interface SettingsMainPageProps {
  profile: Profile | null;
  addressCount: number;
  onBack: () => void;
  onNavigate: (view: 'personal' | 'addresses' | 'refund') => void;
}

export function SettingsMainPage({ 
  profile, 
  addressCount, 
  onBack, 
  onNavigate 
}: SettingsMainPageProps) {
  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-3 z-10">
        <button
          onClick={onBack}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold text-lg text-foreground">Налаштування</h2>
      </div>
      
      <div className="p-4 space-y-3">
        {/* User Card */}
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              {profile?.avatar_url ? (
                <img 
                  src={profile.avatar_url} 
                  className="w-14 h-14 rounded-full object-cover" 
                  alt="Avatar"
                />
              ) : (
                <span className="text-xl font-bold text-primary">
                  {profile?.first_name?.charAt(0) || 'Г'}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                {profile?.first_name} {profile?.last_name}
              </h3>
              <p className="text-sm text-muted-foreground">
                @{profile?.telegram_username || 'telegram'}
              </p>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {/* Personal Data */}
          <button
            onClick={() => {
              hapticSelection();
              onNavigate('personal');
            }}
            className="w-full flex items-center gap-3 px-4 py-4 hover:bg-muted transition-colors border-b border-border active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left">
              <span className="font-medium text-foreground">Мої дані</span>
              <p className="text-xs text-muted-foreground">Ім'я, телефон, email</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>

          {/* Delivery Addresses */}
          <button
            onClick={() => {
              hapticSelection();
              onNavigate('addresses');
            }}
            className="w-full flex items-center gap-3 px-4 py-4 hover:bg-muted transition-colors border-b border-border active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <MapPin className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1 text-left">
              <span className="font-medium text-foreground">Адреси доставки</span>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Map className="h-3 w-3" />
                Мапа відділень/поштоматів України
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                addressCount > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {addressCount}
              </span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </button>

          {/* Refund method */}
          <button
            onClick={() => {
              hapticSelection();
              onNavigate('refund');
            }}
            className="w-full flex items-center gap-3 px-4 py-4 hover:bg-muted transition-colors active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-success" />
            </div>
            <div className="flex-1 text-left">
              <span className="font-medium text-foreground">Картка для повернень</span>
              <p className="text-xs text-muted-foreground">Куди повертати кошти за замовлення</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Info Block */}
        <div className="p-4 bg-muted/50 rounded-xl border border-border mt-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">
                Автозаповнення адреси
              </p>
              <p className="text-xs text-muted-foreground">
                Збережіть адресу доставки, і вона автоматично заповнюватиметься при кожному замовленні.
                Додайте до 3 адрес для різних локацій.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

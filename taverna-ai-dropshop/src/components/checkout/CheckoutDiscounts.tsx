import { useState } from "react";
import { Gift, Tag, Sparkles, Wallet, Info, ChevronDown, ChevronUp, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";
import { RatingBonusBanner } from "@/components/RatingBonusBanner";

interface PersonalBonus {
  id: string;
  title: string;
  description: string;
  value: string;
  discountPercent?: number;
  discountAmount?: number;
  icon: string;
}

interface CheckoutDiscountsProps {
  subtotal: number;
  // Bonus balance
  bonusBalance: number;
  bonusesToUse: number;
  onBonusesChange: (amount: number) => void;
  // Promo code
  promoCode: string;
  promoDiscount: number;
  promoApplied: boolean;
  onPromoCodeChange: (code: string) => void;
  onApplyPromo: () => void;
  onRemovePromo: () => void;
  // Personal bonus
  personalBonuses: PersonalBonus[];
  selectedPersonalBonus: PersonalBonus | null;
  onSelectPersonalBonus: (bonus: PersonalBonus | null) => void;
  // Auth
  isAuthenticated: boolean;
  // Order count for progressive bonus cap
  orderCount?: number;
}

export function CheckoutDiscounts({
  subtotal,
  bonusBalance,
  bonusesToUse,
  onBonusesChange,
  promoCode,
  promoDiscount,
  promoApplied,
  onPromoCodeChange,
  onApplyPromo,
  onRemovePromo,
  personalBonuses,
  selectedPersonalBonus,
  onSelectPersonalBonus,
  isAuthenticated,
  orderCount = 0,
}: CheckoutDiscountsProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Progressive bonus cap based on order count
  // Balanced bonus cap: max 7% to protect platform margins
  const bonusCapPercent = orderCount >= 50 ? 7 : orderCount >= 25 ? 6 : orderCount >= 10 ? 5 : 4;
  const maxBonuses = Math.floor(subtotal * bonusCapPercent / 100);
  const effectiveMaxBonuses = Math.min(bonusBalance, maxBonuses);

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <div className="space-y-3">
      {/* Rating Bonus Banner */}
      {isAuthenticated && (
        <RatingBonusBanner variant="checkout" />
      )}

      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Gift className="h-4 w-4 text-primary" />
        Знижки та бонуси
      </div>

      {/* 1. Bonus Balance (available for all authenticated) */}
      {isAuthenticated && bonusBalance > 0 && (
        <div className="border border-primary/20 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection("bonus")}
            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Бонусний рахунок</span>
              <span className="text-xs text-muted-foreground">({bonusBalance}₴)</span>
            </div>
            <div className="flex items-center gap-2">
              {bonusesToUse > 0 && (
                <span className="text-xs font-medium text-primary">-{bonusesToUse}₴</span>
              )}
              {expandedSection === "bonus" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
          {expandedSection === "bonus" && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={effectiveMaxBonuses}
                  value={bonusesToUse || ""}
                  onChange={(e) => {
                    const val = Math.min(Number(e.target.value) || 0, effectiveMaxBonuses);
                    onBonusesChange(val);
                  }}
                  placeholder="0"
                  className="flex-1 h-9"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onBonusesChange(effectiveMaxBonuses);
                    hapticNotification("success");
                  }}
                >
                  Макс
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3 shrink-0" />
                Максимум {bonusCapPercent}% від суми замовлення ({maxBonuses}₴)
              </p>
            </div>
          )}
        </div>
      )}

      {/* 2. Promo Code */}
      <div className="border border-purple-500/20 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection("promo")}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium">Промокод</span>
          </div>
          <div className="flex items-center gap-2">
            {promoApplied && (
              <span className="text-xs font-medium text-emerald-500">-{promoDiscount}₴</span>
            )}
            {expandedSection === "promo" ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        {expandedSection === "promo" && (
          <div className="px-3 pb-3 space-y-2">
            {promoApplied ? (
              <div className="flex items-center justify-between bg-emerald-500/10 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium text-emerald-500">{promoCode}</span>
                  <span className="text-xs text-emerald-500">(-{promoDiscount}₴)</span>
                </div>
                <button onClick={onRemovePromo} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={promoCode}
                  onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
                  placeholder="Введіть промокод"
                  className="flex-1 h-9 font-mono"
                />
                <Button
                  size="sm"
                  onClick={onApplyPromo}
                  disabled={!promoCode.trim()}
                >
                  ОК
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3 shrink-0" />
              Один промокод на замовлення
            </p>
          </div>
        )}
      </div>

      {/* 3. Personal Bonuses (1 per order, monthly refresh) */}
      {isAuthenticated && personalBonuses.length > 0 && (
        <div className="border border-amber-500/20 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection("personal")}
            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">Персональний бонус</span>
              <span className="text-xs text-muted-foreground">({personalBonuses.length})</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedPersonalBonus && (
                <span className="text-xs font-medium text-amber-500">{selectedPersonalBonus.value}</span>
              )}
              {expandedSection === "personal" ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
          {expandedSection === "personal" && (
            <div className="px-3 pb-3 space-y-2">
              {personalBonuses.map((bonus) => (
                <button
                  key={bonus.id}
                  onClick={() => {
                    if (selectedPersonalBonus?.id === bonus.id) {
                      onSelectPersonalBonus(null);
                    } else {
                      onSelectPersonalBonus(bonus);
                      hapticNotification("success");
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left",
                    selectedPersonalBonus?.id === bonus.id
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-border hover:border-amber-500/40"
                  )}
                >
                  <span className="text-lg">{bonus.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{bonus.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{bonus.description}</p>
                  </div>
                  <span className="text-xs font-bold text-amber-500 shrink-0">{bonus.value}</span>
                  {selectedPersonalBonus?.id === bonus.id && (
                    <Check className="h-4 w-4 text-amber-500 shrink-0" />
                  )}
                </button>
              ))}
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3 shrink-0" />
                1 персональний бонус на замовлення. Оновлення щомісяця
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { ShoppingCart, Search, Heart, Gift, Info, Trophy, Wallet, Globe, Flag, LogIn, Plus, ArrowUpRight, ShoppingBag, Eye, Users, Megaphone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import tavernaLogo from "@/assets/taverna-logo.png";
import { AppInfoModal } from "./AppInfoModal";
import { LanguageSelectorModal } from "./LanguageSelectorModal";
import { RegionSelectorModal } from "./RegionSelectorModal";
import { WalletBadgeCloud, type WalletCloudAction, type WalletCloudVariant } from "./wallet/WalletBadgeCloud";
import { CartBadgeCloud } from "./cart/CartBadgeCloud";
import { ReferralSheet } from "./referrals/ReferralSheet";

import { useWallet } from "@/hooks/useWallet";
import { useTelegramAuthContext } from "./TelegramAuthProvider";


interface HeaderProps {
  cartCount?: number;
  favoritesCount?: number;
  onCartClick?: () => void;
  onSearchClick?: () => void;
  onNotificationsClick?: () => void;
  onFavoritesClick?: () => void;
  onPromoClick?: () => void;
  onRatingsClick?: () => void;
}

export const Header = ({
  cartCount = 0,
  favoritesCount = 0,
  onCartClick,
  onSearchClick,
  onNotificationsClick,
  onFavoritesClick,
  onPromoClick,
  onRatingsClick
}: HeaderProps) => {
  const navigate = useNavigate();
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isRegionOpen, setIsRegionOpen] = useState(false);
  const [isReferralsOpen, setIsReferralsOpen] = useState(false);
  const { effectiveRole } = useTelegramAuthContext() as any;
  const { wallet } = useWallet();

  const isGuest = !effectiveRole || effectiveRole === "guest";
  const isManager = effectiveRole === "shop_manager";
  const isPartner = ["supplier", "admin", "moderator"].includes(effectiveRole);

  const walletVariant: WalletCloudVariant = isGuest
    ? "guest"
    : isPartner
      ? "cash"
      : isManager
        ? "readonly"
        : "bonus";

  const openCart = () => onCartClick?.();

  const walletActions: WalletCloudAction[] = isGuest
    ? [{ id: "login", label: "Увійти", icon: LogIn, tone: "primary", onClick: () => navigate("/login") }]
    : isPartner
      ? [
          { id: "topup", label: "Поповнити", icon: Plus, tone: "primary", onClick: () => navigate("/wallet?action=topup") },
          { id: "payout", label: "Вивести", icon: ArrowUpRight, tone: "success", onClick: () => navigate("/wallet?action=payout") },
          { id: "pay", label: "Оплатити", icon: ShoppingBag, tone: "outline", onClick: openCart },
        ]
      : isManager
        ? [
            { id: "account", label: "Рахунок", icon: Eye, tone: "outline", onClick: () => navigate("/wallet?tab=shops") },
            { id: "pay", label: "Оплатити", icon: ShoppingBag, tone: "outline", onClick: openCart },
          ]
        : [
            { id: "bonus", label: "Бонуси", icon: Gift, tone: "primary", onClick: () => navigate("/wallet?action=bonus") },
            { id: "pay", label: "Оплатити", icon: ShoppingBag, tone: "outline", onClick: openCart },
          ];


  return (
    <>
      <header className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="relative flex items-center justify-between h-14 px-3">
          {/* Logo - Left */}
          <div className="flex items-center gap-1.5 z-10">
            <button onClick={() => setIsInfoOpen(true)} className="relative active:scale-95 transition-transform">
              <img
                src={tavernaLogo}
                alt="Taverna Group"
                className="w-9 h-9 rounded-xl object-cover" />
              
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
                <Info className="h-2 w-2 text-primary-foreground" />
              </div>
            </button>
            <div className="flex flex-col leading-none">
              <span className="font-brand italic text-[16px] text-brand-royal">Taverna</span>
              <span className="font-brand text-[8.5px] uppercase tracking-[0.24em] text-brand-royal" style={{ fontStyle: 'normal' }}>Group</span>
            </div>
            <button
              onClick={() => setIsLangOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-500 hover:bg-blue-500/10 active:scale-95 transition-all"
              aria-label="Мова">
              
              <Globe className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsRegionOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-rose-500 hover:bg-rose-500/10 active:scale-95 transition-all"
              aria-label="Регіон">
              
              <Flag className="h-4 w-4" />
            </button>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 z-10">
            <div className="relative">
              <button
                onClick={() => navigate("/wallet")}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-primary hover:bg-primary/10 active:scale-95 transition-all"
                aria-label="Мій рахунок">

                <Wallet className="h-4 w-4" />
              </button>
              <WalletBadgeCloud
                variant={walletVariant}
                bonusValue={wallet?.bonus_balance ?? 0}
                cashValue={wallet?.balance ?? 0}
                onClick={() => navigate(isGuest ? "/login" : "/wallet")}
                actions={walletActions}
              />

            </div>

            <button
              onClick={onRatingsClick}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-rating hover:bg-rating/10 active:scale-95 transition-all"
              aria-label="Рейтинги">
              
              <Trophy className="h-4 w-4" />
            </button>
            <button
              onClick={onPromoClick}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-header-promo hover:bg-header-promo/10 active:scale-95 transition-all"
              aria-label="Акції">
              
              <Gift className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsReferralsOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-header-referral hover:bg-header-referral/10 active:scale-95 transition-all"
              aria-label="Реферальна програма">

              <Users className="h-4 w-4" />
            </button>
            <button
              onClick={() => navigate("/manager")}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-header-promotion hover:bg-header-promotion/10 active:scale-95 transition-all"
              aria-label="Просування">

              <Megaphone className="h-4 w-4" />
            </button>
            <button
              onClick={onSearchClick}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground active:scale-95 transition-all">
              
              <Search className="h-4.5 w-4.5" />
            </button>
            <button
              onClick={onFavoritesClick}
              className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground active:scale-95 transition-all">
              
              <Heart className="h-4.5 w-4.5" />
              {favoritesCount > 0 &&
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-live text-live-foreground text-[9px] font-bold rounded-full">
                  {favoritesCount > 99 ? "99+" : favoritesCount}
                </span>
              }
            </button>
            <div className="relative">
              <button
                onClick={() => onCartClick?.()}
                className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                aria-label="Кошик">

                <ShoppingCart className="h-4.5 w-4.5" />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-live text-live-foreground text-[9px] font-bold rounded-full">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </button>
              <CartBadgeCloud
                cartCount={cartCount}
                onAdd={() => navigate("/")}
                onCheckout={() => onCartClick?.()}
              />
            </div>
          </div>
        </div>
      </header>

      <AppInfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
      <LanguageSelectorModal isOpen={isLangOpen} onClose={() => setIsLangOpen(false)} />
      <RegionSelectorModal isOpen={isRegionOpen} onClose={() => setIsRegionOpen(false)} />
      <ReferralSheet open={isReferralsOpen} onOpenChange={setIsReferralsOpen} />
    </>);

};
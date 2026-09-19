import { useState } from "react";
import { ShoppingCart, Search, Heart, Gift, Info, Trophy, Wallet, Globe, Flag, ArrowUpRight, Eye, Users, Megaphone, MoreHorizontal, ShieldAlert, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import tavernaLogo from "@/assets/taverna-logo.png";
import { AppInfoModal } from "./AppInfoModal";
import { LanguageSelectorModal } from "./LanguageSelectorModal";
import { RegionSelectorModal } from "./RegionSelectorModal";
import { WalletBadgeCloud, WalletCloudActions, type WalletCloudAction, type WalletCloudVariant } from "./wallet/WalletBadgeCloud";
import { ReferralSheet } from "./referrals/ReferralSheet";
import { RotatingHintCloud, type RotatingHintItem } from "./header/HintChip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const iconBtn =
  "w-[34px] h-[34px] shrink-0 rounded-lg flex items-center justify-center active:scale-95 transition-all";
const iconMain = `${iconBtn} text-muted-foreground hover:text-foreground`;
const iconWallet = `${iconBtn} text-primary hover:bg-primary/10`;

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
  const isSupplier = effectiveRole === "supplier";
  const isModerator = effectiveRole === "moderator";
  const isAdmin = effectiveRole === "admin";
  const isCashRole = isSupplier || isAdmin || isModerator;

  const goSignup = (next = "/") =>
    navigate(`/login?mode=signup&next=${encodeURIComponent(next)}`);

  const requireAuth = (action: () => void, next = "/") => {
    if (isGuest) {
      goSignup(next);
      return;
    }
    action();
  };

  const walletVariant: WalletCloudVariant = isGuest
    ? "guest"
    : isCashRole
      ? "cash"
      : isManager
        ? "readonly"
        : "bonus";

  const [heartPulse, setHeartPulse] = useState(false);

  const killSwitchActions: WalletCloudAction[] = isAdmin
    ? [{
        id: "danger",
        label: "Технічні роботи",
        icon: ShieldAlert,
        tone: "danger",
        onClick: () => navigate("/admin-dashboard?zone=danger"),
      }]
    : [];

  const underWalletActions: WalletCloudAction[] = isSupplier
    ? [{ id: "payout", label: "Вивести", icon: ArrowUpRight, tone: "success", onClick: () => navigate("/wallet?action=payout") }]
    : isManager
      ? [{ id: "account", label: "Рахунок", icon: Eye, tone: "outline", onClick: () => navigate("/wallet?tab=shops") }]
      : [];

  const topupActions: WalletCloudAction[] = isSupplier
    ? [{ id: "topup", label: "Поповнити", icon: DollarSign, tone: "lime", onClick: () => navigate("/wallet?action=topup") }]
    : [];

  const moreHints: RotatingHintItem[] = [
    { id: "search", icon: Search, label: "Пошук", tone: "primary", onClick: () => requireAuth(() => onSearchClick?.(), "/catalog") },
    { id: "ratings", icon: Trophy, label: "Рейтинги", tone: "rating", onClick: () => requireAuth(() => (onRatingsClick ? onRatingsClick() : navigate("/ratings")), "/ratings") },
    { id: "promo", icon: Gift, label: "Акції", tone: "promo", onClick: () => requireAuth(() => (onPromoClick ? onPromoClick() : navigate("/promos")), "/promos") },
    { id: "referrals", icon: Users, label: "Реферали", tone: "referral", onClick: () => requireAuth(() => setIsReferralsOpen(true), "/") },
    { id: "ads", icon: Megaphone, label: "Просування", tone: "ads", onClick: () => requireAuth(() => navigate("/manager"), "/manager") },
    { id: "lang", icon: Globe, label: "Мова", tone: "lang", onClick: () => requireAuth(() => setIsLangOpen(true), "/") },
    { id: "region", icon: Flag, label: "Регіон", tone: "region", onClick: () => requireAuth(() => setIsRegionOpen(true), "/") },
  ];


  return (
    <>
      <header className="sticky top-0 z-50 bg-card border-b border-border w-full max-w-[100vw] relative overflow-visible">
        <div className="flex items-center gap-2 px-2 py-1.5 w-full max-w-md mx-auto min-w-0">
          <button onClick={() => setIsInfoOpen(true)} className="relative active:scale-95 transition-transform shrink-0">
            <img
              src={tavernaLogo}
              alt="Taverna Group"
              className="w-14 h-14 rounded-2xl object-cover ring-1 ring-primary/20" />
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
              <Info className="h-2.5 w-2.5 text-primary-foreground" />
            </div>
          </button>
          <div className="flex flex-col justify-center leading-none min-w-0 shrink">
            <span className="font-brand italic text-[20px] text-brand-royal tracking-[-0.02em] whitespace-nowrap">
              Taverna
            </span>
            <span className="font-brand not-italic text-[10px] uppercase tracking-[0.18em] text-brand-royal/85 pl-[1px]">
              Group
            </span>
          </div>

          <div className="ml-auto grid grid-cols-[repeat(5,34px)] gap-x-1 gap-y-1.5 items-start shrink-0">
            <div className="col-start-1 row-start-1">
              <WalletCloudActions actions={killSwitchActions} />
            </div>
            <button
              onClick={() => navigate(isGuest ? "/login" : "/wallet")}
              className={`${iconWallet} col-start-2 row-start-1`}
              aria-label="Мій рахунок">
              <Wallet className="h-4 w-4" />
            </button>
            <button
              onClick={() => requireAuth(() => {
                setHeartPulse(true);
                window.setTimeout(() => setHeartPulse(false), 1600);
                onFavoritesClick?.();
              }, "/")}
              className={`relative ${iconMain} col-start-3 row-start-1 ${heartPulse ? "animate-heartbeat text-live" : ""}`}
              aria-label="Уподобайки">
              <Heart className={`h-4 w-4 ${heartPulse ? "fill-live text-live" : ""}`} />
              {favoritesCount > 0 &&
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-live text-live-foreground text-[9px] font-bold rounded-full">
                  {favoritesCount > 99 ? "99+" : favoritesCount}
                </span>
              }
            </button>
            <button
              onClick={() => requireAuth(() => onCartClick?.(), "/")}
              className={`relative ${iconMain} col-start-4 row-start-1`}
              aria-label="Кошик">
              <ShoppingCart className="h-4 w-4" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-live text-live-foreground text-[9px] font-bold rounded-full">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </button>
            <div className="col-start-5 row-start-1">
            {isGuest ? (
              <button
                className={`${iconMain} hover:bg-muted`}
                aria-label="Ще"
                onClick={() => goSignup("/")}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`${iconMain} hover:bg-muted`}
                  aria-label="Ще">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 z-[80]">
                <DropdownMenuItem onSelect={() => onSearchClick?.()} className="gap-2 cursor-pointer">
                  <Search className="h-4 w-4" /> Пошук
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRatingsClick?.()} className="gap-2 cursor-pointer">
                  <Trophy className="h-4 w-4 text-rating" /> Рейтинги
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPromoClick?.()} className="gap-2 cursor-pointer">
                  <Gift className="h-4 w-4 text-header-promo" /> Акції
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsReferralsOpen(true)} className="gap-2 cursor-pointer">
                  <Users className="h-4 w-4 text-header-referral" /> Реферали
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/manager")} className="gap-2 cursor-pointer">
                  <Megaphone className="h-4 w-4 text-header-promotion" /> Просування
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsLangOpen(true)} className="gap-2 cursor-pointer">
                  <Globe className="h-4 w-4 text-blue-500" /> Мова
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsRegionOpen(true)} className="gap-2 cursor-pointer">
                  <Flag className="h-4 w-4 text-rose-500" /> Регіон
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
            </div>
            {isSupplier ? (
              <>
                <div className="col-start-1 row-start-2 flex items-center justify-start">
                  <WalletCloudActions actions={underWalletActions} size="sm" />
                </div>
                <div className="col-start-2 col-end-5 row-start-2 flex items-center justify-start gap-0.5 flex-nowrap">
                  <WalletCloudActions actions={topupActions} arrow size="sm" />
                  <WalletBadgeCloud
                    variant={walletVariant}
                    bonusValue={wallet?.bonus_balance ?? 0}
                    cashValue={wallet?.balance ?? 0}
                    size="sm"
                    onClick={() => navigate("/wallet")}
                  />
                </div>
              </>
            ) : isGuest ? (
              <div className="col-start-2 col-end-5 row-start-2 flex items-center justify-start">
                <WalletBadgeCloud
                  variant={walletVariant}
                  bonusValue={wallet?.bonus_balance ?? 0}
                  cashValue={wallet?.balance ?? 0}
                  onClick={() => navigate("/login")}
                />
              </div>
            ) : (
              <div className="col-start-2 col-end-5 row-start-2 flex items-center justify-start gap-0.5 flex-nowrap">
                <WalletCloudActions actions={underWalletActions} arrow size="sm" />
                <WalletCloudActions actions={topupActions} size="sm" />
                <WalletBadgeCloud
                  variant={walletVariant}
                  bonusValue={wallet?.bonus_balance ?? 0}
                  cashValue={wallet?.balance ?? 0}
                  size="sm"
                  arrow={underWalletActions.length === 0}
                  onClick={() => navigate("/wallet")}
                />
              </div>
            )}
            <div className="col-start-5 row-start-2 flex items-start justify-center">
              <RotatingHintCloud items={moreHints} arrowAlign="center" />
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

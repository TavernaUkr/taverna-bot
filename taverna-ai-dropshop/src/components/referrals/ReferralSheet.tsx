import { useEffect, useMemo, useState } from "react";
import { Users, Copy, Check, Send, Sparkles, Coins, Wallet, ChevronRight, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { hapticNotification, hapticSelection } from "@/lib/haptics";

const FALLBACK_CODE = "TAV-8A2B5C";

/** Щаблі винагороди за кількість запрошених друзів. */
export const REFERRAL_TIERS = [
  { friends: 0, reward: 50 },
  { friends: 5, reward: 75 },
  { friends: 10, reward: 100 },
  { friends: 20, reward: 125 },
  { friends: 50, reward: 150 },
];

const tierFor = (friends: number) =>
  [...REFERRAL_TIERS].reverse().find((t) => friends >= t.friends) ?? REFERRAL_TIERS[0];

const nextTierFor = (friends: number) => REFERRAL_TIERS.find((t) => t.friends > friends);

interface ReferralSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Реферальна програма у вигляді нижньої шторки зі щаблями винагород. */
export function ReferralSheet({ open, onOpenChange }: ReferralSheetProps) {
  const navigate = useNavigate();
  const { profile } = useTelegramAuthContext();
  const [copied, setCopied] = useState(false);
  const [referralCode, setReferralCode] = useState(FALLBACK_CODE);
  const [invitedCount, setInvitedCount] = useState(0);

  useEffect(() => {
    if (!open || !profile?.id) return;
    const code = `TAV-${profile.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    setReferralCode(code);
    supabase
      .from("profiles_safe" as any)
      .select("id", { count: "exact", head: true })
      .eq("referred_by", profile.id)
      .then(({ count }) => setInvitedCount(count || 0));
  }, [open, profile?.id]);

  const current = useMemo(() => tierFor(invitedCount), [invitedCount]);
  const next = useMemo(() => nextTierFor(invitedCount), [invitedCount]);
  const progress = next
    ? Math.min(100, Math.round(((invitedCount - current.friends) / (next.friends - current.friends)) * 100))
    : 100;
  const earned = invitedCount * current.reward;

  const copy = () => {
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    hapticNotification("success");
    toast.success("Код скопійовано", { description: referralCode });
    setTimeout(() => setCopied(false), 2000);
  };

  const share = () => {
    hapticSelection();
    const text = `🎁 Приєднуйся до Taverna та отримай бонуси!\n\nМій код: ${referralCode}\n\n`;
    const url = `https://t.me/TavernaBot/app?startapp=ref_${referralCode}`;
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(tgUrl);
    else if (navigator.share) navigator.share({ title: "Приєднуйся до Taverna!", text, url });
    else window.open(tgUrl, "_blank");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Реферальна програма</SheetTitle>
          <SheetDescription>Запрошуй друзів — винагорода зростає з кожним щаблем</SheetDescription>
        </SheetHeader>

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl mt-3 p-4 text-center border border-border/60 bg-gradient-to-br from-primary/20 via-live/10 to-warning/15">
          <span className="pointer-events-none absolute -top-16 left-1/3 w-48 h-48 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative z-10">
            <div className="w-14 h-14 mx-auto mb-2 rounded-2xl bg-card/70 backdrop-blur-xl border border-border/60 flex items-center justify-center">
              <Users className="h-7 w-7 text-primary" />
            </div>
            <p className="text-xl font-extrabold text-foreground leading-tight">
              Запрошуй друзів –{" "}
              <span className="bg-gradient-to-r from-primary to-warning bg-clip-text text-transparent">
                отримуй {current.reward} ₴
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ви і друг отримуєте бонуси після його першого успішного замовлення.
            </p>
          </div>
        </div>

        {/* Код */}
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Ваш реферальний код
          </p>
          <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 py-4 text-center">
            <span className="text-2xl font-mono font-extrabold tracking-[0.18em] text-primary">{referralCode}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Button onClick={copy} variant="outline" className="h-11 rounded-xl gap-2 font-semibold">
              {copied ? <Check className="w-4 h-4 text-live" /> : <Copy className="w-4 h-4" />}
              Копіювати
            </Button>
            <Button
              onClick={share}
              className="h-11 rounded-xl gap-2 font-semibold bg-gradient-to-r from-primary to-live text-primary-foreground"
            >
              <Send className="w-4 h-4" />
              Поділитися
            </Button>
          </div>
        </div>

        {/* Метрики */}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/15 to-primary/5 p-3.5">
            <Users className="h-4 w-4 text-primary mb-1.5" />
            <p className="text-xl font-extrabold text-primary leading-none">{invitedCount}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Запрошено друзів</p>
          </div>
          <div className="rounded-2xl border border-border bg-gradient-to-br from-warning/20 to-warning/5 p-3.5">
            <Coins className="h-4 w-4 text-warning mb-1.5" />
            <p className="text-xl font-extrabold text-warning leading-none">{earned} ₴</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Зароблено бонусів</p>
          </div>
        </div>

        {/* Щаблі */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-warning" /> Щаблі винагороди
            </p>
            {next && (
              <p className="text-[11px] text-muted-foreground">
                Ще {next.friends - invitedCount} друзів до {next.reward} ₴
              </p>
            )}
          </div>

          <div className="h-2 rounded-full bg-muted overflow-hidden mb-2.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-live transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="space-y-1.5">
            {REFERRAL_TIERS.map((t) => {
              const reached = invitedCount >= t.friends;
              const isCurrent = t.friends === current.friends;
              return (
                <div
                  key={t.friends}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border p-2.5",
                    isCurrent ? "border-primary/40 bg-primary/5" : reached ? "border-border bg-card" : "border-dashed border-border bg-muted/30",
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold",
                      reached ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t.friends}
                  </div>
                  <p className="text-xs text-foreground flex-1">
                    {t.friends === 0 ? "Старт" : `Від ${t.friends} друзів`}
                  </p>
                  <span className={cn("text-sm font-bold", reached ? "text-success" : "text-muted-foreground")}>
                    {t.reward} ₴
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      зараз
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Як це працює */}
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">Як це працює?</p>
          {[
            "Поділіться своїм кодом з друзями",
            "Друг реєструється та робить перше замовлення",
            "Ви обидва отримуєте бонуси на рахунок",
          ].map((text, i) => (
            <div key={text} className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary">{i + 1}</span>
              </div>
              <p className="text-xs text-foreground/90">{text}</p>
            </div>
          ))}
        </div>

        <Button
          onClick={() => {
            hapticSelection();
            onOpenChange(false);
            navigate("/wallet");
          }}
          variant="outline"
          className="w-full h-11 rounded-xl gap-2 mt-3 mb-6"
        >
          <Wallet className="w-4 h-4" />
          Переглянути бонусний рахунок
          <ChevronRight className="w-4 h-4" />
        </Button>
      </SheetContent>
    </Sheet>
  );
}

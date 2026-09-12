import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Gift,
  Users,
  Copy,
  Check,
  Send,
  Sparkles,
  ChevronLeft,
  Wallet,
  ChevronRight,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { useNavigate } from "react-router-dom";

const FALLBACK_CODE = "TAV-8A2B5C";
const REWARD_PER_FRIEND = 100;

export default function Referrals() {
  const navigate = useNavigate();
  const { profile, isAuthenticated } = useTelegramAuthContext();
  const [copied, setCopied] = useState(false);
  const [referralCode, setReferralCode] = useState<string>(FALLBACK_CODE);
  const [invitedCount, setInvitedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const generateReferralCode = (userId: string): string => {
    const hash = userId.replace(/-/g, "").slice(0, 8).toUpperCase();
    return `TAV-${hash}`;
  };

  useEffect(() => {
    const initReferral = async () => {
      if (!profile?.id) {
        setIsLoading(false);
        return;
      }

      const code = generateReferralCode(profile.id);
      setReferralCode(code);

      if (!profile.referral_code) {
        await supabase.from("profiles").update({ referral_code: code }).eq("id", profile.id);
      }

      const { count } = await supabase
        .from("profiles_safe" as any)
        .select("id", { count: "exact", head: true })
        .eq("referred_by", profile.id);

      setInvitedCount(count || 0);
      setIsLoading(false);
    };

    initReferral();
  }, [profile?.id]);

  const earned = invitedCount * REWARD_PER_FRIEND;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    hapticNotification("success");
    toast.success("Код скопійовано", { description: referralCode });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    hapticSelection();
    const botUsername = "TavernaBot";
    const shareText = `🎁 Приєднуйся до Taverna та отримай 100 ₴ бонусів!\n\nВикористай мій код: ${referralCode}\n\n`;
    const shareUrl = `https://t.me/${botUsername}/app?startapp=ref_${referralCode}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
      window.Telegram.WebApp.openTelegramLink(telegramShareUrl);
    } else if (navigator.share) {
      navigator.share({ title: "Приєднуйся до Taverna!", text: shareText, url: shareUrl });
    } else {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
        "_blank",
      );
    }
  };

  const handleBack = () => {
    hapticSelection();
    navigate(-1);
  };

  const header = (
    <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-xl border-b border-border/60">
      <div className="flex items-center h-14 px-4">
        <button
          onClick={handleBack}
          aria-label="Назад"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mr-3"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">Реферальна програма</h1>
      </div>
    </header>
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-6">
              <Gift className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">Увійдіть для участі</h2>
              <p className="text-muted-foreground mb-4">
                Авторизуйтесь через Telegram, щоб отримати свій реферальний код
              </p>
              <Button onClick={() => navigate("/")} className="w-full">
                На головну
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-safe">
      {header}

      <main className="flex-1 overflow-y-auto scrollbar-hide">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden px-4 pt-6 pb-8"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-live/15 to-warning/20" />
          <span className="pointer-events-none absolute -top-24 left-1/3 w-72 h-72 rounded-full bg-primary/25 blur-3xl" />
          <span className="pointer-events-none absolute -bottom-24 -right-10 w-60 h-60 rounded-full bg-warning/20 blur-3xl" />

          <div className="relative z-10 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 16 }}
              className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-card/60 backdrop-blur-xl border border-border/60 shadow-xl flex items-center justify-center"
            >
              <Users className="w-9 h-9 text-primary" />
            </motion.div>
            <h2 className="text-[26px] font-extrabold leading-tight text-foreground">
              Запрошуй друзів –<br />
              <span className="bg-gradient-to-r from-primary to-warning bg-clip-text text-transparent">
                отримуй 100 ₴
              </span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto leading-snug">
              Ви і ваш друг отримуєте по 100 ₴ бонусів після його першого успішного замовлення.
            </p>
          </div>
        </motion.section>

        <div className="px-4 pb-8 space-y-4 -mt-4">
          {/* Код + дії */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl shadow-xl p-5">
              <span className="pointer-events-none absolute -right-12 -top-12 w-40 h-40 rounded-full bg-primary/10 blur-2xl" />
              <div className="relative z-10 space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Ваш реферальний код
                </p>

                <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-5 text-center">
                  <span className="text-[28px] font-mono font-extrabold tracking-[0.18em] text-primary">
                    {isLoading ? "…" : referralCode}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    onClick={handleCopyCode}
                    variant="outline"
                    size="lg"
                    className="h-12 rounded-2xl gap-2 font-semibold"
                  >
                    {copied ? <Check className="w-4 h-4 text-live" /> : <Copy className="w-4 h-4" />}
                    Копіювати код
                  </Button>
                  <Button
                    onClick={handleShare}
                    size="lg"
                    className="h-12 rounded-2xl gap-2 font-semibold bg-gradient-to-r from-primary to-live text-primary-foreground"
                  >
                    <Send className="w-4 h-4" />
                    Поділитися
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Метрики */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="grid grid-cols-2 gap-3"
          >
            {[
              {
                icon: Users,
                label: "Запрошено друзів",
                value: `${invitedCount}`,
                tint: "from-primary/15 to-primary/5",
                color: "text-primary",
              },
              {
                icon: Coins,
                label: "Зароблено бонусів",
                value: `${earned} ₴`,
                tint: "from-warning/20 to-warning/5",
                color: "text-warning",
              },
            ].map((m) => (
              <div
                key={m.label}
                className={cn(
                  "relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br p-4 backdrop-blur-xl shadow-sm",
                  m.tint,
                )}
              >
                <m.icon className={cn("h-5 w-5 mb-2", m.color)} />
                <p className={cn("text-2xl font-extrabold leading-none", m.color)}>{m.value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{m.label}</p>
              </div>
            ))}
          </motion.div>

          {/* Як це працює */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
          >
            <Card className="rounded-3xl border-border/60 bg-card/70 backdrop-blur-xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Як це працює?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3.5">
                {[
                  { step: 1, text: "Поділіться своїм кодом з друзями" },
                  { step: 2, text: "Друг реєструється та робить перше замовлення" },
                  { step: 3, text: "Ви обидва отримуєте по 100 ₴ бонусів!" },
                ].map((item) => (
                  <div key={item.step} className="flex items-center gap-3.5">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">{item.step}</span>
                    </div>
                    <p className="text-sm text-foreground/90">{item.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34 }}
          >
            <Button
              onClick={() => {
                hapticSelection();
                navigate("/wallet");
              }}
              variant="outline"
              className="w-full h-12 rounded-2xl gap-2"
              size="lg"
            >
              <Wallet className="w-5 h-5" />
              Переглянути бонусний рахунок
              <ChevronRight className="w-4 h-4" />
            </Button>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

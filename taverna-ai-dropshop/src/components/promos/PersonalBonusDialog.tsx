import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Gift, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { hapticNotification, hapticSelection } from "@/lib/haptics";

interface PersonalBonusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Прогрес шансу рідкісного бонусу, 0..100 */
  progress?: number;
}

type Stage = "idle" | "revealing" | "done";

/** Гейміфіковане вікно персонального бонусу (UI-стани, без бекенду). */
export function PersonalBonusDialog({
  open,
  onOpenChange,
  progress = 64,
}: PersonalBonusDialogProps) {
  const [stage, setStage] = useState<Stage>("idle");

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setStage("idle"), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (stage !== "revealing") return;
    const t = setTimeout(() => {
      setStage("done");
      hapticNotification("success");
    }, 2000);
    return () => clearTimeout(t);
  }, [stage]);

  const reveal = () => {
    hapticSelection();
    setStage("revealing");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[360px] p-0 border-0 overflow-hidden rounded-3xl [&>button:last-child]:hidden"
      >
        <DialogTitle className="sr-only">Ваш персональний бонус</DialogTitle>
        <div className="relative bg-gradient-to-br from-primary via-accent to-warning text-primary-foreground p-6 text-center">
          {/* світіння */}
          <span className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full bg-primary-foreground/20 blur-3xl" />
          <span className="pointer-events-none absolute -bottom-24 -right-10 w-52 h-52 rounded-full bg-warning/30 blur-3xl" />

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Закрити"
            className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-primary-foreground/15 backdrop-blur flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative z-10 flex flex-col items-center gap-3">
            <motion.div
              animate={
                stage === "revealing"
                  ? { rotate: [0, -8, 8, -8, 0], scale: [1, 1.06, 1] }
                  : { scale: [1, 1.04, 1] }
              }
              transition={{
                duration: stage === "revealing" ? 0.6 : 2.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="relative w-24 h-24 rounded-3xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center shadow-2xl"
            >
              <span className="absolute inset-0 rounded-3xl bg-primary-foreground/20 blur-xl" />
              {stage === "done" ? (
                <Crown className="relative h-11 w-11 text-warning drop-shadow" />
              ) : (
                <Gift className="relative h-11 w-11" />
              )}
              <Sparkles className="absolute -top-2 -right-2 h-5 w-5 text-warning animate-pulse" />
              <Sparkles className="absolute -bottom-2 -left-2 h-4 w-4 text-warning/80 animate-ping" />
            </motion.div>

            <div className="space-y-1">
              <h2 className="text-xl font-extrabold leading-tight">
                Ваш персональний бонус
              </h2>
              <p className="text-[12px] opacity-90 leading-snug">
                Особиста винагорода за вашу активність у Taverna
              </p>
            </div>

            <div className="w-full mt-1 space-y-1.5 text-left">
              <div className="flex items-center justify-between text-[11px] font-semibold opacity-95">
                <span>Шанс рідкісного бонусу</span>
                <span>{progress}%</span>
              </div>
              <Progress
                value={progress}
                className="h-2 bg-primary-foreground/20 [&>div]:bg-warning"
              />
              <p className="text-[11px] opacity-85 leading-snug">
                Ймовірність рідкісного бонусу зростає з кожним замовленням!
              </p>
            </div>

            <div className="w-full mt-3 min-h-[104px] flex items-center justify-center">
              <AnimatePresence mode="wait">
                {stage === "done" ? (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, scale: 0.85, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 240, damping: 18 }}
                    className="w-full rounded-2xl bg-primary-foreground/15 backdrop-blur-sm p-4 space-y-2"
                  >
                    <p className="text-[15px] font-extrabold">Вітаємо!</p>
                    <p className="text-[13px] leading-snug opacity-95">
                      Ви отримали знижку{" "}
                      <span className="font-extrabold text-warning">-15%</span> на
                      наступне замовлення
                    </p>
                    <Button
                      onClick={() => onOpenChange(false)}
                      className="w-full bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-bold"
                    >
                      Чудово
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="cta"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="w-full space-y-2"
                  >
                    <Button
                      onClick={reveal}
                      disabled={stage === "revealing"}
                      size="lg"
                      className="w-full h-12 rounded-2xl bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-extrabold text-[15px] shadow-lg"
                    >
                      {stage === "revealing" ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Розкриваємо…
                        </>
                      ) : (
                        <>
                          <Gift className="h-5 w-5" />
                          Відкрити бонус
                        </>
                      )}
                    </Button>
                    <p className="text-[11px] opacity-80">
                      Один бонус доступний після кожного виконаного замовлення
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

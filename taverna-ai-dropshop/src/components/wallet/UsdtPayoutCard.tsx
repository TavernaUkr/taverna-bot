import { motion } from "framer-motion";
import { Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { hapticSelection } from "@/lib/haptics";

function maskAddress(addr: string) {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

interface UsdtPayoutCardProps {
  connected: boolean;
  address?: string | null;
  currency?: string | null;
  onConnect: () => void;
}

/** Миттєві виплати USDT через Telegram Wallet. */
export function UsdtPayoutCard({ connected, address, currency, onConnect }: UsdtPayoutCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Zap className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">
              Миттєві виплати {currency || "USDT"} (Telegram Wallet)
            </p>
            {connected && (
              <Badge className="bg-success/15 text-success hover:bg-success/15 border-0 gap-1">
                <CheckCircle2 className="h-3 w-3" /> Активно
              </Badge>
            )}
          </div>

          {connected ? (
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              {address ? maskAddress(address) : "Гаманець підключено"}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Отримуйте кошти без комісій та затримок одразу на свій крипто-гаманець
            </p>
          )}
        </div>
      </div>

      <Button
        variant={connected ? "outline" : "default"}
        className="w-full mt-3 h-10"
        onClick={() => { hapticSelection(); onConnect(); }}
      >
        {connected ? "Змінити гаманець" : "Підключити"}
      </Button>
    </motion.div>
  );
}

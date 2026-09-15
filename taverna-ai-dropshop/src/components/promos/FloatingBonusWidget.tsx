import { Gift } from "lucide-react";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonalBonusDialog } from "@/components/promos/PersonalBonusDialog";
import { MyBonusesInventorySheet } from "@/components/promos/MyBonusesInventorySheet";
import { hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useFloatingTools } from "@/components/floating/FloatingToolsContext";

interface BonusFabProps {
  className?: string;
  menuAlign?: "start" | "end" | "center";
}

/** Кнопка бонусів у глобальному стовпчику FAB. */
export const BonusFab = ({ className, menuAlign = "end" }: BonusFabProps) => {
  const { openBonusInventory, openPersonalBonus } = useFloatingTools();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          type="button"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          aria-label="Бонуси"
          className={cn(
            "relative w-10 h-10 rounded-full",
            "bg-gradient-to-br from-warning via-rating to-primary",
            "text-primary-foreground shadow-lg shadow-primary/25",
            "flex items-center justify-center shrink-0",
            className
          )}
        >
          <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/30 blur-md animate-pulse" />
          <Gift className="relative z-10 h-4 w-4" />
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align={menuAlign} sideOffset={10} className="w-64 z-[80]">
        <DropdownMenuItem
          onSelect={() => {
            hapticSelection();
            openBonusInventory();
          }}
          className="gap-2 py-2.5 cursor-pointer"
        >
          <span>🎁</span>
          <span className="font-medium">Мій інвентар бонусів</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            hapticSelection();
            openPersonalBonus();
          }}
          className="gap-2 py-2.5 cursor-pointer"
        >
          <span>✨</span>
          <span className="font-medium">Персональний бонус</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Глобальна кнопка бонусів у спільному стовпчику FAB. */
export const FloatingBonusWidget = () => {
  const {
    chatOpen,
    bonusInventoryOpen,
    setBonusInventoryOpen,
    personalBonusOpen,
    setPersonalBonusOpen,
  } = useFloatingTools();

  return (
    <>
      {!chatOpen && <BonusFab />}

      <PersonalBonusDialog open={personalBonusOpen} onOpenChange={setPersonalBonusOpen} />
      <MyBonusesInventorySheet open={bonusInventoryOpen} onOpenChange={setBonusInventoryOpen} />
    </>
  );
};

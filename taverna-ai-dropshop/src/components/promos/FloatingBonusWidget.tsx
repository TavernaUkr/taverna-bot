import { useState } from "react";
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

/** Глобальна плаваюча кнопка бонусів — доступна на всіх сторінках. */
export const FloatingBonusWidget = () => {
  const [bonusOpen, setBonusOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.3 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            aria-label="Бонуси"
            className="fixed bottom-6 left-6 z-[60] w-12 h-12 rounded-full bg-gradient-to-br from-warning via-rating to-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center"
          >
            {/* м'яке світіння */}
            <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/40 blur-md animate-pulse" />
            <Gift className="relative z-10 h-5 w-5 animate-pulse" />
          </motion.button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={12} className="w-64 z-[70]">
          <DropdownMenuItem
            onSelect={() => { hapticSelection(); setInventoryOpen(true); }}
            className="gap-2 py-2.5 cursor-pointer"
          >
            <span>🎁</span>
            <span className="font-medium">Мій інвентар бонусів</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => { hapticSelection(); setBonusOpen(true); }}
            className="gap-2 py-2.5 cursor-pointer"
          >
            <span>✨</span>
            <span className="font-medium">Персональний бонус</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PersonalBonusDialog open={bonusOpen} onOpenChange={setBonusOpen} />
      <MyBonusesInventorySheet open={inventoryOpen} onOpenChange={setInventoryOpen} />
    </>
  );
};

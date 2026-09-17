import { Gift } from "lucide-react";
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
        <button
          type="button"
          aria-label="Бонуси"
          className={cn(
            "relative flex items-center justify-center w-12 h-12 rounded-full text-white bg-gradient-to-b from-amber-500 to-orange-600 shadow-[0_8px_15px_rgba(234,88,12,0.4),inset_0_2px_3px_rgba(255,255,255,0.3),inset_0_-3px_4px_rgba(0,0,0,0.4)] hover:scale-105 transition-transform duration-300",
            className
          )}
        >
          <Gift className="h-5 w-5 drop-shadow-md" />
        </button>
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

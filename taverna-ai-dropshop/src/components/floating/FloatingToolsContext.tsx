import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface FloatingToolsContextValue {
  feedOpen: boolean;
  /** true, коли відкрита стрічка товарів (TikTok view). */
  isFeedActive: boolean;
  setFeedOpen: (open: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  openBonusInventory: () => void;
  openPersonalBonus: () => void;
  bonusInventoryOpen: boolean;
  setBonusInventoryOpen: (open: boolean) => void;
  personalBonusOpen: boolean;
  setPersonalBonusOpen: (open: boolean) => void;
}

const FloatingToolsContext = createContext<FloatingToolsContextValue | null>(null);

export function FloatingToolsProvider({ children }: { children: ReactNode }) {
  const [feedOpen, setFeedOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [bonusInventoryOpen, setBonusInventoryOpen] = useState(false);
  const [personalBonusOpen, setPersonalBonusOpen] = useState(false);

  const value = useMemo(
    () => ({
      feedOpen,
      isFeedActive: feedOpen,
      setFeedOpen,
      chatOpen,
      setChatOpen,
      bonusInventoryOpen,
      setBonusInventoryOpen,
      personalBonusOpen,
      setPersonalBonusOpen,
      openBonusInventory: () => setBonusInventoryOpen(true),
      openPersonalBonus: () => setPersonalBonusOpen(true),
    }),
    [feedOpen, chatOpen, bonusInventoryOpen, personalBonusOpen]
  );

  return <FloatingToolsContext.Provider value={value}>{children}</FloatingToolsContext.Provider>;
}

export function useFloatingTools() {
  const ctx = useContext(FloatingToolsContext);
  if (!ctx) {
    throw new Error("useFloatingTools must be used within FloatingToolsProvider");
  }
  return ctx;
}

export function useFloatingToolsOptional() {
  return useContext(FloatingToolsContext);
}

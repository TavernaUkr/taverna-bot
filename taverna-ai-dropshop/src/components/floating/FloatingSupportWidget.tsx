import { Headphones } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { useFloatingToolsOptional } from "@/components/floating/FloatingToolsContext";
import { hapticImpact } from "@/lib/haptics";

const SUPPORT_ROLES = new Set(["customer", "supplier"]);

/** Плаваюча кнопка «Підтримка» — супутник у спільному стовпчику FAB. */
export function FloatingSupportWidget() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, effectiveRole } = useTelegramAuthContext();
  const floating = useFloatingToolsOptional();

  const onSupportPage = location.pathname.startsWith("/support");
  const canShow =
    isAuthenticated &&
    SUPPORT_ROLES.has(effectiveRole) &&
    !floating?.chatOpen &&
    !onSupportPage;

  if (!canShow) return null;

  return (
    <button
      type="button"
      aria-label="Підтримка"
      onClick={() => {
        hapticImpact("light");
        navigate("/support?contact=1");
      }}
      className={cn(
        "relative shrink-0",
        "w-10 h-10 rounded-full",
        "bg-gradient-to-br from-indigo-500 to-violet-600",
        "text-white shadow-lg shadow-indigo-500/35",
        "flex items-center justify-center",
        "hover:scale-110 active:scale-95",
        "transition-all duration-200"
      )}
    >
      <Headphones className="h-4 w-4" />
    </button>
  );
}

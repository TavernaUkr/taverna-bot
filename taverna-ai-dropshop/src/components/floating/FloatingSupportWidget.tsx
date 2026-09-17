import { Headphones } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
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
      className="relative flex items-center justify-center w-12 h-12 rounded-full text-white bg-gradient-to-b from-violet-500 to-violet-700 shadow-[0_8px_15px_rgba(109,40,217,0.4),inset_0_2px_3px_rgba(255,255,255,0.3),inset_0_-3px_4px_rgba(0,0,0,0.4)] hover:scale-105 transition-transform duration-300"
    >
      <Headphones className="h-5 w-5 drop-shadow-md" />
    </button>
  );
}

import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { DevRoleSwitcher } from "@/components/profile/DevRoleSwitcher";

type TestRole = "guest" | "customer" | "supplier" | "shop_manager" | "moderator" | "admin";

/**
 * Floating "Жук" — біля пункту «Профіль» у нижньому меню, на кожному екрані.
 * У production-збірці вимкнений.
 */
export const FloatingDevRoleSwitcher = () => {
  if (import.meta.env.PROD) return null;

  const { canUseDevRoleSwitcher, effectiveRole, setDevRoleOverride, realProfile } =
    useTelegramAuthContext();

  if (!canUseDevRoleSwitcher) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.15rem+env(safe-area-inset-bottom,0px))] z-[56]">
      <div className="relative mx-auto w-full max-w-md">
        <div className="pointer-events-auto absolute right-0.5 bottom-0">
          <DevRoleSwitcher
            currentRole={effectiveRole as TestRole}
            onRoleChange={(r) => setDevRoleOverride(r as TestRole)}
            profileId={realProfile?.id}
          />
        </div>
      </div>
    </div>
  );
};

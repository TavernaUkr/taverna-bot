import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { DevRoleSwitcher } from "@/components/profile/DevRoleSwitcher";

type TestRole = "guest" | "customer" | "supplier" | "shop_manager" | "moderator" | "admin";

/**
 * Floating "Жук" button available on every preview/dev page.
 * Completely disabled in production builds.
 */
export const FloatingDevRoleSwitcher = () => {
  if (import.meta.env.PROD) return null;

  const { canUseDevRoleSwitcher, effectiveRole, setDevRoleOverride, realProfile } =
    useTelegramAuthContext();

  if (!canUseDevRoleSwitcher) return null;

  return (
    <div className="fixed top-16 right-3 z-[60] scale-90 origin-top-right opacity-70 hover:opacity-100 focus-within:opacity-100 active:opacity-100 transition-opacity">
      <DevRoleSwitcher
        currentRole={effectiveRole as TestRole}
        onRoleChange={(r) => setDevRoleOverride(r as TestRole)}
        profileId={realProfile?.id}
      />
    </div>
  );
};

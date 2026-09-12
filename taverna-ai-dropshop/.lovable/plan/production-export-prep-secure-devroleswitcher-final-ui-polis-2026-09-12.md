# Production Export Prep: Secure DevRoleSwitcher & Final UI Polish

## Goal
Make the developer role switcher ("Жук") completely invisible in production builds, and clean up React warnings in the recently added admin/moderator UI components.

## What we will do

### 1. Secure `FloatingDevRoleSwitcher.tsx` for production
- Add an early return when `import.meta.env.PROD` is `true` so the component renders `null` before any auth/context logic runs.
- Keep the existing `canUseDevRoleSwitcher` check as a secondary guard for dev/preview environments.
- Result: the floating bug button and role override UI cannot appear in the compiled production bundle runtime.

### 2. Final React/frontend polish
- Fix any missing/unsafe `key` props in maps inside the new components:
  - `SupplierAuditCards.tsx`: make category badge keys unique per card (`${shop.id}-${category}`) to avoid duplicate-key warnings if categories repeat.
  - `SystemKillSwitch.tsx`, `PlatformTreasury.tsx`: verify all `.map()` calls already have stable keys.
- Remove or avoid any unconditional `console.log` statements in the new components.
- Confirm no SSR/hydration mismatches in SVG chart (`PlatformTreasury`) or Framer Motion mounts (`SupplierAuditCards`, `FloatingBonusWidget`).

### 3. Verify build
- Run typecheck and build.
- Open the preview to confirm the role switcher still works in Lovable preview and that no new console warnings appear from the polished components.

## What we will NOT touch
- No Supabase RLS policies, migrations, or backend edge functions.
- No routing changes.
- No functional behavior changes beyond production gating and key/warning cleanup.

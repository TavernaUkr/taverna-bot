# UI/UX Quick Wins: Empty Cart CTA & Admin Role Switcher

## Goal
Add a primary call-to-action to the empty Cart state and make the dev role switcher permanently visible for verified admins in every environment.

## Scope
Only React component changes. No database schema, edge function, or RLS changes.

## 1. Empty Cart UX

### Current state
`src/components/CartModal.tsx` shows the generic `<EmptyState type="cart" />` with the text "Кошик порожній / Додайте товари з каталогу..." and no next step.

### Change
Add a primary button directly below the empty-state text:
- Label: **"Додати товари"**
- Behavior: closes the Cart modal and navigates to `/` (home catalog).
- Styling: use the project's primary `Button` variant (`bg-primary text-primary-foreground`, rounded-xl, full-width, shadow) so it matches the checkout CTA.

### Implementation
- Import `useNavigate` from `react-router-dom` and `Button` from `@/components/ui/button`.
- Add `handleBrowseCatalog` callback: `onClose(); navigate('/');`.
- In the `items.length === 0` branch, render `<EmptyState ... />` followed by the new button.

## 2. Permanent Admin DevRoleSwitcher

### Current state
`src/components/TelegramAuthProvider.tsx` decides `canUseDevRoleSwitcher` with environment checks (`isLovableDevEnvironment`, `isDevEnv && isRealAdmin`). This means the switcher may be hidden outside preview/localhost even for real admins.

### Change
Refactor visibility so the switcher is shown **whenever the authenticated user has the real `admin` role**, regardless of domain or environment.

### Implementation
- In `TelegramAuthProvider.tsx`, replace the `canUseDevRoleSwitcher` derivation with a single check: `realRoles.includes('admin')`.
- Remove the dependency on `isLovableDevEnvironment` and `isDevEnv` for this decision.
- Keep the existing `setDevRoleOverride` guard (`if (!canUseDevRoleSwitcher) return;`) so non-admins cannot change roles.
- `FloatingDevRoleSwitcher.tsx` already consumes `canUseDevRoleSwitcher`, so it will automatically follow the new rule.
- No changes to `App.tsx` required.

## Verification
- Run typecheck and build.
- Open the preview, clear the cart, and confirm the new "Додати товари" button closes the modal and lands on `/`.
- Log in as an admin user and confirm the "Жук" role switcher is visible; log in as a non-admin and confirm it is hidden.

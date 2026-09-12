# Plan: Cart Button UX — Floating CartBadgeCloud

## Goal
Restore the main Header cart icon to a simple badge-only trigger and add a floating "CartBadgeCloud" pill underneath it, mirroring the existing `WalletBadgeCloud` glassmorphism style.

## Changes

### 1. `src/components/Header.tsx`
- Revert the ShoppingCart button to a `w-8 h-8` icon-only button.
- Keep the red `cartCount` notification badge.
- Set `onClick` to always call `onCartClick?.()` — never navigate to `/` from the icon.
- Wrap the cart button in a `relative` container (like the wallet button) and render the new `CartBadgeCloud` below it.
- Remove the old text label / conditional "Додати"/"Оформити" logic from the main button.

### 2. New file: `src/components/cart/CartBadgeCloud.tsx`
- Accept props: `cartCount`, `onAdd` (navigate to catalog), `onCheckout` (open cart modal).
- Render as an absolute-positioned floating container directly under the cart icon (`top-full right-0 mt-1.5 z-30`).
- Use the same visual language as `WalletBadgeCloud`:
  - `bg-card/90 backdrop-blur`, `border border-primary/40`, rounded-full pill, soft shadow, small arrow/tail pointing up.
  - Subtle `animate-cloud-float` float animation.
- If `cartCount === 0`: show pill button labeled "Додати"; click calls `onAdd` (navigate to `/`).
- If `cartCount > 0`: show pill button labeled "Оформити"; click calls `onCheckout` (open cart modal).
- Include a tiny cart icon inside the pill and respect `active:scale-95` tap feedback.

### 3. Styling rules
- Do not hardcode colors; use existing semantic tokens (`bg-card`, `border-primary/40`, `text-primary`, `text-live`, etc.).
- Keep the cloud compact so it does not overlap neighboring header icons on mobile.
- Preserve the existing WalletBadgeCloud exactly as-is.

## Verification
- TypeScript check (`tsgo`) and build (`bun run build`) must pass.
- Browser check: empty cart shows "Додати" cloud that navigates home; non-empty cart shows "Оформити" cloud that opens the cart modal; main icon always opens the cart modal.

## Out of scope
- No backend, schema, RLS, or payment logic changes.

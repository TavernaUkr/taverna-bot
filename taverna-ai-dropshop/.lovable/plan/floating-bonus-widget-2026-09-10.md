# Floating Bonus Widget

Move the "Персональний бонус" and "Мої бонуси" actions out of the catalog hero into a globally mounted floating widget, next to the AI chat button.

## What you'll see

- A glowing Gift button floating at the bottom-left of every page (opposite the AI chat button at bottom-right).
- Tapping it opens a small popup with two actions:
  - "Мій інвентар бонусів" — opens the existing bonuses inventory sheet
  - "Персональний бонус" — opens the existing personal bonus dialog
- The two old static buttons disappear from the main page hero; the promos banner stays.

## Steps

1. **Create `src/components/promos/FloatingBonusWidget.tsx`**
   - Fixed button: `fixed bottom-6 left-6 z-[60]`, rounded-full, primary gradient, glowing ring + subtle pulse on a `<Gift>` icon.
   - Framer Motion entrance (scale/spring mount) and `whileHover`/`whileTap` scale.
   - `DropdownMenu` (existing shadcn component) wrapping the button with two items:
     - `🎁 Мій інвентар бонусів` → `setInventoryOpen(true)`
     - `✨ Персональний бонус` → `setBonusOpen(true)`
   - Renders `MyBonusesInventorySheet` and `PersonalBonusDialog` with local `open`/`onOpenChange` state (same props API as in `PromoHeroBanner`).
   - `hapticSelection()` on open actions, matching existing patterns.

2. **Mount globally in `src/App.tsx`**
   - Import `FloatingBonusWidget` and render it inside the providers, right after `<FloatingDevRoleSwitcher />` inside `BrowserRouter`, so it persists across all routes.
   - Note: `AIChatAssistant` is currently mounted only in `Index.tsx`; it stays as-is — the new widget is the one mounted globally in App.

3. **Cleanup `src/components/PromoHeroBanner.tsx`** (holds the old buttons, used by `Index.tsx`)
   - Remove the "Персональний бонус" and "Мої бонуси" buttons, the `bonusOpen`/`inventoryOpen` state, the dialog/sheet renders and their imports (`PersonalBonusDialog`, `MyBonusesInventorySheet`, `Crown`, `Package`).
   - Keep the main "Акції та знижки" banner untouched.
   - `WalletOffers.tsx` keeps its own inventory sheet usage — out of scope.

4. **Verify**
   - `npx tsgo --noEmit` passes; build log OK.
   - Preview: widget visible on `/` and another route (e.g. `/promos`), popup opens, both sheet/dialog open, hero shows only the promos banner.

## Technical details

- Positioning: `bottom-6 left-6`, `z-[60]` (above bottom nav, below modals/sheets which render in portals).
- No backend, routing, schema, or policy changes — pure frontend, reusing existing dialog/sheet components.

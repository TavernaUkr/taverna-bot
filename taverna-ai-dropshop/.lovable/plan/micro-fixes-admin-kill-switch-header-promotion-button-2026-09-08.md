# Micro-fixes: Admin Kill Switch + Header Promotion Button

## Goal
Make the Admin Kill Switch sub-toggles fully independent, and add a global "Просування" promotion button to the header action bar.

## Changes

### 1. `src/components/admin/SystemKillSwitch.tsx` — independent kill switches
- Keep the main `maintenance` toggle and fixed red banner exactly as-is.
- Change each sub-switch (`payments`, `payouts`, `orders`) so it reads only its own flag state:
  - `checked={flags[f.key]}` instead of `checked={maintenance && flags[f.key]}`.
- Remove `disabled={!maintenance}` so the Admin can toggle them individually regardless of the main maintenance state.
- Leave the confirmation dialog, demo toast, and styling untouched.

### 2. `src/components/Header.tsx` — global promotion button
- Import `Megaphone` from `lucide-react` alongside the existing icons.
- Insert a new button in the right action bar (after the Referrals/Users button, before Search) with:
  - `onClick={() => navigate("/manager")}`
  - `aria-label="Просування"`
  - Classes matching adjacent icons: `w-8 h-8 rounded-lg flex items-center justify-center text-primary hover:bg-primary/10 active:scale-95 transition-all`
  - Icon: `<Megaphone className="h-4 w-4" />`
- Do not modify any other header logic, badges, or modals.

## Verification
- Run `npx tsgo --noEmit` and confirm no type errors.
- Check the build log for a successful build.
- Visually confirm in preview:
  - Kill Switch sub-toggles can be toggled ON/OFF independently without enabling maintenance.
  - New Megaphone icon appears in the header and navigates to `/manager`.

## Scope
Strict, minimal, UI-only changes. No backend, schema, RLS, routing, or financial logic changes.
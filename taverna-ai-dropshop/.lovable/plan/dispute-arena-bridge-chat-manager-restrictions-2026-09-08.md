# Dispute Arena + Bridge Chat + Manager restrictions

UI/demo only. No database, policy, or backend routing changes.

## 1. Dispute Arena (`src/components/moderator/DisputesManager.tsx`)

Replace the flat dispute card with a comparative conflict view:

- Header strip: order number, amount, age of dispute, urgency colour (over 24h = red).
- Split card: left column "Претензія клієнта" (client avatar, name, claim text, attached order items), right column "Позиція магазину / Історія" (shop name, response or "Без відповіді", short event timeline). Stacks vertically on mobile.
- Quick action row under each dispute: "Повернути кошти", "Штраф магазину", "Штраф клієнту", "Ескалація до Адміна". Each opens a small confirm dialog with a comment field and shows a success toast; refund/close still uses the existing ticket update already in the file, the penalty/escalation actions are demo-only with an internal note appended to the ticket message thread.
- Keep the existing resolution dialog for the final verdict.

## 2. Bridge Chat (`src/components/SupportChat.tsx`, `src/components/moderator/TechSupportQueue.tsx`)

- Telegram-style polish: tighter bubbles with tails, grouped consecutive messages, date separators, animated "друкує..." typing indicator, smooth send animation, long-press/hover emoji quick reactions (local state only).
- Moderator dual view: when the viewer is a moderator/admin, a segmented toggle in the header switches between "Клієнт" and "Магазин (приватно)". The shop thread is a private internal view with a distinct tinted background and a "внутрішній" label so it never looks like the client thread.
- Action menu in the chat header (three dots): "Попередження", "Тимчасове блокування", "Ескалація до адміна", "Закрити звернення" — confirm dialog + toast, demo-only for warning/ban.
- `TechSupportQueue.tsx`: card polish (avatar, urgency pill, unread bubble, last-message preview) and a direct "Відкрити міст" action that opens the chat already on the dual view.

## 3. Manager restrictions (Wallet)

For active role `shop_manager` (not owner/admin/supplier):

- Hide (not just disable) top-up, withdraw, USDT payout, debt settlement and inter-shop transfer controls in `WalletOverview.tsx`, `SupplierDebtCard.tsx`, `UsdtPayoutCard.tsx`, `ShopBalancesList.tsx`, `WalletAccount.tsx`.
- Keep read-only order totals, incoming-payment status and chats. Bottom bar stays on the existing `readonly` variant.
- Add one shared `canManageFinances` flag derived from the active role so every surface uses the same rule.

## Verification

Typecheck, build, and a mobile-viewport browser pass over the moderator panel, a support chat and the wallet in manager role.

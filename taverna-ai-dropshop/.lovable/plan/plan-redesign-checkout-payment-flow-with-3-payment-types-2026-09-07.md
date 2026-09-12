# Plan: Redesign Checkout Payment Flow with 3 Payment Types

## Goal
Add a "Payment Type" (Вид оплати) tier above the existing "Payment Method" (Спосіб оплати) in the checkout modal. Make the order summary react dynamically to the selected type and filter available payment methods accordingly. No database schema changes.

## Scope
- `src/components/checkout/PaymentMethodSelect.tsx`
- `src/components/checkout/OrderSummary.tsx`
- `src/components/CheckoutModal.tsx`

## Implementation

### 1. Payment Type model
Introduce a new exported type in `PaymentMethodSelect.tsx`:

```ts
export type PaymentType = "full_prepayment" | "markup_only" | "cod";
```

Add a new `paymentType` prop to `PaymentMethodSelect` and render a `RadioGroup` labeled **"Вид оплати"** above the existing method list.

Options:
- **Повна оплата** — "Оплатіть 100% вартості зараз"
- **Часткова оплата (Лише націнка)** — "Оплатіть лише націнку платформи. Решту — накладним платежем при отриманні"
- **При отриманні (Накладений платіж)** — "Оплатіть повну суму на пошті при отриманні"

Use the existing `RadioGroup`/`RadioGroupItem` components and the same glassmorphism card styles already used for payment methods.

### 2. Dynamic payment methods
- If `paymentType === "cod"`, hide/disable all online methods and render a single read-only card: **"Оплата при отриманні на пошті"**.
- If `paymentType === "full_prepayment"`, show all enabled methods (cash, card, mono, apple pay, google pay, telegram wallet, taverna balance).
- If `paymentType === "markup_only"`, show only online methods capable of instant payment (card, mono, apple pay, google pay, telegram wallet, taverna balance). Hide cash/COD because the user is explicitly paying the markup now.

When the type changes to COD, automatically set `paymentMethod` to `"cash"` (the only valid COD method). When the type changes away from COD, keep or reset to `"cash"` if the current method is invalid.

### 3. CheckoutModal state
In `CheckoutModal.tsx`:
- Add `paymentType` state defaulting to `"full_prepayment"`.
- Pass `paymentType` and `onPaymentTypeChange` into `PaymentMethodSelect`.
- Derive an `amountToPayNow` value:
  - `full_prepayment` → `total`
  - `markup_only` → `Math.round(total * 0.25)` (using the requested 25% average markup assumption)
  - `cod` → `0`
- Pass `paymentType` and `amountToPayNow` into `OrderSummary`.

### 4. OrderSummary updates
Extend `OrderSummary` props with `paymentType` and `amountToPayNow`.

- Replace the static total display with a dynamic block:
  - Always show **"Сума до сплати зараз"** = `{amountToPayNow} ₴`.
  - If `paymentType === "cod"`, also show **"До сплати на пошті: {total} ₴"**.
  - If `paymentType === "markup_only"`, show a helper line: **"Решта при отриманні: {total - amountToPayNow} ₴"**.
- Keep the existing discount breakdown (promo, bonuses, personal bonus) unchanged.

### 5. Confirm step updates
In `CheckoutModal.tsx` confirm step:
- Update the payment info block to show both the selected payment type label and the payment method label.
- Update the final **"До сплати"** highlight to show `amountToPayNow` instead of `total`.
- For COD, the confirm button label remains **"Підтвердити замовлення"** (no online payment needed).
- For full prepayment/markup only, behavior remains unchanged (Taverna balance and Telegram wallet flows still work).

## Verification
- `tsgo` typecheck passes.
- `bun run build` succeeds.
- Browser check: open cart, proceed to checkout payment step, cycle through the three payment types, verify:
  - method list filters correctly,
  - OrderSummary shows correct "pay now" amount and COD post-office amount,
  - confirm step reflects selected type and amount.

## Notes
- No backend/RLS/schema changes.
- The 25% markup is a UI-only calculation assumption as requested.

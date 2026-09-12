# Super-Admin Command Center

Mobile-first UI only. Mock data and local React state. No database, policy, or backend changes.

## 1. Platform Treasury (new `src/components/admin/PlatformTreasury.tsx`)

- Glassmorphism card block with three headline figures: "Оборот платформи (GMV)", "Чистий дохід (Націнка)", "Заборгованість перед магазинами", each with icon, delta vs last week and semantic tint (primary / success / warning).
- 7-day revenue trend rendered as an inline SVG curve plus a compact bar row; values from a mock array. Legend line under the chart, e.g. "+18% за 7 днів".
- Stacks to one column on phone, three across on wider screens.

## 2. Tinder-style supplier audit (new `src/components/admin/SupplierAuditCards.tsx`)

- Card stack of 4-5 mock pending shops: name, avatar initials, categories, region, product count, submitted-at.
- "AI-вердикт" block on a tinted background with a risk pill (low / medium / high), e.g. "Ціни відповідають ринку. Фото унікальні. Ризик низький".
- Two large bottom buttons: "Відхилити" (destructive) and "Схвалити" (success). Framer Motion swipe-out exit (rotate + fly left/right) via `AnimatePresence`; next card scales up. Drag-to-swipe on touch as well.
- Toast per decision, counter "Залишилось N", and an empty state "Черга порожня" with a reset button so the demo can be replayed.

## 3. System kill switch (new `src/components/admin/SystemKillSwitch.tsx`)

- "Небезпечна зона" card with a red-tinted border and a large switch "Технічні роботи / Зупинка платежів".
- Confirmation dialog before enabling. When ON, a fixed red banner appears at the top of the screen: "Увага: Платформу переведено в режим технічних робіт. Платежі призупинено", plus a secondary switch row showing what is paused (payments, payouts, new orders).
- State is local only; nothing is written anywhere.

## 4. Assembly (`CommandCenter.tsx`, `AdminDashboard.tsx`)

- `CommandCenter` keeps its KPI grid and "Потребує уваги" list, then renders Treasury, supplier audit, quick actions, and the kill switch last.
- Existing admin tabs (orders, payments, stores, applications, support, marketing, analytics, roles) stay untouched and reachable; "overview" remains the default tab for admin.
- Mobile pass: 2-column KPI grid on narrow screens, horizontally scrollable tab strip, comfortable tap targets.

## Verification

Typecheck, build, and a mobile-width browser pass over the admin overview tab (swipe a card, toggle the kill switch).

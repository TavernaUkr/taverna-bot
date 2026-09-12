# Moderator Command Center: demo data + premium redesign

UI/demo only. No database, policy, or backend changes.

## 1. Always-visible demo data

`DisputesManager.tsx`
- Add a `MOCK_DISPUTES` array with 3+ rich cases (e.g. "Пошкоджена коробка" 1 450 ₴ vs shop reply "Надіслали відео цілого пакування"; "Не той розмір" 890 ₴; "Замовлення не доїхало" 3 200 ₴), each with client claim, shop position, event history and different ages so the urgency timer shows hot/warm/new.
- Skip the live fetch: seed state with the mock list and start with loading off. If a real query ever returns rows, they replace the demo list; otherwise the demo stays on screen.
- Quick actions (refund, shop penalty, client penalty, escalate) operate on local state with confirm dialog + toast, so they work with no records in the database.

`TechSupportQueue.tsx`
- Same treatment with `MOCK_TICKETS`: 4 tickets with names, last message preview, unread counts and mixed ages covering urgent / waiting / new pills.

## 2. Command Center header (`ModeratorPanel.tsx`)

- Replace the four plain metric cards with a glassmorphism grid: translucent cards, subtle gradient tints and a soft glow — red/orange for alerts, amber for waiting, emerald for system health.
- Metrics shown: "Гарячі спори", "Сер. час відповіді 8 хв", "Навантаження системи 74 %" (thin progress bar), plus open reports/tickets counts. Numbers come from demo data when the live counters are zero.
- Tabs become a tactical control strip: pill-shaped segmented switches with active fill, icon + label, count badges, horizontally scrollable on mobile.
- All colours come from existing theme tokens; no hardcoded colour classes.

## 3. Chat toggle visible in preview (`SupportChat.tsx`)

- The "Чат з клієнтом / Приватно з магазином" toggle and the moderator actions menu currently render only for admin/moderator roles. Extend the condition so they also render in the preview environment (the same preview flag the role switcher uses), keeping the real role check for production.

## Verification

Typecheck, build, and a browser pass over `/moderator` plus one support chat.

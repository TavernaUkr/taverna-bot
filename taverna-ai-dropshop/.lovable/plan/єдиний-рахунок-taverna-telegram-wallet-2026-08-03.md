# Єдиний рахунок Taverna + Telegram Wallet

Один гаманець для кожного користувача: бонуси, поповнення (Telegram Wallet, Apple/Google Pay, Mono, LiqPay, Nova Pay), миттєві оплати замовлень і виводи на Telegram Wallet або картку — з чеками і лімітами.

## Що отримає користувач

**Підключення Wallet при вході в роль «Клієнт»**
- Після переходу з «Гостя» у «Клієнта» одразу показується екран-онбординг «Підключити Telegram Wallet»: одна кнопка, підтвердження всередині Telegram, без форм.
- Можна пропустити — тоді банер підключення лишається у профілі та в чекауті.
- Постачальник при першому вході в «Рахунок постачальника» бачить той самий крок підключення (адреса TON/USDT або картка).

**Єдиний рахунок (нова сторінка «Мій рахунок»)**
- Один головний баланс = кошти + бонуси, з розбивкою: «Доступно», «Бонуси», «В обробці».
- Кнопка «Поповнити»: Telegram Wallet, Apple Pay, Google Pay, Mono Pay, LiqPay, Nova Pay (перші — активні через Wallet Pay, решта — окремі провайдери, вмикаються по мірі підключення ключів).
- Кнопка «Вивести»: на Telegram Wallet або на картку/IBAN, з показом лімітів (мін. сума, добовий ліміт, комісія, строк).
- Історія рухів з чеками: поповнення, оплати, бонуси, повернення, виводи — кожен рядок відкриває чек (сума, метод, транзакція, час) з можливістю поділитися в Telegram.
- Налаштування: метод виводу за замовчуванням, автовивід із мінімальною сумою, ліміт витрати бонусів на замовлення.

**Оплата замовлення**
- У чекауті новий метод «Рахунок Taverna» — оплата в один тап з балансу (бонуси списуються в межах дозволених 7%).
- Якщо коштів не вистачає — пропонується доплата через Telegram Wallet у тому ж екрані, без виходу з чекауту.

**Постачальник / менеджер**
- «Рахунок постачальника» стає тим самим єдиним рахунком: баланс магазину, виводи на Wallet або IBAN, автовиводи, чеки.
- Менеджер, як і зараз, лише переглядає надходження без сум виводу і без реквізитів.

## Технічна реалізація

**База даних (одна міграція)**
- `wallets`: `owner_type` (`profile|supplier`), `owner_id`, `balance`, `bonus_balance`, `pending`, `currency`, `is_connected`, `tg_wallet_address`. RLS: власник читає своє; запис лише service_role. GRANT: `authenticated` — select, `service_role` — all.
- `wallet_transactions`: `wallet_id`, `type` (`topup|payment|payout|bonus_earn|bonus_spend|refund|hold`), `amount`, `bonus_amount`, `provider` (`telegram_wallet|apple_pay|google_pay|mono|liqpay|nova_pay|internal`), `status`, `external_id`, `order_id`, `receipt jsonb`. RLS/GRANT аналогічно.
- `wallet_limits`: мін./макс. вивід, добовий ліміт, комісія — керується адміном.
- Міграція даних: існуючі `user_bonuses.balance` переносяться в `wallets.bonus_balance`, `shop_balances` — у гаманці постачальників (як дзеркало, джерело істини лишається за `shop_balances` до повного переходу).

**Edge-функції**
- `wallet-account` (нова, `verify_jwt = false`, сесія перевіряється в коді): `get_account` (баланс + історія + ліміти), `connect_wallet`, `create_topup` (маршрутизує у Wallet Pay або провайдера), `pay_with_balance` (серверний перерахунок суми замовлення, атомарне списання коштів+бонусів, створення `wallet_transactions` і оновлення `orders.payment_status`), `request_payout`, `set_payout_settings`.
- `wallet-pay`: додати `create_topup_invoice` (поповнення без прив'язки до замовлення) і `payout_to_wallet`.
- `wallet-webhook`: обробляти поповнення (зарахування в `wallets.balance`) поряд з оплатою замовлень; ідемпотентність по `external_id`.
- `bank-gateway`: виводи постачальника пишуть рух і в `wallet_transactions`, щоб історія була єдина.
- Sandbox: без `WALLET_PAY_API_KEY` усі операції емулюються (поповнення зараховується за кілька секунд), щоб потік був повністю видимий у прев'ю і під тестовими ролями через «Жука».

**Фронтенд**
- `src/hooks/useWallet.tsx` — єдине джерело балансу/історії (замінює прямі виклики `useBonuses` у UI, `useBonuses` лишається обгорткою для сумісності).
- `src/pages/WalletAccount.tsx` — сторінка «Мій рахунок» (баланс, поповнення, вивід, історія, чеки, налаштування).
- `src/components/wallet/ConnectWalletSheet.tsx` — онбординг підключення, тригериться при зміні ролі гість → клієнт (у `TelegramAuthProvider`) і з профілю.
- `src/components/wallet/TopUpSheet.tsx`, `PayoutSheet.tsx`, `ReceiptDialog.tsx`.
- `CheckoutModal.tsx` + `PaymentMethodSelect.tsx`: метод «Рахунок Taverna» з доплатою через Wallet.
- `SupplierBalanceCard.tsx` / `ShopPaymentsView.tsx`: перехід на `useWallet`, збереження read-only режиму менеджера.
- `BonusAccount.tsx`: бонуси показуються як частина єдиного рахунку з переходом на нову сторінку.

**Секрети**
- `WALLET_PAY_API_KEY` (є в плані Wallet Pay). Для Mono/LiqPay/Nova Pay ключі запитаємо окремо, коли ці рейли вмикатимемо; до того вони показані як «Скоро».

## Поза межами цього кроку
Реальні договори з Mono/LiqPay/Nova Pay і виводи на картку через них — UI і схема готуються, активація після отримання ключів.

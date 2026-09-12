# Telegram Wallet Pay: миттєві оплати та виводи

Підключаємо Wallet Pay (wallet.tg) як окремий платіжний рейл: клієнт оплачує замовлення в один тап через Telegram Wallet, постачальник виводить кошти на свій Wallet — вручну або автоматично.

## Що отримає користувач

**Клієнт (checkout)**
- Пункт «Telegram Wallet» у виборі оплати стає активним (зараз «Скоро»).
- Після підтвердження замовлення відкривається оплата у Wallet (усередині Mini App через `openInvoice`/`openLink`).
- Статус оплати оновлюється миттєво через вебхук: замовлення переходить у `payment_status = paid`, показується чек із сумою, валютою і хешем транзакції.
- Якщо оплату скасовано або протерміновано — замовлення лишається неоплаченим, можна повторити оплату кнопкою «Сплатити знову».

**Постачальник (Рахунок постачальника)**
- Новий метод виплат «Telegram Wallet» поруч з IBAN: вказує свою Wallet-адресу (TON/USDT).
- Кнопка «Вивести на Telegram Wallet» — ручний запит виводу.
- У діалозі «Автооплати» — перемикач автовиводу на Wallet з мінімальною сумою та розкладом (аналогічно поточному IBAN-автовиводу).
- Історія рухів показує тип виплати (банк / Wallet) з посиланням на транзакцію.

**Адмін**
- У Панелі оплат і в панелі Taverna Group видно Wallet-платежі та Wallet-виводи окремим провайдером, з фільтром і сумами.
- Адмін підтверджує ручні Wallet-виводи так само, як банківські.

## Технічна реалізація

**Схема БД (одна міграція)**
- `wallet_invoices`: `order_id`, `profile_id`, `wallet_invoice_id`, `amount`, `currency`, `status` (`active|paid|expired|cancelled|failed`), `pay_link`, `paid_at`, `raw_payload jsonb`. RLS: клієнт бачить лише свої, службова роль — усе; GRANT для `authenticated` (select) та `service_role` (all).
- `payout_methods`: `provider` розширюється значенням `telegram_wallet`, додаються `wallet_address`, `wallet_currency`.
- `balance_movements.provider` приймає `telegram_wallet` (значення текстове — змін схеми не потребує, лише запис).

**Секрети**
- `WALLET_PAY_API_KEY` (Store API key з wallet.tg) — запитаємо через захищену форму.
- `WALLET_PAY_WEBHOOK_SECRET` — той самий ключ використовується Wallet Pay для підпису; перевірка підпису обов'язкова.

**Edge-функції**
- `wallet-pay` (нова, `verify_jwt = false`): дії `create_invoice` (створює рахунок у Wallet Pay для замовлення, серверно перераховує суму з кошика — ціни з клієнта не приймаються), `get_invoice_status`, `create_payout` (виплата постачальнику на Wallet-адресу).
- `wallet-webhook` (нова, `verify_jwt = false`): приймає `PAY` / `FAILED` події, перевіряє HMAC-підпис заголовка, ідемпотентно (по `wallet_invoice_id`) оновлює `wallet_invoices`, `orders.payment_status`, створює `balance_movements` та нараховує спліти постачальникам — та сама логіка, що для передоплати банком.
- `bank-gateway`: `set_payout_method` приймає `telegram_wallet`; `request_withdrawal` і `run_auto_withdrawals` маршрутизують виплату у `wallet-pay` `create_payout`, коли дефолтний метод — Wallet. Менеджерам вивід і редагування Wallet-адреси лишаються забороненими (403), як зараз.

**Фронтенд**
- `PaymentMethodSelect.tsx`: `telegram_wallet` активний (бейдж «Миттєво»).
- `CheckoutModal.tsx`: гілка Wallet — виклик `create_invoice`, `openInvoice`, підписка на статус (polling до 3 хв + realtime по `wallet_invoices`), екран чека.
- `SupplierBalanceCard.tsx`: вкладка методу виплат Wallet, поле адреси, кнопка виводу, перемикач автовиводу в діалозі «Автооплати».
- Панелі адміна: колонка/фільтр провайдера `telegram_wallet`.

**Тестовий режим**
- Якщо `WALLET_PAY_API_KEY` відсутній — `wallet-pay` працює у sandbox: генерує фейковий рахунок і за кілька секунд «оплачує» його, щоб у прев'ю (і під тестовими ролями через «Жука») повністю було видно потік оплати, чек, нарахування та вивід.

## Поза межами цього кроку
Єдиний спільний рахунок (бонуси + Wallet + Apple/Google/Nova/Mono/LiqPay поповнення) — наступний етап; ця реалізація закладає під нього таблиці рухів і провайдерів.

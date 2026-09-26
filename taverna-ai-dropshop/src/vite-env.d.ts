/// <reference types="vite/client" />

// Глобальний тип Telegram Web App SDK: скрипт telegram-web-app.js
// інжектиться у window ззовні (через <script> в index.html), тож TS його
// не бачить. Декларація нижче гасить помилки TS2339 ("Property 'Telegram'
// does not exist on type 'Window'") у місцях прямого доступу
// (window.Telegram?.WebApp?...) — Referrals, ReferralSheet, haptics тощо.
// 'any' свідомо: WebApp має багато динамічних полей, типізуємо мінімум.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Window {
  Telegram?: any;
  /** Фолбек initData для dev-прев'ю без Telegram (lib/dev-preview.ts). */
  __TAVERNA_INIT_DATA__?: string;
}

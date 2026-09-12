/** Резерв платформи: магазин не можна спустошити до нуля. */
export const SHOP_RESERVE = 1000;
/** Борг, з якого магазин блокується та ховається з каталогу. */
export const DEBT_BLOCK_THRESHOLD = 1000;

export interface AllocSource {
  id: string | null;
  name: string;
  available: number;
  pending?: number;
  debt?: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Скільки реально можна вивести з джерела (з урахуванням резерву для магазинів). */
export function withdrawableOf(source: AllocSource): number {
  const available = Number(source.available || 0);
  if (source.id === null) return r2(Math.max(0, available));
  return r2(Math.max(0, available - SHOP_RESERVE));
}

/** Магазин заблоковано через борг. */
export function isShopBlocked(debt?: number | null): boolean {
  return Number(debt || 0) >= DEBT_BLOCK_THRESHOLD;
}

/**
 * Пропорційно розподіляє загальну суму виводу між обраними джерелами.
 * Повертає мапу id -> сума (для особистого гаманця ключ "__personal__").
 */
export const PERSONAL_KEY = "__personal__";

export function allocateAmount(sources: AllocSource[], total: number): Record<string, number> {
  const amount = Math.max(0, Number(total) || 0);
  const caps = sources.map((s) => ({ key: s.id ?? PERSONAL_KEY, cap: withdrawableOf(s) }));
  const pool = caps.reduce((sum, c) => sum + c.cap, 0);
  const result: Record<string, number> = {};
  if (amount <= 0 || pool <= 0) {
    caps.forEach((c) => { result[c.key] = 0; });
    return result;
  }
  const target = Math.min(amount, pool);
  let assigned = 0;
  caps.forEach((c, i) => {
    const isLast = i === caps.length - 1;
    const raw = isLast ? target - assigned : r2((c.cap / pool) * target);
    const value = r2(Math.min(c.cap, Math.max(0, raw)));
    result[c.key] = value;
    assigned = r2(assigned + value);
  });

  // Дорозподіл залишку через округлення
  let rest = r2(target - Object.values(result).reduce((s, v) => s + v, 0));
  if (rest > 0) {
    for (const c of caps) {
      if (rest <= 0) break;
      const room = r2(c.cap - result[c.key]);
      if (room <= 0) continue;
      const add = Math.min(room, rest);
      result[c.key] = r2(result[c.key] + add);
      rest = r2(rest - add);
    }
  }
  return result;
}

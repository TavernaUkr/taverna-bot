/** Комісія платформи за вивід коштів (окремо від комісії платіжного методу). */
export const PLATFORM_PAYOUT_FEE_PERCENT = 1.5;
export const PLATFORM_PAYOUT_FEE_MIN = 5;

export interface PayoutLimitLike {
  fee_percent?: number | string | null;
  fee_fixed?: number | string | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Розрахунок комісій виводу: платформа + платіжний метод. */
export function calcPayoutFees(amount: number, limit?: PayoutLimitLike | null) {
  const value = Number(amount) || 0;
  const platformFee = value > 0 ? r2(Math.max(PLATFORM_PAYOUT_FEE_MIN, value * PLATFORM_PAYOUT_FEE_PERCENT / 100)) : 0;
  const providerFee = value > 0 && limit
    ? r2(value * Number(limit.fee_percent || 0) / 100 + Number(limit.fee_fixed || 0))
    : 0;
  const totalFee = r2(platformFee + providerFee);
  return { platformFee, providerFee, totalFee, net: r2(Math.max(0, value - totalFee)) };
}

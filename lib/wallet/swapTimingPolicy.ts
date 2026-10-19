export const MIN_DEPOSIT_WINDOW_SECONDS = 60 * 60;
export const MIN_CLAIM_WINDOW_SECONDS = 60 * 60;

export function assertSwapFundingTime(
  terms: { t0: number; t1: number },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  if (![terms.t0, terms.t1, nowSeconds].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Swap deadlines and current time must be valid Unix seconds.');
  }
  if (terms.t0 - nowSeconds < MIN_DEPOSIT_WINDOW_SECONDS) {
    throw new Error('At least 60 minutes must remain before the XMR deposit deadline. Ask for a new invitation.');
  }
  if (terms.t1 - terms.t0 < MIN_CLAIM_WINDOW_SECONDS) {
    throw new Error('The ALGO claim window must be at least 60 minutes after the deposit deadline. Ask for a new invitation.');
  }
}
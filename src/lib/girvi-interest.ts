/** Reducing-principal simple interest, using 30-day months and integer paise. */
export function girviInterestPaise(
  principalPaise: number,
  monthlyRateBp: number,
  issuedAt: number,
  at: number,
  receipts: Array<{ principalPaise: number; createdAt: number }>,
): number {
  let balance = principalPaise;
  let cursor = issuedAt;
  let accrued = 0;
  for (const receipt of [...receipts].sort(
    (a, b) => a.createdAt - b.createdAt,
  )) {
    if (receipt.createdAt < issuedAt || receipt.createdAt > at) continue;
    accrued +=
      (((balance * monthlyRateBp) / 10000) * (receipt.createdAt - cursor)) /
      (30 * 86400000);
    balance = Math.max(0, balance - receipt.principalPaise);
    cursor = receipt.createdAt;
  }
  accrued +=
    (((balance * monthlyRateBp) / 10000) * Math.max(0, at - cursor)) /
    (30 * 86400000);
  return Math.round(accrued);
}

/** Money is always stored/transmitted as an integer number of paise — never a float. */

export function rupeesToPaise(rupees: string | number): number | null {
  const value = typeof rupees === "number" ? rupees : Number(rupees);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function paiseToRupeesInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

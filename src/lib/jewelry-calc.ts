/**
 * Jewellery weight/value calculations. All inputs/outputs are integers —
 * weight in milligrams, money in paise, rates in basis points — so there is
 * never a floating-point rounding error in a financial figure. The only
 * division (converting mg * paise/gram down to paise) happens once, at the
 * end of each function, with a single explicit round.
 */

export function gramsToMg(grams: string | number): number {
  const value = typeof grams === "number" ? grams : Number(grams);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1000);
}

export function mgToGramsDisplay(mg: number): string {
  return (mg / 1000).toFixed(3);
}

export function netWeightMg(grossWeightMg: number, stoneWeightMg: number, otherDeductionMg = 0): number {
  return Math.max(0, grossWeightMg - stoneWeightMg - otherDeductionMg);
}

/** netWeightMg * ratePerGramPaise, converted from mg to grams (divide by 1000) with one rounding step. */
export function metalValuePaise(netWeightMg: number, ratePerGramPaise: number): number {
  return Math.round((netWeightMg * ratePerGramPaise) / 1000);
}

export function basisPointsOf(amountPaise: number, basisPoints: number): number {
  return Math.round((amountPaise * basisPoints) / 10000);
}

export type PurchaseLineInput = {
  grossWeightMg: number;
  stoneWeightMg: number;
  ratePerGramPaise: number;
  makingChargePaise: number;
  stoneChargePaise: number;
};

export type PurchaseLineResult = PurchaseLineInput & {
  netWeightMg: number;
  metalValuePaise: number;
  lineTotalPaise: number;
};

export function computePurchaseLine(input: PurchaseLineInput): PurchaseLineResult {
  const net = netWeightMg(input.grossWeightMg, input.stoneWeightMg);
  const metalValue = metalValuePaise(net, input.ratePerGramPaise);
  return {
    ...input,
    netWeightMg: net,
    metalValuePaise: metalValue,
    lineTotalPaise: metalValue + input.makingChargePaise + input.stoneChargePaise,
  };
}

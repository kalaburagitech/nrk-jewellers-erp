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
  /** Per-line discount (Vyapar line "Discount"), taken off the line value. */
  lineDiscountPaise?: number;
  /** Fixed purchase price per piece (item master). When > 0 it replaces net weight × rate. */
  unitPricePaise?: number;
  pieces?: number;
};

export type PurchaseLineResult = PurchaseLineInput & {
  netWeightMg: number;
  metalValuePaise: number;
  lineTotalPaise: number;
};

export function computePurchaseLine(input: PurchaseLineInput): PurchaseLineResult {
  const net = netWeightMg(input.grossWeightMg, input.stoneWeightMg);
  const metalValue = (input.unitPricePaise ?? 0) > 0
    ? input.unitPricePaise! * (input.pieces ?? 1)
    : metalValuePaise(net, input.ratePerGramPaise);
  return {
    ...input,
    netWeightMg: net,
    metalValuePaise: metalValue,
    lineTotalPaise: Math.max(0, metalValue + input.makingChargePaise + input.stoneChargePaise - (input.lineDiscountPaise ?? 0)),
  };
}

/**
 * Sale line rule (documented assumption — confirm with the client's CA before
 * GST filing): wastage% is charged as an extra percentage of the metal
 * value (the traditional "extra weight for melting loss" charge, expressed
 * in money rather than grams so it works for both making-charge styles).
 * GST, when the bill is GST, is charged on (metal value + wastage + making +
 * stone charge) — i.e. on the full taxable value of the line, matching how
 * jewellery HSN codes are typically taxed as a single line value.
 */
export type SaleLineInput = {
  grossWeightMg: number;
  stoneWeightMg: number;
  /** Current physical net weight recorded in stock. Overrides gross-minus-stone when available. */
  stockNetWeightMg?: number;
  otherDeductionMg: number;
  ratePerGramPaise: number;
  wastageBasisPoints: number;
  makingChargePaise: number;
  stoneChargePaise: number;
  gstBasisPoints: number; // 0 for a non-GST bill
  /** Per-line discount, taken off before GST (Vyapar: line discount first, then tax). */
  lineDiscountPaise?: number;
  /**
   * Fixed selling price per piece (item master). When > 0 the line is priced
   * unitPrice × pieces instead of net weight × rate, and no wastage applies;
   * making/stone charges and the line discount still do.
   */
  unitPricePaise?: number;
  pieces?: number;
};

export type SaleLineResult = SaleLineInput & {
  netWeightMg: number;
  metalValuePaise: number;
  wastageValuePaise: number;
  taxableValuePaise: number;
  lineTaxPaise: number;
  lineTotalPaise: number;
};

export function computeSaleLine(input: SaleLineInput): SaleLineResult {
  const availableNetMg = input.stockNetWeightMg ?? netWeightMg(input.grossWeightMg, input.stoneWeightMg);
  const net = Math.max(0, availableNetMg - input.otherDeductionMg);
  const fixedPrice = (input.unitPricePaise ?? 0) > 0;
  const metalValue = fixedPrice ? input.unitPricePaise! * (input.pieces ?? 1) : metalValuePaise(net, input.ratePerGramPaise);
  const wastageValue = fixedPrice ? 0 : basisPointsOf(metalValue, input.wastageBasisPoints);
  const taxableValue = Math.max(0, metalValue + wastageValue + input.makingChargePaise + input.stoneChargePaise - (input.lineDiscountPaise ?? 0));
  const tax = basisPointsOf(taxableValue, input.gstBasisPoints);
  return {
    ...input,
    netWeightMg: net,
    metalValuePaise: metalValue,
    wastageValuePaise: wastageValue,
    taxableValuePaise: taxableValue,
    lineTaxPaise: tax,
    lineTotalPaise: taxableValue + tax,
  };
}

/** Rounds a total to the nearest rupee, returning the signed adjustment applied (e.g. -40 paise, +60 paise). */
export function roundOffToRupee(totalPaise: number): { roundedTotalPaise: number; roundOffPaise: number } {
  const roundedTotalPaise = Math.round(totalPaise / 100) * 100;
  return { roundedTotalPaise, roundOffPaise: roundedTotalPaise - totalPaise };
}

/**
 * Old gold a customer trades in against a new bill (SRS §8). The melting
 * deduction is a weight loss percentage (impurity/melting loss assessed by
 * the shop), not a money charge — it reduces the gross weight before
 * valuing it at the agreed rate.
 */
export type OldGoldExchangeInput = {
  grossWeightMg: number;
  meltingDeductionBasisPoints: number;
  ratePerGramPaise: number;
};

export type OldGoldExchangeResult = OldGoldExchangeInput & {
  netWeightMg: number;
  exchangeValuePaise: number;
};

export function computeOldGoldExchange(input: OldGoldExchangeInput): OldGoldExchangeResult {
  const meltingLossMg = basisPointsOf(input.grossWeightMg, input.meltingDeductionBasisPoints);
  const net = Math.max(0, input.grossWeightMg - meltingLossMg);
  return {
    ...input,
    netWeightMg: net,
    exchangeValuePaise: metalValuePaise(net, input.ratePerGramPaise),
  };
}

/** Standard gold karats offered in the item form, with fineness in basis points. */
export const KARAT_FINENESS_BP = {
  "24K": 9990, "22K": 9160, "20K": 8330, "18K": 7500, "14K": 5850, "12K": 5000, "10K": 4170, "9K": 3750,
} as const;
export type PurityKarat = keyof typeof KARAT_FINENESS_BP;
export const PURITY_KARATS = Object.keys(KARAT_FINENESS_BP) as PurityKarat[];

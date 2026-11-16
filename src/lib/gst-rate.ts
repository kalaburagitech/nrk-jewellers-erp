/**
 * A tax rate stores CGST + SGST (intra-state) and IGST (inter-state) side by
 * side — e.g. jewellery: 1.5% + 1.5%, or 3% IGST. A bill charges ONE of the
 * two, never the sum: IGST when the buyer's state differs from the shop's
 * state, otherwise CGST + SGST. Unknown states count as intra-state (the
 * usual counter sale).
 */
export type TaxRates = { cgstBasisPoints: number; sgstBasisPoints: number; igstBasisPoints: number };

export function isInterState(partyState?: string | null, shopState?: string | null): boolean {
  const a = partyState?.trim().toLowerCase();
  const b = shopState?.trim().toLowerCase();
  return !!a && !!b && a !== b;
}

export function gstRateBp(rates: TaxRates, interState: boolean): number {
  const intra = rates.cgstBasisPoints + rates.sgstBasisPoints;
  return interState ? rates.igstBasisPoints || intra : intra || rates.igstBasisPoints;
}

/** Splits a line's tax into IGST or CGST/SGST using the same rule. */
export function splitTax(taxPaise: number, rates: TaxRates, interState: boolean) {
  const useIgst = interState ? rates.igstBasisPoints > 0 || rates.cgstBasisPoints + rates.sgstBasisPoints === 0 : rates.cgstBasisPoints + rates.sgstBasisPoints === 0;
  if (useIgst) return { igstPaise: taxPaise, cgstPaise: 0, sgstPaise: 0 };
  const intra = rates.cgstBasisPoints + rates.sgstBasisPoints;
  const cgstPaise = intra ? Math.round((taxPaise * rates.cgstBasisPoints) / intra) : 0;
  return { igstPaise: 0, cgstPaise, sgstPaise: taxPaise - cgstPaise };
}

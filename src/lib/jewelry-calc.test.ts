import { describe, expect, it } from "vitest";
import { basisPointsOf, computePurchaseLine, metalValuePaise, netWeightMg } from "./jewelry-calc";

describe("netWeightMg", () => {
  it("subtracts stone weight and other deductions", () => {
    expect(netWeightMg(10000, 500, 200)).toBe(9300);
  });

  it("never goes negative", () => {
    expect(netWeightMg(100, 500)).toBe(0);
  });
});

describe("metalValuePaise", () => {
  it("converts milligrams at a per-gram rate with one rounding step", () => {
    // 10g @ ₹6850/g = ₹68,500.00 = 6850000 paise
    expect(metalValuePaise(10000, 685000)).toBe(6850000);
  });

  it("rounds fractional paise to the nearest integer", () => {
    // 1.333g @ ₹100.00/g = ₹133.30 -> 13330 paise, exact
    expect(metalValuePaise(1333, 10000)).toBe(13330);
  });
});

describe("basisPointsOf", () => {
  it("computes a percentage expressed in basis points", () => {
    expect(basisPointsOf(100000, 300)).toBe(3000); // 3% of ₹1000.00
  });
});

describe("computePurchaseLine", () => {
  it("combines metal value, making charge and stone charge", () => {
    const result = computePurchaseLine({
      grossWeightMg: 20000,
      stoneWeightMg: 1000,
      ratePerGramPaise: 685000,
      makingChargePaise: 50000,
      stoneChargePaise: 10000,
    });
    expect(result.netWeightMg).toBe(19000);
    expect(result.metalValuePaise).toBe(13015000);
    expect(result.lineTotalPaise).toBe(13075000);
  });
});

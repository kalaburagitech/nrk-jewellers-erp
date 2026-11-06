import { describe, expect, it } from "vitest";
import {
  basisPointsOf,
  computePurchaseLine,
  computeSaleLine,
  metalValuePaise,
  netWeightMg,
  roundOffToRupee,
} from "./jewelry-calc";

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

describe("computeSaleLine", () => {
  it("applies wastage on metal value, then GST on the full taxable value", () => {
    // 10g net @ ₹6850/g = ₹68,500.00 metal value
    // 8% wastage = ₹5,480.00 wastage value
    // + ₹2,000 making + ₹500 stone charge = ₹76,480.00 taxable value
    // 3% GST = ₹2,294.40 -> rounds to 229440 paise... compute exactly below
    const result = computeSaleLine({
      grossWeightMg: 10500,
      stoneWeightMg: 500,
      otherDeductionMg: 0,
      ratePerGramPaise: 685000,
      wastageBasisPoints: 800,
      makingChargePaise: 200000,
      stoneChargePaise: 50000,
      gstBasisPoints: 300,
    });
    expect(result.netWeightMg).toBe(10000);
    expect(result.metalValuePaise).toBe(6850000);
    expect(result.wastageValuePaise).toBe(548000);
    expect(result.taxableValuePaise).toBe(7648000);
    expect(result.lineTaxPaise).toBe(229440);
    expect(result.lineTotalPaise).toBe(7877440);
  });

  it("charges zero tax on a non-GST bill", () => {
    const result = computeSaleLine({
      grossWeightMg: 10000,
      stoneWeightMg: 0,
      otherDeductionMg: 0,
      ratePerGramPaise: 100000,
      wastageBasisPoints: 0,
      makingChargePaise: 0,
      stoneChargePaise: 0,
      gstBasisPoints: 0,
    });
    expect(result.lineTaxPaise).toBe(0);
    expect(result.lineTotalPaise).toBe(result.taxableValuePaise);
  });
});

describe("roundOffToRupee", () => {
  it("rounds down when under 50 paise", () => {
    expect(roundOffToRupee(100349)).toEqual({ roundedTotalPaise: 100300, roundOffPaise: -49 });
  });

  it("rounds up when 50 paise or more", () => {
    expect(roundOffToRupee(100350)).toEqual({ roundedTotalPaise: 100400, roundOffPaise: 50 });
  });

  it("leaves an exact rupee amount unchanged", () => {
    expect(roundOffToRupee(500000)).toEqual({ roundedTotalPaise: 500000, roundOffPaise: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { gstRateBp, isInterState, splitTax } from "./gst-rate";

const jewellery = { cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 300 };

describe("gst rate", () => {
  it("charges 3% (not 6%) on a jewellery rate that stores both CGST+SGST and IGST", () => {
    expect(gstRateBp(jewellery, false)).toBe(300);
    expect(gstRateBp(jewellery, true)).toBe(300);
  });
  it("splits by place of supply", () => {
    expect(splitTax(3000, jewellery, false)).toEqual({ igstPaise: 0, cgstPaise: 1500, sgstPaise: 1500 });
    expect(splitTax(3000, jewellery, true)).toEqual({ igstPaise: 3000, cgstPaise: 0, sgstPaise: 0 });
  });
  it("treats unknown states as intra-state", () => {
    expect(isInterState(undefined, "Karnataka")).toBe(false);
    expect(isInterState("Goa", "Karnataka")).toBe(true);
    expect(isInterState(" karnataka", "Karnataka")).toBe(false);
  });
});

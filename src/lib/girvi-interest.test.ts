import { expect, it } from "vitest";
import { girviInterestPaise } from "./girvi-interest";
const month = 30 * 86400000;
it("calculates simple monthly interest in paise", () => {
  expect(girviInterestPaise(100000, 150, 0, month, [])).toBe(1500);
});
it("reduces the interest base after principal repayments", () => {
  expect(
    girviInterestPaise(100000, 150, 0, 2 * month, [
      { principalPaise: 50000, createdAt: month },
    ]),
  ).toBe(2250);
});
it("stops accrual once principal is repaid and ignores future receipts", () => {
  expect(
    girviInterestPaise(100000, 150, 0, 3 * month, [
      { principalPaise: 100000, createdAt: month },
      { principalPaise: 100000, createdAt: 4 * month },
    ]),
  ).toBe(1500);
});
it("does not accrue before issue date", () => {
  expect(girviInterestPaise(100000, 150, month, 0, [])).toBe(0);
});

import { describe, expect, it } from "vitest";
import { amountInWordsFromPaise, numberToIndianWords } from "./amount-in-words";

describe("numberToIndianWords", () => {
  it("handles zero", () => {
    expect(numberToIndianWords(0)).toBe("Zero");
  });

  it("handles numbers under a hundred", () => {
    expect(numberToIndianWords(42)).toBe("Forty Two");
    expect(numberToIndianWords(7)).toBe("Seven");
    expect(numberToIndianWords(19)).toBe("Nineteen");
  });

  it("handles hundreds", () => {
    expect(numberToIndianWords(305)).toBe("Three Hundred Five");
  });

  it("handles thousands", () => {
    expect(numberToIndianWords(12345)).toBe("Twelve Thousand Three Hundred Forty Five");
  });

  it("handles lakhs", () => {
    expect(numberToIndianWords(154459)).toBe("One Lakh Fifty Four Thousand Four Hundred Fifty Nine");
  });

  it("handles crores", () => {
    expect(numberToIndianWords(20000000)).toBe("Two Crore");
  });
});

describe("amountInWordsFromPaise", () => {
  it("formats a whole-rupee amount", () => {
    expect(amountInWordsFromPaise(154459 * 100)).toBe("Rupees One Lakh Fifty Four Thousand Four Hundred Fifty Nine Only");
  });

  it("includes paise when present", () => {
    expect(amountInWordsFromPaise(10050)).toBe("Rupees One Hundred and Fifty Paise Only");
  });

  it("formats zero", () => {
    expect(amountInWordsFromPaise(0)).toBe("Rupees Zero Only");
  });
});

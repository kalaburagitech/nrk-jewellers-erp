const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return twoDigitsToWords(rest);
  const hundredsPart = `${ONES[hundreds]} Hundred`;
  return rest ? `${hundredsPart} ${twoDigitsToWords(rest)}` : hundredsPart;
}

/** Converts a non-negative integer to words using the Indian numbering system (lakh, crore). */
export function numberToIndianWords(value: number): string {
  if (value === 0) return "Zero";
  const n = Math.floor(Math.abs(value));

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitsToWords(hundred));

  return parts.join(" ");
}

/** "Rupees Twelve Thousand Three Hundred and Forty Only" style string for an amount in paise. */
export function amountInWordsFromPaise(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const remainderPaise = Math.abs(paise) % 100;

  const rupeesWords = numberToIndianWords(rupees);
  const paiseWords = remainderPaise > 0 ? ` and ${numberToIndianWords(remainderPaise)} Paise` : "";

  return `Rupees ${rupeesWords}${paiseWords} Only`;
}

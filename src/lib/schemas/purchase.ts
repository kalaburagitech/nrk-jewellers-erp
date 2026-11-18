import { z } from "zod";

const positiveNumberString = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, message);

const nonNegativeNumberString = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), message)
    .optional();

export const purchaseLineFormSchema = z
  .object({
    productId: z.string().optional(),
    manualProductName: z.string().optional(),
    boxId: z.string().optional(),
    manualBoxNumber: z.string().optional(),
    // GST company: the line goes into item-wise stock, so no box is needed.
    toItemStock: z.boolean().optional(),
    label: z.string().trim().min(1, "Item label is required"),
    metalPurityId: z.string().optional(),
    // Pieces received, added to the box's piece count.
    piecesText: z.string().trim().refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0), "Pieces must be a whole number").optional(),
    grossWeightGrams: positiveNumberString("Gross weight is required"),
    stoneWeightGrams: nonNegativeNumberString("Invalid stone weight"),
    // Either a rate per gram or a fixed purchase price per piece.
    ratePerGramRupees: nonNegativeNumberString("Invalid rate per gram"),
    unitPriceRupees: nonNegativeNumberString("Invalid purchase price"),
    makingChargeRupees: nonNegativeNumberString("Invalid making charge"),
    stoneChargeRupees: nonNegativeNumberString("Invalid stone charge"),
    discountRupees: nonNegativeNumberString("Invalid discount").optional(),
  })
  .refine((data) => Number(data.ratePerGramRupees || "0") > 0 || Number(data.unitPriceRupees || "0") > 0, {
    message: "Enter the rate per gram or the purchase price per piece",
    path: ["ratePerGramRupees"],
  })
  .refine((data) => Boolean(data.productId || data.manualProductName?.trim()), {
    message: "Select or type a product name",
    path: ["productId"],
  })
  .refine((data) => Boolean(data.toItemStock || data.boxId || data.manualBoxNumber?.trim()), {
    message: "Select or enter a destination box",
    path: ["boxId"],
  });

export type PurchaseLineFormValues = z.infer<typeof purchaseLineFormSchema>;

export const purchaseFormSchema = z
  .object({
    supplierId: z.string().optional(),
    manualSupplierName: z.string().optional(),
    manualSupplierPhone: z.string().optional(),
    billDate: z.string().min(1, "Select a bill date"),
    gstPercent: nonNegativeNumberString("Invalid GST percentage"),
    amountPaidRupees: nonNegativeNumberString("Invalid amount"),
    paymentMode: z.enum(["cash", "upi", "card", "cheque", "bank_transfer"]).optional(),
    items: z.array(purchaseLineFormSchema).min(1, "Add at least one item"),
  })
  .refine((data) => Boolean(data.supplierId || data.manualSupplierName?.trim()), {
    message: "Select or enter a supplier",
    path: ["supplierId"],
  });

export type PurchaseFormValues = z.infer<typeof purchaseFormSchema>;

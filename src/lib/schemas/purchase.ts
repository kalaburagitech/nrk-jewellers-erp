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

export const purchaseLineFormSchema = z.object({
  productId: z.string().min(1, "Select a product"),
  boxId: z.string().min(1, "Select a destination box"),
  label: z.string().trim().min(1, "Item label is required"),
  metalPurityId: z.string().optional(),
  grossWeightGrams: positiveNumberString("Gross weight is required"),
  stoneWeightGrams: nonNegativeNumberString("Invalid stone weight"),
  ratePerGramRupees: positiveNumberString("Rate per gram is required"),
  makingChargeRupees: nonNegativeNumberString("Invalid making charge"),
  stoneChargeRupees: nonNegativeNumberString("Invalid stone charge"),
});

export type PurchaseLineFormValues = z.infer<typeof purchaseLineFormSchema>;

export const purchaseFormSchema = z.object({
  supplierId: z.string().min(1, "Select a supplier"),
  billDate: z.string().min(1, "Select a bill date"),
  gstPercent: nonNegativeNumberString("Invalid GST percentage"),
  amountPaidRupees: nonNegativeNumberString("Invalid amount"),
  paymentMode: z.enum(["cash", "upi", "card", "cheque", "bank_transfer"]).optional(),
  items: z.array(purchaseLineFormSchema).min(1, "Add at least one item"),
});

export type PurchaseFormValues = z.infer<typeof purchaseFormSchema>;

import { z } from "zod";

export const GST_TYPE_OPTIONS = [
  { value: "unregistered_consumer", label: "Unregistered/Consumer" },
  { value: "regular", label: "Registered Business - Regular" },
  { value: "composition", label: "Registered Business - Composition" },
  { value: "sez", label: "SEZ" },
  { value: "overseas", label: "Overseas" },
  { value: "deemed_export", label: "Deemed Export" },
  { value: "tax_deductor", label: "Tax Deductor" },
  { value: "tax_collector_ecommerce", label: "Tax Collector (E-Commerce)" },
  { value: "uin_holder", label: "Consulate/UN Body (UIN Holder)" },
] as const;

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  gstin: z.string().trim().optional().or(z.literal("")),
  gstType: z.string().trim().optional().or(z.literal("")),
  state: z.string().trim().optional().or(z.literal("")),
  customerType: z.enum(["cash", "regular", "credit"]),
  creditLimitRupees: z.string().trim().optional().or(z.literal("")),
  dueDate: z.string().trim().optional().or(z.literal("")),
  openingBalanceRupees: z.string().trim().optional().or(z.literal("")),
  openingBalanceDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const supplierFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  gstin: z.string().trim().optional().or(z.literal("")),
  gstType: z.string().trim().optional().or(z.literal("")),
  state: z.string().trim().optional().or(z.literal("")),
  creditLimitRupees: z.string().trim().optional().or(z.literal("")),
  openingBalanceRupees: z.string().trim().optional().or(z.literal("")),
  openingBalanceDate: z.string().trim().optional().or(z.literal("")),
});

export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

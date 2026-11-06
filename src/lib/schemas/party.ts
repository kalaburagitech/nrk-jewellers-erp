import { z } from "zod";

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  gstin: z.string().trim().optional().or(z.literal("")),
  customerType: z.enum(["cash", "regular", "credit"]),
  creditLimitRupees: z.string().trim().optional().or(z.literal("")),
  dueDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const supplierFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  gstin: z.string().trim().optional().or(z.literal("")),
});

export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

"use client";

import { EstimateListPage } from "@/components/estimate-list-page";

export default function ProformaInvoicesPage() {
  return (
    <EstimateListPage
      documentType="proforma_invoice"
      heading="Proforma Invoices"
      description="A formal pre-sale estimate shared before payment — still non-binding, nothing is added to stock or the customer's account."
      triggerLabel="New Proforma Invoice"
      dialogTitle="Create a proforma invoice"
    />
  );
}

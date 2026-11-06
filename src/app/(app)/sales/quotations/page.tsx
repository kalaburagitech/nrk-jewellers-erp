"use client";

import { EstimateListPage } from "@/components/estimate-list-page";

export default function QuotationsPage() {
  return (
    <EstimateListPage
      documentType="quotation"
      heading="Quotations"
      description="Non-binding price estimates for a customer — no stock is reserved and nothing is added to their account."
      triggerLabel="New Quotation"
      dialogTitle="Create a quotation"
    />
  );
}

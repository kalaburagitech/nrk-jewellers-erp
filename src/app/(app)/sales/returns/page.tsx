"use client";

import { SalesReturnListPage } from "@/components/sales-return-list-page";

export default function SalesReturnsPage() {
  return (
    <SalesReturnListPage
      documentType="sales_return"
      heading="Sales Returns"
      description="Returned items go back into their box and the customer's outstanding balance is reduced."
      triggerLabel="New Sales Return"
      dialogTitle="Record a sales return"
    />
  );
}

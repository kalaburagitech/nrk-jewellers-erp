"use client";

import { SalesReturnListPage } from "@/components/sales-return-list-page";

export default function CreditNotesPage() {
  return (
    <SalesReturnListPage
      documentType="credit_note"
      heading="Credit Notes"
      description="A formal credit issued against a customer's account for returned goods."
      triggerLabel="New Credit Note"
      dialogTitle="Issue a credit note"
    />
  );
}

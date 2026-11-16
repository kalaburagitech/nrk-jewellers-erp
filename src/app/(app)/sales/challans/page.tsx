"use client";

import { EstimateListPage } from "@/components/estimate-list-page";

export default function DeliveryChallansPage() {
  return (
    <EstimateListPage
      documentType="delivery_challan"
      heading="Delivery Challans"
      description="Goods sent to a customer on approval or for delivery. Stock and the customer's account change only when you raise the sale invoice."
      triggerLabel="New Delivery Challan"
      dialogTitle="Create a delivery challan"
    />
  );
}

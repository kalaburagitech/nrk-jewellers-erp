"use client";

import { EstimateListPage } from "@/components/estimate-list-page";

export default function SalesOrdersPage() {
  return (
    <EstimateListPage
      documentType="sales_order"
      heading="Sale Orders"
      description="Orders booked by a customer (e.g. custom jewellery). No stock leaves a box and nothing is added to their account until you bill it."
      triggerLabel="New Sale Order"
      dialogTitle="Create a sale order"
    />
  );
}

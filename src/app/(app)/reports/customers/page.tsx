import { ComingSoon } from "@/components/coming-soon";
import { BarChart3 } from "lucide-react";

export default function CustomerReportsPage() {
  return (
    <ComingSoon
      icon={BarChart3}
      title="Customer Reports"
      milestone="Aging analysis arriving in a later milestone — see Customers > Outstanding Balances for current totals"
    />
  );
}

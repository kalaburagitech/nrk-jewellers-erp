import { ComingSoon } from "@/components/coming-soon";
import { BarChart3 } from "lucide-react";

export default function ProfitabilityReportsPage() {
  return (
    <ComingSoon
      icon={BarChart3}
      title="Profitability Reports"
      milestone="Requires indirect expense tracking not yet built — avoiding a misleading profit figure until that data exists"
    />
  );
}

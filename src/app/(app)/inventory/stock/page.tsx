import { ComingSoon } from "@/components/coming-soon";
import { Boxes } from "lucide-react";

export default function StockOverviewPage() {
  return (
    <ComingSoon
      icon={Boxes}
      title="Stock Overview"
      milestone="Arrives once purchases start recording real weight movements (Milestone 3)"
    />
  );
}

import { ComingSoon } from "@/components/coming-soon";
import { PackageSearch } from "lucide-react";

export default function BoxInventoryPage() {
  return (
    <ComingSoon
      icon={PackageSearch}
      title="Box Inventory"
      milestone="Arrives once purchases start placing items into boxes (Milestone 3)"
    />
  );
}

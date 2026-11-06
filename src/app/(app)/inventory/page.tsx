import { ComingSoon } from "@/components/coming-soon";
import { Boxes } from "lucide-react";

export default function InventoryIndexPage() {
  return (
    <ComingSoon
      icon={Boxes}
      title="Inventory"
      milestone="Stock overview arrives once purchases start recording real weight movements (Milestone 3)"
    />
  );
}

import { ComingSoon } from "@/components/coming-soon";
import { PackageSearch } from "lucide-react";

export default function BarcodeLabelsPage() {
  return (
    <ComingSoon
      icon={PackageSearch}
      title="Barcode Labels"
      milestone="Printable NRK-branded barcode labels arrive with box inventory (Milestone 3)"
    />
  );
}

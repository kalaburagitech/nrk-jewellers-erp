"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPaise } from "@/lib/money";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const TRANSPORT_MODES = [
  { value: "road", label: "Road" },
  { value: "rail", label: "Rail" },
  { value: "air", label: "Air" },
  { value: "ship", label: "Ship" },
] as const;

type TransportMode = (typeof TRANSPORT_MODES)[number]["value"];

export default function EwayBillPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = use(params);
  const data = useQuery(api.ewayBills.getDocumentData, { saleId: saleId as Id<"sales"> });
  const upsert = useMutation(api.ewayBills.upsert);

  const [transportMode, setTransportMode] = useState<TransportMode>("road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [transporterGstin, setTransporterGstin] = useState("");
  const [approxDistanceKm, setApproxDistanceKm] = useState("");
  const [ewayBillNumber, setEwayBillNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!data?.ewayBill || loaded) return;
    const eb = data.ewayBill;
    setTransportMode(eb.transportMode);
    setVehicleNumber(eb.vehicleNumber ?? "");
    setTransporterName(eb.transporterName ?? "");
    setTransporterGstin(eb.transporterGstin ?? "");
    setApproxDistanceKm(eb.approxDistanceKm ? String(eb.approxDistanceKm) : "");
    setEwayBillNumber(eb.ewayBillNumber ?? "");
    setLoaded(true);
  }, [data, loaded]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (data === undefined) {
    return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  }

  const { sale, customer, organization, hsnSummary } = data;

  async function handleSave() {
    setSaving(true);
    try {
      await upsert({
        saleId: saleId as Id<"sales">,
        transportMode,
        vehicleNumber: vehicleNumber || undefined,
        transporterName: transporterName || undefined,
        transporterGstin: transporterGstin || undefined,
        approxDistanceKm: approxDistanceKm ? Number(approxDistanceKm) : undefined,
        ewayBillNumber: ewayBillNumber || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/40 py-8 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      <div className="mx-auto flex max-w-[210mm] flex-col gap-4 px-4 pb-4 print:hidden">
        <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label>Transport mode</Label>
            <Select value={transportMode} onValueChange={(v) => setTransportMode(v as TransportMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Vehicle number</Label>
            <Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="KA32AB1234" />
          </div>
          <div className="grid gap-2">
            <Label>Approx. distance (km)</Label>
            <Input inputMode="numeric" value={approxDistanceKm} onChange={(e) => setApproxDistanceKm(e.target.value)} placeholder="0" />
          </div>
          <div className="grid gap-2">
            <Label>Transporter name</Label>
            <Input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} placeholder="optional" />
          </div>
          <div className="grid gap-2">
            <Label>Transporter GSTIN</Label>
            <Input value={transporterGstin} onChange={(e) => setTransporterGstin(e.target.value)} placeholder="optional" />
          </div>
          <div className="grid gap-2">
            <Label>E-Way Bill No. (after generating on the govt. portal)</Label>
            <Input value={ewayBillNumber} onChange={(e) => setEwayBillNumber(e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      <div className="mx-auto flex max-w-[210mm] flex-col gap-3 bg-white p-6 text-sm text-gray-900 shadow-sm print:shadow-none">
        <div className="text-center">
          <h1 className="text-xl font-bold">E-Way Bill — Part A (Reference Document)</h1>
          <p className="text-xs text-gray-500">
            Not a government-issued e-way bill. Generate the actual EWB at ewaybillgst.gov.in using the details below, then record
            the EWB number on this document.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-3">
          <div>
            <p className="font-semibold">From</p>
            <p>{organization?.name}</p>
            {organization?.gstin && <p className="text-gray-500">GSTIN: {organization.gstin}</p>}
            {organization?.address && <p className="whitespace-pre-line text-gray-500">{organization.address}</p>}
          </div>
          <div>
            <p className="font-semibold">To</p>
            <p>{customer?.name}</p>
            {customer?.gstin && <p className="text-gray-500">GSTIN: {customer.gstin}</p>}
            {customer?.address && <p className="whitespace-pre-line text-gray-500">{customer.address}</p>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-gray-200 pt-3">
          <p>
            <span className="text-gray-500">Invoice No.</span> {sale.invoiceNumber}
          </p>
          <p>
            <span className="text-gray-500">Date</span> {new Date(sale.createdAt).toLocaleDateString("en-IN")}
          </p>
          <p>
            <span className="text-gray-500">Invoice Value</span> {formatPaise(sale.totalPaise)}
          </p>
        </div>

        <table className="w-full border-collapse border-t border-gray-200 pt-3 text-left">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-1">HSN Code</th>
              <th className="py-1 text-right">Taxable Value</th>
              <th className="py-1 text-right">Tax</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {hsnSummary.map((row) => (
              <tr key={row.hsnCode} className="border-b border-gray-200/60">
                <td className="py-1">{row.hsnCode}</td>
                <td className="py-1 text-right">{formatPaise(row.taxableValuePaise)}</td>
                <td className="py-1 text-right">{formatPaise(row.taxPaise)}</td>
                <td className="py-1 text-right">{formatPaise(row.taxableValuePaise + row.taxPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-3">
          <div>
            <p className="font-semibold">Transport Details</p>
            <p className="text-gray-500">Mode: {TRANSPORT_MODES.find((m) => m.value === transportMode)?.label}</p>
            {vehicleNumber && <p className="text-gray-500">Vehicle: {vehicleNumber}</p>}
            {approxDistanceKm && <p className="text-gray-500">Approx. distance: {approxDistanceKm} km</p>}
            {transporterName && <p className="text-gray-500">Transporter: {transporterName}</p>}
            {transporterGstin && <p className="text-gray-500">Transporter GSTIN: {transporterGstin}</p>}
          </div>
          <div>
            <p className="font-semibold">E-Way Bill No.</p>
            <p className="text-gray-500">{ewayBillNumber || "— not yet generated —"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

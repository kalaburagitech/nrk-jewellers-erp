"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Lock,
  LockOpen,
  KeyRound,
  ShieldCheck,
  Building2,
  Receipt,
  Printer,
  FileText,
  MessageSquare,
  Users,
  PackageSearch,
  BellRing,
  Calculator,
  Coins,
  Check,
  ExternalLink,
  RotateCcw,
  Sliders,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { useAppLock } from "@/components/app-lock-gate";

const SETTINGS_NAV = [
  { id: "general", label: "GENERAL", icon: Sliders, href: "/settings/general", active: true },
  { id: "transaction", label: "TRANSACTION", icon: Receipt, href: "/settings/general" },
  { id: "print", label: "PRINT", icon: Printer, href: "/settings/invoice-templates" },
  { id: "gst", label: "TAXES & GST", icon: FileText, href: "/settings/gst" },
  { id: "message", label: "TRANSACTION MESSAGE", icon: MessageSquare, href: "/settings/general" },
  { id: "party", label: "PARTY", icon: Users, href: "/customers" },
  { id: "item", label: "ITEM", icon: PackageSearch, href: "/inventory/products" },
  { id: "reminders", label: "SERVICE REMINDERS", icon: BellRing, href: "/settings/general" },
  { id: "accounting", label: "ACCOUNTING", icon: Calculator, href: "/settings/accounting-years" },
  { id: "currency", label: "MULTI CURRENCY", icon: Coins, href: "/settings/general" },
];

export default function GeneralSettingsPage() {
  const access = useQuery(api.organizations.getMyAccess);
  const appLock = useAppLock();
  const { isLocked, unlock, lock: lockPrivacy } = usePrivacyLock();

  // Dialog state for code 1968
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  // Settings mock toggles matching Vyapar screenshot (Page 24)
  const [enablePasscode, setEnablePasscode] = useState(true);
  const [gstinNumber, setGstinNumber] = useState(true);
  const [stopNegativeStock, setStopNegativeStock] = useState(false);
  const [blockNewItems, setBlockNewItems] = useState(false);
  const [blockNewParties, setBlockNewParties] = useState(false);
  const [multiFirm, setMultiFirm] = useState(true);
  const [estimateQuotation, setEstimateQuotation] = useState(true);
  const [proformaInvoice, setProformaInvoice] = useState(true);
  const [salePurchaseOrder, setSalePurchaseOrder] = useState(true);
  const [deliveryChallan, setDeliveryChallan] = useState(false);
  const [otherIncome, setOtherIncome] = useState(false);
  const [fixedAssets, setFixedAssets] = useState(false);
  const [autoBackup, setAutoBackup] = useState(false);
  const [auditTrail, setAuditTrail] = useState(true);
  const [zoomScale, setZoomScale] = useState(100);

  const orgName = access?.organization?.name || "NR Karakalli Jewellers";

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlock(passcode)) {
      setUnlockDialogOpen(false);
      setPasscode("");
      setPasscodeError(null);
    } else {
      setPasscodeError("Invalid passcode. Enter code 1968.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure application security, transaction preferences, multi-firm, and workspace view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={isLocked ? "outline" : "default"}
            className={
              isLocked
                ? "border-amber-500/40 text-amber-600 bg-amber-500/10 px-3 py-1"
                : "bg-emerald-600 text-white px-3 py-1"
            }
          >
            {isLocked ? "🔒 Privacy Locked" : "🔓 Privacy Unlocked"}
          </Badge>
        </div>
      </div>

      {/* 2-Column Vyapar Style Layout: Left Sidebar + Right Content Pane */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 items-start">
        {/* Left Navigation Bar matching Screenshot Page 24 */}
        <div className="rounded-xl border bg-card/60 p-2 shadow-sm">
          <nav className="flex flex-col gap-1" aria-label="Settings navigation">
            {SETTINGS_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                    item.active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Content Area: GENERAL Settings Screen */}
        <div className="space-y-6">
          {/* 1. Application & Privacy Lock Section */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Application & Security</CardTitle>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                    isLocked ? "bg-amber-500/15 text-amber-600 border border-amber-500/30" : "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                  }`}>
                    {isLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    <span>{isLocked ? "Locked (Hidden)" : "Unlocked (Visible)"}</span>
                  </div>
                </div>
              </div>
              <CardDescription>
                Manage application lock, privacy passcode, currency, and transaction validation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Privacy Lock (Code 1968) Control Box */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className={`p-2.5 rounded-xl shrink-0 ${isLocked ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"}`}>
                    {isLocked ? <Lock className="h-6 w-6" /> : <LockOpen className="h-6 w-6" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm sm:text-base">Privacy Lock (Passcode 1968)</h3>
                      <Badge variant="outline" className="text-[10px] tracking-wider uppercase font-mono">
                        Code: 1968
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {isLocked
                        ? "Currently LOCKED. Girvi / Metal loans and secondary companies (NR Karakalli Jewellers. - Gst Gold) are hidden from the menu, dashboard, and company switchers."
                        : "Currently UNLOCKED. All companies and Girvi records are visible. Tap lock to hide them again instantly."}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {isLocked ? (
                    <Button
                      onClick={() => {
                        setPasscode("");
                        setPasscodeError(null);
                        setUnlockDialogOpen(true);
                      }}
                      className="gap-2 bg-amber-500 hover:bg-amber-600 text-white font-medium"
                    >
                      <Lock className="h-4 w-4" />
                      Unlock with Code 1968
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={lockPrivacy}
                      className="gap-2 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 font-medium"
                    >
                      <LockOpen className="h-4 w-4" />
                      Lock App Now
                    </Button>
                  )}
                </div>
              </div>

              {/* Application Passcode Checkbox & Settings matching Page 24 */}
              <div className="grid gap-4 pt-2">
                <div className="flex items-center justify-between border-b pb-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="enable-passcode"
                      checked={enablePasscode}
                      onCheckedChange={(val) => setEnablePasscode(Boolean(val))}
                    />
                    <Label htmlFor="enable-passcode" className="text-sm font-medium cursor-pointer">
                      Enable App Passcode
                    </Label>
                  </div>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-primary text-xs"
                    onClick={appLock.lock}
                  >
                    Lock Workspace Now
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Business Currency</Label>
                    <div className="flex items-center gap-2 h-10 px-3 rounded-lg border bg-muted/40 font-medium text-sm">
                      <span className="font-bold text-primary">₹</span>
                      <span>INR (Indian Rupee)</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount Decimal Places</Label>
                    <div className="flex items-center gap-2 h-10 px-3 rounded-lg border bg-muted/40 font-medium text-sm">
                      <span>2 (e.g. ₹ 0.00)</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="gstin-number"
                      checked={gstinNumber}
                      onCheckedChange={(val) => setGstinNumber(Boolean(val))}
                    />
                    <Label htmlFor="gstin-number" className="text-sm cursor-pointer">
                      GSTIN Number Enabled
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="stop-neg-stock"
                      checked={stopNegativeStock}
                      onCheckedChange={(val) => setStopNegativeStock(Boolean(val))}
                    />
                    <Label htmlFor="stop-neg-stock" className="text-sm cursor-pointer">
                      Stop Sale on Negative Stock
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="block-new-items"
                      checked={blockNewItems}
                      onCheckedChange={(val) => setBlockNewItems(Boolean(val))}
                    />
                    <Label htmlFor="block-new-items" className="text-sm cursor-pointer">
                      Block New Items from Txn Form
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="block-new-parties"
                      checked={blockNewParties}
                      onCheckedChange={(val) => setBlockNewParties(Boolean(val))}
                    />
                    <Label htmlFor="block-new-parties" className="text-sm cursor-pointer">
                      Block New Parties from Txn Form
                    </Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Multi Firm Section matching Page 24 */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Multi Firm / Multiple Companies</CardTitle>
                <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
                  <Link href="/settings/companies">
                    <span>Manage Companies</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
              <CardDescription>
                Manage separate daily sales and GST books across independent firm workspaces.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="multi-firm"
                  checked={multiFirm}
                  onCheckedChange={(val) => setMultiFirm(Boolean(val))}
                />
                <Label htmlFor="multi-firm" className="text-sm font-medium cursor-pointer">
                  Enable Multi-Firm Support
                </Label>
              </div>

              <div className="rounded-xl border p-4 bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                    NR
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{orgName}</span>
                      <Badge variant="secondary" className="text-[10px]">DEFAULT</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Primary Organization Workspace</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/companies">View All Firms</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 3. More Transactions Section matching Page 24 */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">More Transactions</CardTitle>
              <CardDescription>Enable or disable specific transaction types across the ERP.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="est-quot"
                    checked={estimateQuotation}
                    onCheckedChange={(val) => setEstimateQuotation(Boolean(val))}
                  />
                  <Label htmlFor="est-quot" className="text-sm cursor-pointer">Estimate / Quotation</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="prof-inv"
                    checked={proformaInvoice}
                    onCheckedChange={(val) => setProformaInvoice(Boolean(val))}
                  />
                  <Label htmlFor="prof-inv" className="text-sm cursor-pointer">Proforma Invoice</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sale-po"
                    checked={salePurchaseOrder}
                    onCheckedChange={(val) => setSalePurchaseOrder(Boolean(val))}
                  />
                  <Label htmlFor="sale-po" className="text-sm cursor-pointer">Sale / Purchase Order</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="del-challan"
                    checked={deliveryChallan}
                    onCheckedChange={(val) => setDeliveryChallan(Boolean(val))}
                  />
                  <Label htmlFor="del-challan" className="text-sm cursor-pointer">Delivery Challan</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="other-income"
                    checked={otherIncome}
                    onCheckedChange={(val) => setOtherIncome(Boolean(val))}
                  />
                  <Label htmlFor="other-income" className="text-sm cursor-pointer">Other Income</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="fixed-assets"
                    checked={fixedAssets}
                    onCheckedChange={(val) => setFixedAssets(Boolean(val))}
                  />
                  <Label htmlFor="fixed-assets" className="text-sm cursor-pointer">Fixed Assets (FA)</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 4. Backup & History Section matching Page 24 */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Backup & History</CardTitle>
                <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Link href="/backup">
                    <Database className="h-3.5 w-3.5" />
                    <span>Open Backup Manager</span>
                  </Link>
                </Button>
              </div>
              <CardDescription>Keep encrypted backups of your shop database and review security audit trail.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto-backup"
                    checked={autoBackup}
                    onCheckedChange={(val) => setAutoBackup(Boolean(val))}
                  />
                  <Label htmlFor="auto-backup" className="text-sm cursor-pointer">Automatic Cloud Backup</Label>
                </div>
                <span className="text-xs text-muted-foreground">
                  Last backup: Today at {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="audit-trail"
                  checked={auditTrail}
                  onCheckedChange={(val) => setAuditTrail(Boolean(val))}
                />
                <Label htmlFor="audit-trail" className="text-sm cursor-pointer">Enable Security Audit Trail</Label>
              </div>
            </CardContent>
          </Card>

          {/* 5. Customize Your View matching Page 24 */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Customize Your View</CardTitle>
              <CardDescription>Adjust font size and reading comfort for high-density counter screens.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-2">
                  <span>Zoom / Scale: {zoomScale}%</span>
                  <span>Default: 100%</span>
                </div>
                <input
                  type="range"
                  min="70"
                  max="130"
                  step="5"
                  value={zoomScale}
                  onChange={(e) => setZoomScale(Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                  <span>70%</span>
                  <span>80%</span>
                  <span>90%</span>
                  <span>100%</span>
                  <span>110%</span>
                  <span>120%</span>
                  <span>130%</span>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    document.documentElement.style.fontSize = `${(zoomScale / 100) * 16}px`;
                  }}
                >
                  Apply View Scale
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Unlock Passcode Modal Dialog */}
      <Dialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
        <DialogContent className="w-[92vw] sm:max-w-md rounded-2xl p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Lock className="h-5 w-5 text-amber-500" />
              Unlock Privacy Mode
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUnlockSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="dialog-passcode" className="text-sm font-medium">
                Enter 4-digit privacy passcode
              </Label>
              <Input
                id="dialog-passcode"
                type="password"
                inputMode="numeric"
                autoFocus
                maxLength={4}
                placeholder="••••"
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  setPasscodeError(null);
                }}
                className="text-center text-xl tracking-widest font-mono h-12 rounded-xl"
              />
              {passcodeError && (
                <p className="text-xs text-destructive font-medium">{passcodeError}</p>
              )}
            </div>
            <DialogFooter className="flex-row justify-end gap-2 pt-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-initial"
                onClick={() => setUnlockDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1 sm:flex-initial">
                Unlock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

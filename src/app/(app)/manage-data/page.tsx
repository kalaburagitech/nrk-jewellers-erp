"use client";
import { getUserErrorMessage } from "@/lib/user-error";
import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
const tables = {
  customers: "Customers",
  suppliers: "Suppliers",
  products: "Products",
  boxes: "Stock boxes",
  stockGroups: "Stock groups",
  stockCategories: "Stock categories",
  metalPurities: "Metal purities",
  taxConfigurations: "GST configurations",
  bankAccounts: "Cash & bank accounts",
};
export default function ManageDataPage() {
  const access = useQuery(api.organizations.getMyAccess);
  const allowed = ["owner", "admin"].includes(access?.membership?.role ?? "");
  const archive = useQuery(
    api.dataManagement.archivedTransactions,
    allowed ? {} : "skip",
  );
  const [showDeleted, setShowDeleted] = useState(false);
  const [table, setTable] = useState("boxes");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useQuery(
    api.dataManagement.listRecords,
    allowed && !showDeleted ? { table } : "skip",
  );
  const deleted = useQuery(
    api.dataManagement.deletedRecords,
    allowed && showDeleted ? { table } : "skip",
  );
  const records = showDeleted ? deleted : active;
  const remove = useMutation(api.dataManagement.remove);
  const restoreRecord = useMutation(api.dataManagement.restoreRecord);
  const filtered = records?.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );
  const selection = useRecordSelection(
    filtered?.map((r) => r.id) ?? [],
    `${table}:${showDeleted}:${search}`,
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Manage & delete data</h1>
        <p className="mt-2 text-muted-foreground">
          Soft delete unused records or restore them from the recycle bin. All
          records and audit history remain in the database.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {[
          ["/sales/invoices", "Delete sales bills"],
          ["/purchases/invoices", "Delete purchase bills"],
          ["/purchases/expenses", "Delete expenses"],
          ["/girvi", "Delete Girvi tickets"],
          ["/backup", "Back up data"],
        ].map(([href, label]) => (
          <Button key={href} asChild variant="outline">
            <Link href={href}>{label}</Link>
          </Button>
        ))}
      </div>
      {access && !allowed ? (
        <p>Owner or admin access is required.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Button
              variant={showDeleted ? "default" : "outline"}
              onClick={() => setShowDeleted(!showDeleted)}
            >
              {showDeleted ? "Show active records" : "Recycle bin"}
            </Button>
            <select
              aria-label="Record type"
              className="rounded-md border bg-background p-2"
              value={table}
              onChange={(e) => {
                setTable(e.target.value);
                setMessage("");
              }}
            >
              {Object.entries(tables).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              aria-label="Search records"
              className="rounded-md border p-2"
              placeholder="Search records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <BulkRecordActions
            selection={selection}
            table={table}
            restore={showDeleted}
          />
          {message && (
            <p role="alert" className="text-sm">
              {message}
            </p>
          )}
          <div className="divide-y rounded-xl border bg-card">
            {records === undefined ? (
              <p className="p-5">Loading…</p>
            ) : (
              filtered?.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <Checkbox
                      aria-label={`Select ${record.name}`}
                      checked={selection.has(record.id)}
                      onCheckedChange={() => selection.toggle(record.id)}
                    />
                    <span>{record.name}</span>
                  </label>
                  <Button
                    size="sm"
                    variant={showDeleted ? "outline" : "destructive"}
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `${showDeleted ? "Restore" : "Soft delete"} ${record.name}?`,
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        if (showDeleted)
                          await restoreRecord({ table, id: record.id });
                        else await remove({ table, id: record.id });
                        setMessage(
                          showDeleted
                            ? "Record restored."
                            : "Record soft deleted.",
                        );
                      } catch (e) {
                        setMessage(
                          getUserErrorMessage(e, "Delete failed"),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {showDeleted ? "Restore" : "Delete"}
                  </Button>
                </div>
              ))
            )}
            {filtered?.length === 0 && (
              <p className="p-5 text-muted-foreground">No matching records.</p>
            )}
          </div>
        </>
      )}
      {allowed && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Archived transactions</h2>
          <p className="text-sm text-muted-foreground">
            Deleted bills, expenses and loan tickets remain here. Their
            accounting effects have been reversed. Restore a full backup to
            return to an earlier state.
          </p>
          <div className="divide-y rounded-xl border bg-card">
            {archive?.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap justify-between gap-3 p-4 text-sm"
              >
                <div>
                  <strong>{row.number}</strong>
                  <p className="text-muted-foreground">
                    {row.table} · {row.reason}
                  </p>
                </div>
                <div>
                  {new Date(row.date).toLocaleDateString("en-IN")}
                  {row.table === "sales" && (
                    <Link
                      className="ml-3 text-primary underline"
                      href={`/sales/invoices/${row.id}/print`}
                    >
                      View invoice
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {archive?.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No archived transactions.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

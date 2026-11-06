"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ShieldAlert, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const ROLE_OPTIONS: { value: Doc<"memberships">["role"]; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Administrator" },
  { value: "billing_operator", label: "Billing Operator" },
  { value: "inventory_manager", label: "Inventory Manager" },
  { value: "purchase_manager", label: "Purchase Manager" },
  { value: "accountant", label: "Accountant / Report Viewer" },
];

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

export default function UsersAndRolesPage() {
  const members = useQuery(api.memberships.listMembers);
  const pendingUsers = useQuery(api.memberships.listPendingUsers);
  const addMember = useMutation(api.memberships.addMember);
  const updateMemberRole = useMutation(api.memberships.updateMemberRole);
  const setMemberStatus = useMutation(api.memberships.setMemberStatus);

  const [error, setError] = useState<string | null>(null);

  async function handleAdd(userId: Id<"users">, role: Doc<"memberships">["role"]) {
    setError(null);
    try {
      await addMember({ userId, role });
    } catch {
      setError("Could not add member. You may need Owner/Admin access.");
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users and Roles</h1>
        <p className="text-sm text-muted-foreground">
          Permissions are enforced on the server for every action — roles here aren&apos;t just a
          display label.
        </p>
      </div>

      {pendingUsers && pendingUsers.length > 0 && (
        <Card className="border-gold/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-gold" />
              Awaiting access
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              These accounts signed up but have no role yet — pick a role to grant access.
            </p>
            {pendingUsers.map((u) => (
              <div key={u._id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  {u.email && <p className="text-xs text-muted-foreground">{u.email}</p>}
                </div>
                <Select onValueChange={(role) => handleAdd(u._id, role as Doc<"memberships">["role"])}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Assign a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.filter((r) => r.value !== "owner").map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {members === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No members yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m._id}>
                    <TableCell>
                      <p className="font-medium">{m.name}</p>
                      {m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
                    </TableCell>
                    <TableCell>
                      {m.role === "owner" ? (
                        <Badge>{ROLE_LABEL[m.role]}</Badge>
                      ) : (
                        <Select
                          value={m.role}
                          onValueChange={(role) =>
                            updateMemberRole({ membershipId: m._id, role: role as Doc<"memberships">["role"] })
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.filter((r) => r.value !== "owner").map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {m.role === "owner" ? (
                        <Badge variant="secondary" className="font-normal">
                          Always active
                        </Badge>
                      ) : (
                        <Switch
                          checked={m.status === "active"}
                          onCheckedChange={(checked) =>
                            setMemberStatus({ membershipId: m._id, status: checked ? "active" : "disabled" })
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" />
          {error}
        </p>
      )}

      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          To add a new person: have them sign up at the sign-in page with their own email (not the
          owner account) — they&apos;ll appear above under &quot;Awaiting access&quot; for you to
          assign a role.
        </CardContent>
      </Card>
    </div>
  );
}

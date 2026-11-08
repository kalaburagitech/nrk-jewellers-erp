"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { KeyRound, Plus, ShieldAlert, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

function CreateStaffDialog() {
  const createStaffAccount = useAction(api.memberships.createStaffAccount);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Doc<"memberships">["role"]>("billing_operator");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setPassword("");
    setRole("billing_operator");
    setError(null);
  }

  async function handleCreate() {
    setError(null);
    setSubmitting(true);
    try {
      await createStaffAccount({ email, password, name, role });
      reset();
      setOpen(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not create the login."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Create Staff Login
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a staff login</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Staff name" />
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="staff@example.com" />
          </div>
          <div className="grid gap-2">
            <Label>Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Doc<"memberships">["role"])}>
              <SelectTrigger className="w-full">
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
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? "Creating…" : "Create login"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ membershipId, name }: { membershipId: Id<"memberships">; name: string }) {
  const resetMemberPassword = useAction(api.memberships.resetMemberPassword);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleReset() {
    setError(null);
    setSubmitting(true);
    try {
      await resetMemberPassword({ membershipId, newPassword: password });
      setDone(true);
      setPassword("");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not reset password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setDone(false);
          setPassword("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Reset password">
          <KeyRound className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>New password</Label>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {done && !error && <p className="text-sm text-success">Password updated.</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleReset} disabled={submitting}>
            {submitting ? "Saving…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersAndRolesPage() {
  const members = useQuery(api.memberships.listMembers);
  const pendingUsers = useQuery(api.memberships.listPendingUsers);
  const addMember = useMutation(api.memberships.addMember);
  const updateMemberRole = useMutation(api.memberships.updateMemberRole);
  const setMemberStatus = useMutation(api.memberships.setMemberStatus);
  const removeMember = useMutation(api.memberships.removeMember);

  const [error, setError] = useState<string | null>(null);

  async function handleAdd(userId: Id<"users">, role: Doc<"memberships">["role"]) {
    setError(null);
    try {
      await addMember({ userId, role });
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not add this team member. Check your access and try again."));
    }
  }

  async function handleRemove(membershipId: Id<"memberships">) {
    setError(null);
    try {
      await removeMember({ membershipId });
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not remove member."));
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users and Roles</h1>
          <p className="text-sm text-muted-foreground">
            Permissions are enforced on the server for every action — roles here aren&apos;t just a
            display label.
          </p>
        </div>
        <CreateStaffDialog />
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
              These accounts signed up directly but have no role yet — pick a role to grant access.
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
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                    <TableCell>
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
                    <TableCell className="text-right">
                      {m.role !== "owner" && (
                        <div className="flex justify-end gap-1">
                          <ResetPasswordDialog membershipId={m._id} name={m.name} />
                          <Button variant="ghost" size="icon" onClick={() => handleRemove(m._id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
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
    </div>
  );
}

/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/** Regression test: verifyMyAppPin used to allow unlimited guesses at a 4-6 digit PIN. */
async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Test owner" });
    const org = await ctx.db.insert("organizations", { name: "Test shop", createdAt: 1 });
    const branch = await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
    await ctx.db.insert("memberships", { userId, organizationId: org, branchId: branch, role: "owner", status: "active", createdAt: 1 });
    await ctx.db.insert("currentOrganizations", { userId, organizationId: org, updatedAt: 1 });
    return { userId, org };
  });
  return { t, owner: t.withIdentity({ subject: `${data.userId}|session` }), ...data };
}

describe("app-lock PIN brute-force protection", () => {
  it("locks out after 5 consecutive wrong guesses and rejects the correct PIN while locked", async () => {
    const f = await fixture();
    await f.owner.action(api.appSecurity.setMyAppPin, { pin: "1234" });

    for (let i = 0; i < 4; i++) {
      const attempt = await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "0000" });
      expect(attempt.valid).toBe(false);
      expect(attempt.lockedUntil).toBeUndefined();
    }
    // 5th wrong guess trips the lockout.
    const fifth = await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "0000" });
    expect(fifth.valid).toBe(false);
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now());

    // Even the correct PIN is rejected while locked out.
    const correctWhileLocked = await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "1234" });
    expect(correctWhileLocked.valid).toBe(false);
    expect(correctWhileLocked.lockedUntil).toBeGreaterThan(Date.now());
  });

  it("resets the failure counter on a correct guess", async () => {
    const f = await fixture();
    await f.owner.action(api.appSecurity.setMyAppPin, { pin: "4321" });

    await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "0000" });
    await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "0000" });
    const correct = await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "4321" });
    expect(correct.valid).toBe(true);

    // Counter reset means 4 more wrong guesses shouldn't trip the lockout yet.
    for (let i = 0; i < 4; i++) {
      const attempt = await f.owner.action(api.appSecurity.verifyMyAppPin, { pin: "0000" });
      expect(attempt.lockedUntil).toBeUndefined();
    }
  });
});

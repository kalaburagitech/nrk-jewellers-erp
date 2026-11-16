import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
import { readPreferences } from "./appPreferences";

const KEEP = 10;
const DAY = 24 * 60 * 60 * 1000;

/** Companies whose auto backup is due (enabled and last backup older than "every N days"). */
export const dueOrganizations = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const due: Id<"organizations">[] = [];
    for (const org of orgs) {
      if (org.deletedAt) continue;
      const prefs = await readPreferences(ctx, org._id);
      if (!prefs.autoBackup.enabled) continue;
      const last = await ctx.db.query("autoBackups").withIndex("by_org", (q) => q.eq("organizationId", org._id)).order("desc").first();
      // Small slack so a daily cron doesn't drift a day late.
      if (!last || Date.now() - last.createdAt >= prefs.autoBackup.everyDays * DAY - 60 * 60 * 1000) due.push(org._id);
    }
    return due;
  },
});

export const record = internalMutation({
  args: { organizationId: v.id("organizations"), storageId: v.id("_storage"), sizeBytes: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("autoBackups", { ...args, createdAt: Date.now() });
    const all = await ctx.db.query("autoBackups").withIndex("by_org", (q) => q.eq("organizationId", args.organizationId)).order("desc").collect();
    for (const old of all.slice(KEEP)) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.delete(old._id);
    }
  },
});

/** Runs daily from crons.ts. One company failing (e.g. too large) doesn't stop the others. */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.autoBackup.dueOrganizations, {});
    for (const organizationId of due) {
      try {
        const backup = await ctx.runQuery(internal.dataManagement.exportBackupInternal, { organizationId });
        const json = JSON.stringify(backup);
        const storageId = await ctx.storage.store(new Blob([json], { type: "application/json" }));
        await ctx.runMutation(internal.autoBackup.record, { organizationId, storageId, sizeBytes: json.length });
      } catch (e) {
        console.error(`Auto backup failed for ${organizationId}:`, e);
      }
    }
  },
});

/** Saved auto backups for the Backup page (Owner/Admin). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const rows = await ctx.db.query("autoBackups").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).order("desc").take(KEEP);
    return await Promise.all(rows.map(async (r) => ({ id: r._id, createdAt: r.createdAt, sizeBytes: r.sizeBytes, url: await ctx.storage.getUrl(r.storageId) })));
  },
});

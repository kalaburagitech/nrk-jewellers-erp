import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
import { assertBoxMetal, boxName, changeBoxStock, ensureBoxEntry, entryDetails, findBoxEntry, getCompanyBox, listBoxEntries, readBoxBalance } from "./lib/boxStock";
import { entryForRole } from "./boxEntries";

const metalValidator = v.union(v.literal("gold"), v.literal("silver"));

/** Every box with its current stock (gross weight + pieces), lowest number first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const boxes = await ctx.db
      .query("boxes")
      .withIndex("by_org_and_number", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(1000);
    // Item names and categories, read once for every box's item rows.
    const products = new Map((await ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect()).map((p) => [p._id as string, p]));
    const categories = new Map((await ctx.db.query("stockCategories").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect()).map((c) => [c._id as string, c.name]));
    return await Promise.all(
      boxes.map(async (box) => {
        const entries = (await listBoxEntries(ctx, box._id)).map((entry) => {
          const product = products.get(entry.productId);
          return {
            ...entryForRole(entry, auth.role),
            productName: product?.name ?? "Item",
            sku: product?.sku,
            categoryName: product?.stockCategoryId ? categories.get(product.stockCategoryId) : undefined,
          };
        });
        return { ...box, ...(await readBoxBalance(ctx, box)), entries };
      }),
    );
  },
});

/** Latest stock movements of one box, newest first (the box's own stock journal). */
export const movements = query({
  args: { boxId: v.id("boxes") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    await getCompanyBox(ctx, auth.organizationId, args.boxId, true);
    const rows = await ctx.db
      .query("stockMovements")
      .withIndex("by_box", (q) => q.eq("boxId", args.boxId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(50);
    return await Promise.all(rows.map(async (row) => ({ ...row, productName: row.productId ? (await ctx.db.get(row.productId))?.name : undefined })));
  },
});

function cleanText(value: string | undefined, max: number, field: string) {
  const text = value?.trim() || undefined;
  if (text && text.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return text;
}

function checkedAmount(value: number | undefined, field: string) {
  const n = value ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${field} must be zero or more`);
  return n;
}

/** Creates a box, optionally with opening stock (weight compulsory for stock, pieces optional). Number defaults to the next free one. */
export const createNext = mutation({
  args: {
    label: v.optional(v.string()),
    boxNumber: v.optional(v.number()),
    metal: v.optional(metalValidator),
    openingWeightMg: v.optional(v.number()),
    openingPieces: v.optional(v.number()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()), // Ring Box, Chain Box, Necklace Box…
    boxType: v.optional(v.string()), // Display tray, Locker, Counter…
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);

    const highest = await ctx.db
      .query("boxes")
      .withIndex("by_org_and_number", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

    const boxNumber = args.boxNumber ?? (highest?.boxNumber ?? 100) + 1;
    if (!Number.isSafeInteger(boxNumber) || boxNumber < 1) throw new Error("Enter a positive whole box number");
    const duplicate = await ctx.db.query("boxes").withIndex("by_org_and_number", q => q.eq("organizationId", auth.organizationId).eq("boxNumber", boxNumber))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (duplicate) throw new Error("That box number is already in use. Please choose a different number.");
    const openingWeightMg = checkedAmount(args.openingWeightMg, "Opening weight");
    const openingPieces = checkedAmount(args.openingPieces, "Opening pieces");
    if (openingPieces > 0 && openingWeightMg === 0) throw new Error("Enter the opening weight for the pieces in this box");
    const now = Date.now();
    const boxId = await ctx.db.insert("boxes", {
      organizationId: auth.organizationId,
      boxNumber,
      label: cleanText(args.label, 60, "Box label"),
      metal: args.metal,
      location: cleanText(args.location, 60, "Location"),
      description: cleanText(args.description, 300, "Description"),
      category: cleanText(args.category, 40, "Box category"),
      boxType: cleanText(args.boxType, 40, "Box type"),
      weightMg: 0,
      pieces: 0,
      itemCount: 0,
      isActive: true,
      createdAt: now,
    });
    await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId, weightDeltaMg: openingWeightMg, piecesDelta: openingPieces, sourceTable: "box_opening", sourceId: boxId, at: now, note: "Opening stock" });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "box.create",
      entityTable: "boxes",
      entityId: boxId,
      metadata: { boxNumber, metal: args.metal, openingWeightMg, openingPieces },
      createdAt: now,
    });
    return boxId;
  },
});

/** Change a box's number, label, metal, location, description or active state. Stock is changed only through adjustments. */
export const update = mutation({
  args: {
    boxId: v.id("boxes"),
    boxNumber: v.number(),
    label: v.optional(v.string()),
    metal: v.optional(metalValidator),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    boxType: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const box = await getCompanyBox(ctx, auth.organizationId, args.boxId, true);
    if (!Number.isSafeInteger(args.boxNumber) || args.boxNumber < 1) throw new Error("Enter a positive whole box number");
    if (args.boxNumber !== box.boxNumber) {
      const duplicate = await ctx.db.query("boxes")
        .withIndex("by_org_and_number", (q) => q.eq("organizationId", auth.organizationId).eq("boxNumber", args.boxNumber))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .first();
      if (duplicate && duplicate._id !== box._id) throw new Error("That box number is already in use. Please choose a different number.");
    }
    if (args.isActive === false && box.isActive) {
      const balance = await readBoxBalance(ctx, box);
      if (balance.weightMg !== 0 || balance.pieces !== 0) {
        throw new Error(`Box ${box.boxNumber} still holds ${(balance.weightMg / 1000).toFixed(3)} g, ${balance.pieces} pcs. Move or sell it before marking the box inactive.`);
      }
    }
    await ctx.db.patch(box._id, {
      boxNumber: args.boxNumber,
      label: cleanText(args.label, 60, "Box label"),
      // Older callers that don't send these leave them as they were.
      ...("metal" in args ? { metal: args.metal } : {}),
      ...("location" in args ? { location: cleanText(args.location, 60, "Location") } : {}),
      ...("description" in args ? { description: cleanText(args.description, 300, "Description") } : {}),
      ...("category" in args ? { category: cleanText(args.category, 40, "Box category") } : {}),
      ...("boxType" in args ? { boxType: cleanText(args.boxType, 40, "Box type") } : {}),
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    });
  },
});

/** Moves weight (and pieces) from one box to another box of the same company and metal. */
export const transferStock = mutation({
  args: {
    fromBoxId: v.id("boxes"), toBoxId: v.id("boxes"), weightMg: v.number(), pieces: v.number(), note: v.optional(v.string()),
    // The item being moved: it leaves that item's row in the first box and joins its row in the other (created with the same details).
    productId: v.optional(v.id("products")),
    netWeightMg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    if (args.fromBoxId === args.toBoxId) throw new Error("Choose two different boxes");
    const weightMg = checkedAmount(args.weightMg, "Weight");
    const pieces = checkedAmount(args.pieces, "Pieces");
    if (!weightMg && !pieces) throw new Error("Enter the weight or pieces to transfer");
    const from = await getCompanyBox(ctx, auth.organizationId, args.fromBoxId);
    const to = await getCompanyBox(ctx, auth.organizationId, args.toBoxId);
    assertBoxMetal(to, from.metal);
    const note = cleanText(args.note, 200, "Remark");
    const now = Date.now();
    const sourceId = `${from._id}:${to._id}:${now}`;
    let fromEntryId: Id<"boxEntries"> | undefined;
    let toEntryId: Id<"boxEntries"> | undefined;
    let netWeightMg: number | undefined;
    if (args.productId) {
      const fromEntry = await findBoxEntry(ctx, from._id, args.productId);
      if (!fromEntry) throw new Error(`That item is not in ${boxName(from)}.`);
      if (fromEntry.metalPurityId) assertBoxMetal(to, (await ctx.db.get(fromEntry.metalPurityId))?.metal);
      // Net weight moves as entered, else in proportion to the gross weight.
      netWeightMg = args.netWeightMg ?? (fromEntry.weightMg > 0 ? Math.round((weightMg * fromEntry.netWeightMg) / fromEntry.weightMg) : weightMg);
      if (!Number.isSafeInteger(netWeightMg) || netWeightMg < 0 || netWeightMg > weightMg) throw new Error("Net weight must be between 0 and the weight moved");
      fromEntryId = fromEntry._id;
      toEntryId = (await ensureBoxEntry(ctx, { organizationId: auth.organizationId, boxId: to._id, productId: args.productId, details: entryDetails(fromEntry) }))._id;
    }
    await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: from._id, boxEntryId: fromEntryId, weightDeltaMg: -weightMg, netDeltaMg: netWeightMg !== undefined ? -netWeightMg : undefined, piecesDelta: -pieces, productId: args.productId, sourceTable: "box_transfers", sourceId, at: now, note: note ?? `To Box ${to.boxNumber}` });
    await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: to._id, boxEntryId: toEntryId, weightDeltaMg: weightMg, netDeltaMg: netWeightMg, piecesDelta: pieces, productId: args.productId, sourceTable: "box_transfers", sourceId, at: now, note: note ?? `From Box ${from.boxNumber}` });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "box.transfer",
      entityTable: "boxes",
      entityId: from._id,
      metadata: { fromBoxNumber: from.boxNumber, toBoxNumber: to.boxNumber, weightMg, pieces, note },
      createdAt: now,
    });
  },
});

/**
 * Barcode/QR scan at billing. Box labels encode "NRKBOX:<boxId>"; a label
 * printed for an old individual piece ("NRK:<boxItemId>" or its saved
 * barcode) resolves to the box that piece is in.
 */
export const lookupScannedItem = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const code = args.code.trim();
    if (!code) return { error: "Nothing was scanned." } as const;
    let box: Doc<"boxes"> | null = null;
    const boxId = /^NRKBOX:/i.test(code) ? ctx.db.normalizeId("boxes", code.replace(/^NRKBOX:/i, "")) : null;
    if (boxId) {
      box = await ctx.db.get(boxId);
    } else {
      const pieceId = ctx.db.normalizeId("boxItems", code.replace(/^NRK:/i, ""));
      const piece = pieceId
        ? await ctx.db.get(pieceId)
        : await ctx.db.query("boxItems").withIndex("by_org_and_barcode", (q) => q.eq("organizationId", auth.organizationId).eq("barcode", code)).first();
      if (piece && piece.organizationId === auth.organizationId) box = await ctx.db.get(piece.boxId);
      else if (/^\d+$/.test(code)) {
        box = await ctx.db.query("boxes").withIndex("by_org_and_number", (q) => q.eq("organizationId", auth.organizationId).eq("boxNumber", Number(code)))
          .filter((q) => q.eq(q.field("deletedAt"), undefined)).first();
      }
    }
    if (!box || box.deletedAt || box.organizationId !== auth.organizationId) return { error: `No box found for code "${code}".` } as const;
    if (!box.isActive) return { error: `${boxName(box)} is inactive.` } as const;
    return { box: { ...box, ...(await readBoxBalance(ctx, box)) } } as const;
  },
});

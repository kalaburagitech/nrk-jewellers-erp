import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { action, query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";
import { retrieveAccount } from "@convex-dev/auth/server";

const PIN_PATTERN = /^\d{4,6}$/;
const PBKDF2_ITERATIONS = 210_000;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function derivePinHash(pin: string, salt: Uint8Array) {
  const saltBuffer = Uint8Array.from(salt).buffer as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export const getMyAppPinStatus = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const security = await ctx.db
      .query("appSecurity")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .unique();
    return { configured: !!security?.pinHash };
  },
});

export const setMyAppPin = action({
  args: { pin: v.string() },
  handler: async (ctx, args) => {
    if (!PIN_PATTERN.test(args.pin)) throw new Error("Choose a 4 to 6 digit passcode.");
    const access = await ctx.runQuery(api.organizations.getMyAccess, {});
    if (!access?.user || !access.membership) throw new Error("Sign in to set an app passcode.");

    const existing = await ctx.runQuery(internal.appSecurityInternal.getPinRecord, {
      userId: access.user._id,
    });
    if (existing) throw new Error("A passcode is already set for this account.");

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pinSalt = bytesToHex(salt);
    const pinHash = await derivePinHash(args.pin, salt);
    await ctx.runMutation(internal.appSecurityInternal.savePin, {
      userId: access.user._id,
      organizationId: access.membership.organizationId,
      pinSalt,
      pinHash,
    });
    return { saved: true };
  },
});

export const verifyMyAppPin = action({
  args: { pin: v.string() },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    if (!PIN_PATTERN.test(args.pin)) return { valid: false };
    const access = await ctx.runQuery(api.organizations.getMyAccess, {});
    if (!access?.user || !access.membership) throw new Error("Sign in to unlock the app.");
    const record: { pinSalt: string; pinHash: string } | null = await ctx.runQuery(internal.appSecurityInternal.getPinRecord, {
      userId: access.user._id,
    });
    if (!record) return { valid: false };
    const candidate = await derivePinHash(args.pin, hexToBytes(record.pinSalt));
    return { valid: safeEqual(candidate, record.pinHash) };
  },
});

export const resetMyAppPinWithPassword = action({
  args: { accountPassword: v.string(), pin: v.string() },
  handler: async (ctx, args) => {
    if (!PIN_PATTERN.test(args.pin)) throw new Error("Choose a 4 to 6 digit passcode.");
    const access = await ctx.runQuery(api.organizations.getMyAccess, {});
    if (!access?.user?.email || !access.membership) throw new Error("Sign in again to reset your app passcode.");
    const verified = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: access.user.email.toLowerCase(), secret: args.accountPassword },
    });
    if (!verified || verified.user._id !== access.user._id) throw new Error("Your account password did not match. Try again.");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await ctx.runMutation(internal.appSecurityInternal.replacePin, {
      userId: access.user._id,
      organizationId: access.membership.organizationId,
      pinSalt: bytesToHex(salt),
      pinHash: await derivePinHash(args.pin, salt),
    });
    return { reset: true };
  },
});

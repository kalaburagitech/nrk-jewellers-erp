import type { MetadataRoute } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

// Without this, Next prerenders the manifest once at build time, freezing
// whatever app icon existed then — an Owner/Admin uploading a new one in
// Business Profile would never see it reflected until the next deploy.
export const dynamic = "force-dynamic";

/**
 * Served at /manifest.webmanifest — what makes the app installable (desktop
 * "Install app" prompt, mobile "Add to Home Screen"). The icon prefers
 * whatever the Owner/Admin uploaded in Business Profile, falling back to the
 * bundled NRK mark so installing always works even before one is set.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let customIconUrl: string | null = null;
  try {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
    customIconUrl = await client.query(api.organizations.getPublicAppIconUrl, {});
  } catch {
    // Convex unreachable at build/export time — fall back to the bundled icon.
  }

  const icons: MetadataRoute.Manifest["icons"] = customIconUrl
    ? [{ src: customIconUrl, sizes: "512x512", type: "image/png", purpose: "any" }]
    : [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ];

  return {
    name: "NRK Jewellers ERP",
    short_name: "NRK Jewellers",
    description: "Jewellery ERP & business management system for NRK Jewellers",
    start_url: "/",
    display: "standalone",
    background_color: "#1c140d",
    theme_color: "#1c140d",
    icons,
  };
}

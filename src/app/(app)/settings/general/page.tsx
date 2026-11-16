import { GeneralSettings, type SettingsTab } from "@/components/general-settings";

const TABS: SettingsTab[] = ["general", "transaction", "print", "gst", "party", "item", "accounting"];

export default async function GeneralSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab) ?? "general";
  return <GeneralSettings key={initialTab} initialTab={initialTab} />;
}

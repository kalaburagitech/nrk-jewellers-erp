import { redirect } from "next/navigation";

// /settings opens the General tab, like Vyapar.
export default function SettingsPage() {
  redirect("/settings/general");
}

import { AccessGate } from "@/components/access-gate";

export default function AppShellLayout({ children }: LayoutProps<"/">) {
  return <AccessGate>{children}</AccessGate>;
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function ComingSoon({
  icon: Icon,
  title,
  milestone,
}: {
  icon: LucideIcon;
  title: string;
  milestone: string;
}) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      <Card>
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
            <Icon className="h-6 w-6 text-accent-foreground" />
          </div>
          <CardTitle className="text-base font-medium">{milestone}</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          This module is scoped for a later build milestone and isn&apos;t implemented yet.
        </CardContent>
      </Card>
    </div>
  );
}

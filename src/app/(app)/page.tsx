import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Coins, Wallet, Users2 } from "lucide-react";

const METRIC_CARDS = [
  { label: "Today's Sales", icon: TrendingUp },
  { label: "Cash & Bank Balance", icon: Wallet },
  { label: "Customer Receivables", icon: Users2 },
  { label: "Gold Stock (all purities)", icon: Coins },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Business overview — figures populate as sales, purchases and stock are recorded.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {METRIC_CARDS.map((metric) => (
          <Card key={metric.label} className="gap-2">
            <CardHeader className="flex flex-row items-center justify-between pb-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.label}
              </CardTitle>
              <metric.icon className="h-4 w-4 text-gold" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight text-muted-foreground/50">—</p>
              <Badge variant="secondary" className="mt-1 font-normal">
                No data yet
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Foundation milestone</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Authentication, roles and the application shell are live. Billing, inventory, boxes,
          customers, metal rates and reports arrive in the following milestones — this dashboard
          will populate from real recorded transactions only, never placeholder figures.
        </CardContent>
      </Card>
    </div>
  );
}

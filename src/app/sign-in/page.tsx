"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Eye, EyeOff, Gem, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../../../convex/_generated/api";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const customLoginImage = useQuery(api.organizations.getPublicLoginImageUrl);
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    formData.set("flow", flow);
    const email = formData.get("email");
    if (typeof email === "string") {
      formData.set("email", email.trim().toLowerCase());
    }
    try {
      await signIn("password", formData);
      router.push("/");
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "";
      if (flow === "signIn" && /TooManyFailedAttempts|too many failed attempts/i.test(message)) {
        setError("Too many sign-in attempts. Please wait a few minutes before trying again.");
      } else {
        setError(
          flow === "signIn"
            ? "Invalid email or password."
            : "Could not create account — the email may already be in use.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-svh grid-cols-1 lg:grid-cols-2">
      <div
        className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[oklch(0.18_0.015_50)] via-[oklch(0.14_0.012_45)] to-black bg-cover bg-center p-10 text-primary-foreground lg:flex"
        style={{ backgroundImage: `url('${customLoginImage ?? "/login-hero.webp"}')` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-black/30 to-black/55" />
        <div className="relative flex w-fit items-center gap-2 rounded-lg bg-black/55 p-2 backdrop-blur-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gold text-gold-foreground">
            <Gem className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold tracking-widest text-white uppercase">NRK Jewellers</span>
        </div>
        <div className="relative max-w-lg space-y-3 rounded-xl bg-black/55 p-6 backdrop-blur-sm">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            Enterprise jewellery operations,
            <br />
            run from one system.
          </h2>
          <p className="max-w-md text-sm text-white/85">
            Billing, purchases, inventory, box management, customer ledgers and GST — built for
            the realities of daily shop floor operations.
          </p>
        </div>
        <p className="relative w-fit rounded-md bg-black/55 px-2 py-1 text-xs text-white/80 backdrop-blur-sm">
          &copy; {new Date().getFullYear()} NRK Jewellers
        </p>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 bg-background p-6">
        <Card className="w-full max-w-sm border-none shadow-none sm:border sm:shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">
              {flow === "signIn" ? "Sign in" : "Create the owner account"}
            </CardTitle>
            <CardDescription>
              {flow === "signIn"
                ? "Enter your credentials to access the ERP."
                : "The first account created becomes the organization owner."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              {flow === "signUp" && (
                <div className="grid gap-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" name="name" placeholder="Your name" required />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="you@nrkjewellers.com" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting} className="mt-1">
                {submitting ? "Please wait…" : flow === "signIn" ? "Sign in" : "Create account"}
              </Button>
            </form>
            <button
              type="button"
              className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setError(null);
                setFlow(flow === "signIn" ? "signUp" : "signIn");
              }}
            >
              {flow === "signIn"
                ? "First time setting up NRK Jewellers? Create the owner account"
                : "Already have an account? Sign in"}
            </button>
          </CardContent>
        </Card>

        {flow === "signIn" && (
          <div className="flex w-full max-w-sm items-start gap-2 rounded-md border border-gold/30 bg-gold/10 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
            <p>Use the owner or staff login created for your NRK Jewellers workspace.</p>
          </div>
        )}
      </div>
    </div>
  );
}

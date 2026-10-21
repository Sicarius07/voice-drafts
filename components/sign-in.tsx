"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const LABEL = { google: "Google", github: "GitHub" } as const;

/** OAuth buttons for the configured providers, then email + password (sign in or create an account). */
export function SignIn({ providers }: { providers: (keyof typeof LABEL)[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    const { error } =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name") || email.split("@")[0]) });
    setBusy(false);
    if (error) return void toast.error(error.message ?? "Sign-in failed");
    router.push("/voices");
  }

  return (
    <div className="w-full max-w-sm space-y-4">
      {providers.length > 0 && (
        <>
          <div className="grid gap-2">
            {providers.map((p) => (
              <Button key={p} size="lg" variant="outline" className="bg-background" onClick={() => authClient.signIn.social({ provider: p, callbackURL: "/voices" })}>
                Continue with {LABEL[p]}
              </Button>
            ))}
          </div>
          <p className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">or</p>
        </>
      )}
      <form onSubmit={submit} className="space-y-2">
        {mode === "up" && <Input name="name" placeholder="Name" autoComplete="name" aria-label="Name" className="h-10 bg-background" />}
        <Input name="email" type="email" required placeholder="Email" autoComplete="email" aria-label="Email" className="h-10 bg-background" />
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder={mode === "up" ? "Password (8+ characters)" : "Password"}
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          aria-label="Password"
          className="h-10 bg-background"
        />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" />}
          {mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {mode === "in" ? "No account yet? " : "Already have an account? "}
        <button type="button" className="text-foreground underline underline-offset-4" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Create one" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <Button variant="ghost" size="sm" onClick={() => authClient.signOut().then(() => router.push("/"))}>
      Sign out
    </Button>
  );
}

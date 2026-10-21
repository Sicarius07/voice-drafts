"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

// Monochrome brand marks from Simple Icons (CC0).
const PROVIDERS = {
  google: {
    label: "Google",
    path: "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
  },
  github: {
    label: "GitHub",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
} as const;

/** Email + password (sign in or create an account), then round buttons for the configured OAuth providers. */
export function SignIn({ providers }: { providers: (keyof typeof PROVIDERS)[] }) {
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
    <div className="w-full max-w-sm space-y-5">
      <form onSubmit={submit} className="space-y-3">
        {mode === "up" && <Input name="name" placeholder="Name" autoComplete="name" aria-label="Name" className="h-11 bg-background" />}
        <Input name="email" type="email" required placeholder="Email" autoComplete="email" aria-label="Email" className="h-11 bg-background" />
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder={mode === "up" ? "Password (8+ characters)" : "Password"}
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          aria-label="Password"
          className="h-11 bg-background"
        />
        <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" />}
          {mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="text-right text-sm">
        <button type="button" className="font-medium hover:underline hover:underline-offset-4" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Create an account" : "I have an account"}
        </button>
      </p>
      {providers.length > 0 && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">or sign in with</p>
          <div className="flex justify-center gap-3">
            {providers.map((p) => (
              <Button
                key={p}
                variant="secondary"
                size="icon"
                className="size-11 rounded-full"
                aria-label={`Sign in with ${PROVIDERS[p].label}`}
                title={PROVIDERS[p].label}
                onClick={() => authClient.signIn.social({ provider: p, callbackURL: "/voices" })}
              >
                <svg viewBox="0 0 24 24" aria-hidden className="size-5 fill-current">
                  <path d={PROVIDERS[p].path} />
                </svg>
              </Button>
            ))}
          </div>
        </div>
      )}
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

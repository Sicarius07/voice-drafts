"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/** GitHub sign-in; in local development (no OAuth app needed) an email/password form instead. */
export function SignIn({ github, devLogin }: { github: boolean; devLogin: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("dev@example.com");
  const [busy, setBusy] = useState(false);

  async function devSignIn() {
    setBusy(true);
    const password = "dev-password-123";
    const signIn = await authClient.signIn.email({ email, password, callbackURL: "/voices" });
    if (signIn.error) {
      const signUp = await authClient.signUp.email({ email, password, name: email.split("@")[0], callbackURL: "/voices" });
      if (signUp.error) {
        toast.error(signUp.error.message ?? "Sign-in failed");
        return setBusy(false);
      }
    }
    router.push("/voices");
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {github && (
        <Button size="lg" onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/voices" })}>
          Sign in with GitHub
        </Button>
      )}
      {devLogin && (
        <div className="flex gap-2">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} className="w-56" aria-label="Dev email" />
          <Button variant="outline" onClick={devSignIn} disabled={busy}>
            Dev sign-in
          </Button>
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

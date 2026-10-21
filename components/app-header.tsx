import Link from "next/link";
import { SignOut } from "@/components/sign-in";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-3 px-4">
        <Link href="/voices" className="text-sm font-semibold">
          Voice Drafts
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        <SignOut />
      </div>
    </header>
  );
}

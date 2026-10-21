import Link from "next/link";
import { SignOut } from "@/components/sign-in";
import { cn } from "@/lib/utils";

/** `className` sizes the inner row, so it can line up with a wider page (the workspace and its rail). */
export function AppHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/60 backdrop-blur-xl backdrop-saturate-150">
      <div className={cn("mx-auto flex h-12 max-w-5xl items-center gap-3 px-4", className)}>
        <Link href="/voices" className="text-sm font-semibold">
          Voice Drafts
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        <SignOut />
      </div>
    </header>
  );
}

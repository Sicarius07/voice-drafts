import { AudioLinesIcon, GraduationCapIcon, PenLineIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One icon per workspace tab, shared by the rail and the home page that introduces the tabs. */
export const TAB_ICONS = { drafts: PenLineIcon, voice: AudioLinesIcon, learning: GraduationCapIcon };

/** Workspace page width: the 64rem content column plus the tab rail and its gap. */
export const WORKSPACE_WIDTH = "max-w-[70rem]";

/** The one raised, opaque surface per tab. Content always sits on it, never on glass. */
export function Sheet({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-[1.75rem] bg-card shadow-sheet", className)}>{children}</div>;
}

/** A section inside a sheet: a tinted platter, one step below the sheet. */
export function Panel({ title, hint, className, children }: { title?: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("@container min-w-0 rounded-[1.25rem] bg-platter p-4 sm:p-6", className)}>
      {title && (
        <header className="mb-4">
          <h3 className="text-sm font-medium">{title}</h3>
          {hint && <p className="mt-0.5 text-[13px]/snug text-muted-foreground">{hint}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

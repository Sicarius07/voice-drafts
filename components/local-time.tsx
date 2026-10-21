/** A timestamp in the viewer's locale and timezone (the server's rendering may differ, so hydration is told to expect it). */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const d = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {dateOnly ? d.toLocaleDateString() : d.toLocaleString()}
    </time>
  );
}

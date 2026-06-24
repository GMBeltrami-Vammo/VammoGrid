// Route-level loading skeleton — shown by Next.js Suspense while the dashboard
// Server Component fetches data (ClickHouse + Supabase). Keeps layout visible
// so the sidebar and filter bars remain interactive during load.
export default function DashboardLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-muted/60" />
      <div className="h-4 w-72 rounded bg-muted/40" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 mt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-2">
        <div className="h-64 rounded-xl bg-muted/40" />
        <div className="h-64 rounded-xl bg-muted/40" />
      </div>
    </div>
  );
}

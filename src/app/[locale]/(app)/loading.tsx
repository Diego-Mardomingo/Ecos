export default function AppLoading() {
  return (
    <div className="flex min-h-full flex-col gap-5 px-4 pb-6 pt-safe">
      <div className="-mx-4 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div
          className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-muted"
          aria-hidden
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

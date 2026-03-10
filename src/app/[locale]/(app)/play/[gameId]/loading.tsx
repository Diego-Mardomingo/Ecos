export default function PlayGameLoading() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4">
      <div
        className="aspect-square w-full max-w-[280px] animate-pulse rounded-2xl bg-muted"
        aria-hidden
      />
      <div className="w-full max-w-[280px] space-y-3">
        <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-muted" />
      </div>
      <p className="text-sm text-muted-foreground">Preparando el juego...</p>
    </div>
  );
}

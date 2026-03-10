export default function OfflinePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">Sin conexión</h1>
        <p className="mt-2 text-muted-foreground">
          No hay conexión a Internet. Revisa tu red e intenta de nuevo.
        </p>
      </div>
    </div>
  );
}

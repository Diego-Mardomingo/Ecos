/** Misma superficie que la app; evita skeleton de salto al entrar en `/play`. */
export default function PlayLoading() {
  return <div className="min-h-dvh bg-background" aria-hidden />;
}

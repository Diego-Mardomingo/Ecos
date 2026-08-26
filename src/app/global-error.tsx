"use client";

import { useEffect } from "react";

/**
 * Último recinto de contención: se usa cuando falla el propio layout raíz, y ahí no hay
 * `NextIntlClientProvider` ni estilos de la app, así que tiene que traer su `<html>`/`<body>` y no
 * puede depender de nada del árbol. Sin este fichero, ese caso mostraba la pantalla blanca por
 * defecto de Next.
 *
 * Los textos van en español (el idioma por defecto del proyecto) porque en este punto no hay forma
 * fiable de resolver el locale: si el layout no ha llegado a montar, no hay mensajes cargados.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#0f1112",
          color: "#f6f8f7",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
          Algo salió mal
        </h1>
        <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.7, maxWidth: "32rem" }}>
          No hemos podido cargar ECOS. Vuelve a intentarlo en un momento.
        </p>
        {error.digest ? (
          <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.5 }}>
            Referencia del error: <code>{error.digest}</code>
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            cursor: "pointer",
            borderRadius: "0.5rem",
            border: "1px solid rgba(246,248,247,0.25)",
            background: "transparent",
            color: "inherit",
            padding: "0.5rem 1.25rem",
            font: "inherit",
            fontSize: "0.875rem",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}

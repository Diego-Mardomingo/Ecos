import Link from "next/link";

/**
 * 404 de raíz. Solo se llega aquí cuando ni siquiera hay un idioma válido con el que responder:
 * el `notFound()` de `[locale]/layout.tsx` para un locale desconocido, y las rutas que caen fuera
 * de `[locale]`. Los 404 normales de la app los sirve `[locale]/not-found.tsx`, ya traducido.
 *
 * Sin `<html>`/`<body>` propios no se renderiza nada: el layout de raíz es un passthrough y quien
 * los aporta es `[locale]/layout.tsx`, que en este caso no llega a montarse. Por lo mismo tampoco
 * hay Tailwind ni mensajes cargados, de ahí los estilos en línea y el texto en los dos idiomas.
 *
 * El enlace usa `next/link` y no el helper de `src/i18n/navigation`: esto queda fuera del árbol de
 * locale, así que no hay contexto de next-intl del que sacar el prefijo.
 */
export default function RootNotFound() {
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
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#0f1112",
          color: "#f6f8f7",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
          Página no encontrada
        </h1>
        <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.7 }}>
          Page not found
        </p>
        <Link
          href="/"
          style={{
            marginTop: "0.5rem",
            fontSize: "0.875rem",
            color: "#2bee79",
            textDecoration: "underline",
            textUnderlineOffset: "0.2em",
          }}
        >
          ECOS
        </Link>
      </body>
    </html>
  );
}

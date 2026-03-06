import type { ReactNode } from "react";

// Root layout requerido por Next.js.
// El layout real con <html> y <body> vive en app/[locale]/layout.tsx
// para poder inyectar el atributo lang correcto según el idioma activo.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}

import type { ReactNode } from "react";
import "../globals.css";

export default function OfflineLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-[#0f1112] text-[#f4f4f5] antialiased">
        {children}
      </body>
    </html>
  );
}

"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { es, enUS } from "date-fns/locale";
import type { Locale } from "date-fns";

/**
 * Mapea el locale de next-intl a lo que necesitan `date-fns` y `Intl`.
 *
 * Estaba repetido a mano en nueve sitios (`locale === "es" ? es : enUS` seis veces y el
 * equivalente para `toLocaleString` otras tres, con dos de ellas usando `"es"` en lugar de
 * `"es-ES"`). Las dos variantes dan el mismo resultado en la práctica, así que no había un fallo
 * visible, pero sí dos convenciones conviviendo y ningún sitio donde cambiarlas de una vez.
 */
const DATE_FNS_LOCALES: Record<string, Locale> = { es, en: enUS };
const NUMBER_LOCALES: Record<string, string> = { es: "es-ES", en: "en-US" };

const DEFAULT_DATE_FNS = enUS;
const DEFAULT_NUMBER = "en-US";

export interface AppFormatters {
  /** Locale de `date-fns`, para pasar como `{ locale }` a `format`. */
  dateFnsLocale: Locale;
  /** Etiqueta BCP 47 para `Intl` / `toLocaleString`. */
  numberLocale: string;
  /** Formatea un entero con los separadores de miles del idioma activo. */
  formatNumber: (value: number) => string;
}

export function useAppFormatters(): AppFormatters {
  const locale = useLocale();

  return useMemo(() => {
    const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? DEFAULT_DATE_FNS;
    const numberLocale = NUMBER_LOCALES[locale] ?? DEFAULT_NUMBER;
    // Un solo NumberFormat reutilizado: construirlo es la parte cara de Intl, y antes se creaba
    // uno nuevo en cada llamada a toLocaleString, una por fila del ranking.
    const numberFormat = new Intl.NumberFormat(numberLocale);
    return {
      dateFnsLocale,
      numberLocale,
      formatNumber: (value: number) => numberFormat.format(value),
    };
  }, [locale]);
}

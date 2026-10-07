import { z } from "zod";

/**
 * Los argumentos de una server action llegan del cliente: hay que validarlos igual que un body.
 * Todas las acciones de admin reciben el id de una fila por aquí.
 */
export const IdSchema = z.string().uuid();

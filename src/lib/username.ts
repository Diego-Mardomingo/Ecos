/**
 * Reglas del nombre de usuario, en un solo sitio: las usan la API de perfil y los formularios de
 * onboarding y de edición (DUP-13). Antes la regex estaba copiada en cuatro ficheros.
 */

/** Longitud máxima, en caracteres. */
export const USERNAME_MAX_LENGTH = 50;

/** Letras, números, `_`, espacios y emojis; de 3 a 50 caracteres (puntos de código). */
export const USERNAME_REGEX = /^[\p{L}\p{N}_ \p{Extended_Pictographic}]{3,50}$/u;

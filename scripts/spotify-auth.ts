/**
 * Obtiene SPOTIFY_REFRESH_TOKEN vía OAuth (solo ejecutar una vez).
 * Ejecución: pnpm run spotify-auth
 *
 * 1. Configura en Spotify Dashboard: Redirect URI = https://tu-dominio/api/spotify-auth/callback
 *    (ej: https://ecos.vercel.app/api/spotify-auth/callback)
 * 2. Añade en .env.local: SPOTIFY_REDIRECT_URI=https://tu-dominio/api/spotify-auth/callback
 * 3. Despliega la app (o ejecútala con pnpm dev)
 * 4. Ejecuta este script y abre la URL, autoriza, copia el token
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

// playlist-read-public fue deprecado. Para playlists públicas no hace falta scope.
const SCOPES = "";

function main() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    console.error("SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET requeridos en .env.local");
    process.exit(1);
  }

  if (!redirectUri || !redirectUri.startsWith("https://")) {
    console.error(
      "SPOTIFY_REDIRECT_URI requerido en .env.local (HTTPS). Ejemplo:\n" +
        "  SPOTIFY_REDIRECT_URI=https://ecos.vercel.app/api/spotify-auth/callback\n\n" +
        "Añade esa URL también en Spotify Dashboard > Redirect URIs."
    );
    process.exit(1);
  }

  const params: Record<string, string> = {
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
  };
  if (SCOPES) params.scope = SCOPES;

  const authUrl = "https://accounts.spotify.com/authorize?" + new URLSearchParams(params).toString();

  console.log("\n1. Abre esta URL en el navegador:\n   " + authUrl + "\n");
  console.log("2. Autoriza y copia SPOTIFY_REFRESH_TOKEN a .env.local\n");
}

main();

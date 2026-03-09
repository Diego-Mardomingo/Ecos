import { NextRequest, NextResponse } from "next/server";

/**
 * Callback OAuth de Spotify. Redirect URI = {tu-dominio}/api/spotify-auth/callback
 * Añade esa URL (HTTPS) en Spotify Dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return new NextResponse(
      "<h1>Error</h1><p>No se recibió el código. Vuelve a intentar.</p>",
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ??
    `${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : request.nextUrl.origin}/api/spotify-auth/callback`;

  if (!clientId || !clientSecret) {
    return new NextResponse(
      "<h1>Error</h1><p>SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET no configurados.</p>",
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new NextResponse(
      `<h1>Error</h1><pre>${text}</pre>`,
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const data = (await tokenRes.json()) as {
    refresh_token: string;
  };

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Spotify Auth</title></head>
<body>
  <h1>Listo</h1>
  <p>Añade a tu <code>.env.local</code>:</p>
  <pre>SPOTIFY_REFRESH_TOKEN=${data.refresh_token}</pre>
  <p>Puedes cerrar esta pestaña.</p>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

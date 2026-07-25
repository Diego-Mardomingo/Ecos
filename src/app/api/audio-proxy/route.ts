import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";

/**
 * Proxy de audio para preview de Spotify.
 * Sirve el fragmento de audio sin exponer la URL del CDN al cliente.
 * Requiere un gameId válido en la base de datos.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");

    if (!gameId) {
      return new NextResponse("Missing gameId", { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("ecos_games")
      .select("ecos_songs(preview_url)")
      .eq("id", gameId)
      .single();

    if (error || !data) {
      return new NextResponse("Game not found", { status: 404 });
    }

    const song = unwrapToOne<{ preview_url: string | null }>(data.ecos_songs);
    const previewUrl = song?.preview_url;

    if (!previewUrl) {
      return new NextResponse("No preview available", { status: 404 });
    }

    const upstream = await fetch(previewUrl, {
      headers: {
        // Reenviar Range si el cliente lo solicita (seekable audio)
        ...(request.headers.get("range")
          ? { Range: request.headers.get("range")! }
          : {}),
      },
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse("Failed to fetch audio", { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
      // No almacenar en caché del lado del cliente para prevenir extracción
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    });

    // Propagar Content-Length y Content-Range si existen (necesario para seek)
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error("api/audio-proxy error:", err);
    return new NextResponse("Internal server error", { status: 500 });
  }
}

/**
 * ¿Tiene la canción algún audio? Spotify guarda la URL (`preview_url`); Deezer solo el id, porque su
 * URL va firmada y se resuelve al vuelo en `/api/audio-url`. Sin imports de servidor.
 */
export function songHasAudio(song: { preview_url: string | null; deezer_id: number | null }): boolean {
  return !!(song.preview_url || song.deezer_id);
}

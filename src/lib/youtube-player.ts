/**
 * YouTube IFrame API — carga y control del reproductor.
 * Solo para cliente (browser). Iframe completamente oculto.
 */

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          width?: number;
          height?: number;
          playerVars?: {
            autoplay?: number;
            controls?: number;
            disablekb?: number;
            fs?: number;
            modestbranding?: number;
            start?: number;
          };
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

let apiLoaded = false;
let loadPromise: Promise<void> | null = null;

function loadYoutubeAPI(): Promise<void> {
  if (apiLoaded && window.YT) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      apiLoaded = true;
      resolve();
      return;
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true;
      if (prev) prev();
      resolve();
    };

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first.parentNode?.insertBefore(tag, first);
  });

  return loadPromise;
}

export interface CreateYoutubePlayerOptions {
  videoId: string;
  onEnded?: () => void;
  maxDurationSeconds?: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Crea un reproductor YouTube oculto.
 * controls: 0, disablekb: 1, fs: 0, modestbranding: 1
 * Siempre empieza en segundo 0.
 */
export async function createYoutubePlayer(
  opts: CreateYoutubePlayerOptions
): Promise<YTPlayer> {
  await loadYoutubeAPI();

  const container =
    opts.containerRef?.current ?? document.createElement("div");
  if (!container) {
    throw new Error("Container required for YouTube player");
  }

  return new Promise((resolve, reject) => {
    try {
      const player = new window.YT!.Player(container, {
        videoId: opts.videoId,
        width: 1,
        height: 1,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          start: 0,
        },
        events: {
          onReady: () => resolve(player),
        },
      });
    } catch (e) {
      reject(e);
    }
  });
}

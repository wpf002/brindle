"use client";
import { useEffect, useRef } from "react";

// Low-latency ring video. Mux and AWS IVS both emit HLS; the seller's stream URL
// lands on Auction.streamUrl. Safari plays HLS natively; other browsers load
// hls.js on demand (only when there's actually a stream to show) so we don't ship
// the dependency to pages that never use it.
export function LiveVideo({ streamUrl }: { streamUrl: string | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || !streamUrl) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl; // native HLS (Safari / iOS)
      return;
    }
    let hls: { destroy: () => void } | null = null;
    void (async () => {
      try {
        const Hls = (await import("hls.js")).default;
        if (Hls.isSupported()) {
          const inst = new Hls();
          inst.loadSource(streamUrl);
          inst.attachMedia(video);
          hls = inst;
        }
      } catch {
        /* hls.js not installed — native-only environments still work */
      }
    })();
    return () => hls?.destroy();
  }, [streamUrl]);

  if (!streamUrl) {
    return <div className="video placeholder">Video stream not started</div>;
  }
  return <video ref={ref} className="video" controls autoPlay muted playsInline />;
}

/**
 * useRoutePlayback.ts
 * Timestamp-driven route playback engine:
 * - Playback progresses proportionately based on real timestamp differences
 *   (e.g., a 3-minute gap pauses marker movement proportionately)
 * - Supports Play, Pause, Restart, Seek/Scrub (0 to 1 progress)
 * - Speed multipliers: 0.5x, 1x, 2x, 5x
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CleanedRoutePoint } from "@/utils/routeCleanup";

export interface UseRoutePlaybackOptions {
  points: CleanedRoutePoint[];
  initialSpeed?: number;
}

export function useRoutePlayback({ points, initialSpeed = 1 }: UseRoutePlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(initialSpeed);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0); // offset from start in ms

  // Timestamps bounds
  const { startTimeMs, endTimeMs, totalDurationMs } = useMemo(() => {
    if (!points || points.length === 0) {
      return { startTimeMs: 0, endTimeMs: 0, totalDurationMs: 0 };
    }
    const start = new Date(points[0].recorded_at).getTime();
    const end = new Date(points[points.length - 1].recorded_at).getTime();
    return {
      startTimeMs: start,
      endTimeMs: end,
      totalDurationMs: Math.max(1000, end - start),
    };
  }, [points]);

  const animFrameRef = useRef<any>(null);
  const lastTickRef = useRef<number>(0);

  // Toggle Play / Pause
  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && currentIndex >= points.length - 1) {
        // Restart from beginning if finished
        setCurrentTimeMs(0);
        setCurrentIndex(0);
      }
      return !prev;
    });
  }, [currentIndex, points.length]);

  // Restart
  const restart = useCallback(() => {
    setCurrentTimeMs(0);
    setCurrentIndex(0);
    setIsPlaying(true);
  }, []);

  // Scrub to progress (0.0 to 1.0)
  const scrubToProgress = useCallback(
    (progress: number) => {
      if (!points || points.length === 0) return;
      const clamped = Math.max(0, Math.min(1, progress));
      const targetOffsetMs = clamped * totalDurationMs;
      setCurrentTimeMs(targetOffsetMs);

      // Find nearest point
      const absoluteTarget = startTimeMs + targetOffsetMs;
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < points.length; i++) {
        const ptTime = new Date(points[i].recorded_at).getTime();
        const diff = Math.abs(ptTime - absoluteTarget);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      setCurrentIndex(closestIdx);
    },
    [points, startTimeMs, totalDurationMs],
  );

  // Animation Loop based on real timestamp progression
  useEffect(() => {
    if (!isPlaying || points.length <= 1) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    lastTickRef.current = Date.now();

    const tick = () => {
      const now = Date.now();
      const realElapsedMs = now - lastTickRef.current;
      lastTickRef.current = now;

      // Advance by simulated time (accelerated by playbackSpeed)
      // Normal 1 hour route at 1x plays back in ~60 seconds (60x time compression base)
      const compressedAdvanceMs = (realElapsedMs * 60) * playbackSpeed;

      setCurrentTimeMs((prevOffset) => {
        const nextOffset = prevOffset + compressedAdvanceMs;
        if (nextOffset >= totalDurationMs) {
          setIsPlaying(false);
          setCurrentIndex(points.length - 1);
          return totalDurationMs;
        }

        // Find current point index
        const currentAbsolute = startTimeMs + nextOffset;
        let newIdx = 0;
        for (let i = 0; i < points.length; i++) {
          const ptTime = new Date(points[i].recorded_at).getTime();
          if (ptTime <= currentAbsolute) {
            newIdx = i;
          } else {
            break;
          }
        }
        setCurrentIndex(newIdx);
        return nextOffset;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, points, playbackSpeed, startTimeMs, totalDurationMs]);

  // Current active playback point
  const activePoint = points[currentIndex] ?? null;

  // Format time strings (MM:SS)
  const currentElapsedSec = Math.round(currentTimeMs / 1000);
  const totalDurationSec = Math.round(totalDurationMs / 1000);
  const formatTime = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return {
    isPlaying,
    playbackSpeed,
    currentIndex,
    activePoint,
    progress: totalDurationMs > 0 ? currentTimeMs / totalDurationMs : 0,
    elapsedTimeStr: formatTime(currentElapsedSec),
    totalTimeStr: formatTime(totalDurationSec),
    togglePlay,
    restart,
    setPlaybackSpeed,
    scrubToProgress,
  };
}


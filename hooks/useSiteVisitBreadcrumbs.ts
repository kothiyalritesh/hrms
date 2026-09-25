import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TrackingTelemetrySource } from "@/types/location-database";

export interface BreadcrumbPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
  speed_mps: number | null;
  accuracy_m: number | null;
  heading: number | null;
  quality_status: string;
  source?: TrackingTelemetrySource | null;
}

export function useSiteVisitBreadcrumbs(fieldVisitId: string | null) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenRecordedAtRef = useRef<Set<string>>(new Set());

  const fetchBreadcrumbs = useCallback(async (isBackground = false) => {
    if (!fieldVisitId) {
      setBreadcrumbs([]);
      seenRecordedAtRef.current.clear();
      return;
    }
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const { data, error: queryErr } = await supabase
        .from("site_visit_location_history")
        .select("latitude, longitude, recorded_at, speed_mps, accuracy_m, heading, quality_status, source")
        .eq("field_visit_id", fieldVisitId)
        .neq("quality_status", "MOCKED")
        .order("recorded_at", { ascending: true });

      if (queryErr) throw queryErr;

      const validPoints: BreadcrumbPoint[] = (data ?? [])
        .filter((row: any) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
        .map((row: any) => ({
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          recorded_at: row.recorded_at,
          speed_mps: row.speed_mps != null ? Number(row.speed_mps) : null,
          accuracy_m: row.accuracy_m != null ? Number(row.accuracy_m) : null,
          heading: row.heading != null ? Number(row.heading) : null,
          quality_status: row.quality_status,
          source: (row.source as TrackingTelemetrySource) ?? null,
        }));

      seenRecordedAtRef.current = new Set(validPoints.map((p) => p.recorded_at));
      setBreadcrumbs(validPoints);
    } catch (err: any) {
      if (!isBackground) setError(err?.message || "Failed to load visit breadcrumbs");
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [fieldVisitId]);

  // Initial fetch
  useEffect(() => {
    void fetchBreadcrumbs(false);
  }, [fetchBreadcrumbs]);

  // Real-time Postgres change listener + periodic sync fallback
  useEffect(() => {
    if (!fieldVisitId) return;

    // Realtime channel for instant step-by-step breadcrumb updates
    const channel = supabase
      .channel(`breadcrumbs-live-${fieldVisitId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "site_visit_location_history",
          filter: `field_visit_id=eq.${fieldVisitId}`,
        },
        (payload: any) => {
          const row = payload.new;
          if (
            row &&
            Number.isFinite(row.latitude) &&
            Number.isFinite(row.longitude) &&
            row.quality_status !== "MOCKED" &&
            !seenRecordedAtRef.current.has(row.recorded_at)
          ) {
            seenRecordedAtRef.current.add(row.recorded_at);
            const newPt: BreadcrumbPoint = {
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              recorded_at: row.recorded_at,
              speed_mps: row.speed_mps != null ? Number(row.speed_mps) : null,
              accuracy_m: row.accuracy_m != null ? Number(row.accuracy_m) : null,
              heading: row.heading != null ? Number(row.heading) : null,
              quality_status: row.quality_status,
              source: (row.source as TrackingTelemetrySource) ?? null,
            };
            setBreadcrumbs((prev) => [...prev, newPt]);
          }
        },
      )
      .subscribe();

    // 10-second polling fallback to catch multi-ping batch uploads or offline flushes
    const timer = setInterval(() => {
      void fetchBreadcrumbs(true);
    }, 10_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [fieldVisitId, fetchBreadcrumbs]);

  return { breadcrumbs, loading, error, refetch: fetchBreadcrumbs };
}

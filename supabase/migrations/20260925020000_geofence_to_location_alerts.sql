-- Migration: Wire Geofence Events to Location Alerts (Module 8)
-- Description: Automatically propagates geofence exit violations into the legacy location_alerts table to instantly notify HR on the Live Tracking dashboard.

CREATE OR REPLACE FUNCTION public.trg_geofence_event_to_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_message text;
    v_alert_type text;
BEGIN
    -- We only alert on EXITS, not returns.
    IF NEW.event_type IN ('OFFICE_EXIT', 'FIELD_EXIT') THEN
        IF NEW.event_type = 'OFFICE_EXIT' THEN
            v_message := 'Employee moved > 200m outside the office perimeter.';
            v_alert_type := 'geofence_exit';
        ELSE
            v_message := 'Employee moved outside the field visit perimeter.';
            v_alert_type := 'geofence_exit';
        END IF;

        INSERT INTO public.location_alerts (
            user_id,
            alert_type,
            message,
            distance_m,
            escalation_level
        ) VALUES (
            NEW.user_id,
            v_alert_type,
            v_message,
            NEW.calculated_distance_m,
            2 -- Escalation level 2 (Moderate/High priority)
        );
    END IF;
    RETURN NEW;
END $$;

-- Drop existing if needed
DROP TRIGGER IF EXISTS geofence_event_to_alert_trg ON public.geofence_events;

-- Create the trigger on INSERT
CREATE TRIGGER geofence_event_to_alert_trg
AFTER INSERT ON public.geofence_events
FOR EACH ROW EXECUTE FUNCTION public.trg_geofence_event_to_alert();

-- Backfill missing geofence_exit alert type check constraint if necessary
ALTER TABLE public.location_alerts DROP CONSTRAINT IF EXISTS location_alerts_alert_type_check;
ALTER TABLE public.location_alerts ADD CONSTRAINT location_alerts_alert_type_check CHECK (
    alert_type IN (
        'gps_off',
        'location_stale',
        'health_warning',
        'permission_revoked',
        'geofence_exit'
    )
);

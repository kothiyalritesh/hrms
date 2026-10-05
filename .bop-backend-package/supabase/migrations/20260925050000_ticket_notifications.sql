-- Migration: Notifications for Support Tickets (Module 15)
-- Description: Triggers a push notification to assigned users when a ticket is opened or assigned.

CREATE OR REPLACE FUNCTION public.notify_on_ticket_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignee record;
BEGIN
  -- Notify Assignee
  IF NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, reference_id)
    VALUES (NEW.assigned_to, 'New Ticket Assigned', 'You have been assigned to ticket: ' || NEW.title, 'TICKET_ASSIGNED', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ticket_creation_trg ON public.support_tickets;
CREATE TRIGGER notify_ticket_creation_trg
AFTER INSERT ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.notify_on_ticket_creation();

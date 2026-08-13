-- The live event was created from the admin screen with a venue-specific title,
-- so update it by its Gaur Sarovar date/venue identity as well.
update public.events
set checkin_radius_m = 200
where event_date = date '2026-07-26'
  and (
    lower(title) like '%gaur%sarov%'
    or (
      abs(latitude - 28.610171094507933) < 0.002
      and abs(longitude - 77.42443956722464) < 0.002
    )
  );

create or replace function public.rpc_review_predefined_site_location_v2(
  p_field_visit_id uuid,
  p_new_latitude double precision,
  p_new_longitude double precision,
  p_new_radius_metres double precision,
  p_notes text,
  p_keep_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.review_predefined_site_location(
    p_field_visit_id, p_new_latitude, p_new_longitude,
    p_new_radius_metres, p_notes, p_keep_existing
  );
  return jsonb_build_object(
    'success', true,
    'field_visit_id', p_field_visit_id
  );
end;
$$;

revoke all on function public.rpc_review_predefined_site_location_v2(
  uuid, double precision, double precision, double precision, text, boolean
) from public, anon;
grant execute on function public.rpc_review_predefined_site_location_v2(
  uuid, double precision, double precision, double precision, text, boolean
) to authenticated;

notify pgrst, 'reload schema';

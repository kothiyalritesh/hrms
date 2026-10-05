DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE permission_key = 'field_visit.create');
DELETE FROM public.user_permission_overrides WHERE permission_id IN (SELECT id FROM public.permissions WHERE permission_key = 'field_visit.create');
DELETE FROM public.permissions WHERE permission_key = 'field_visit.create';

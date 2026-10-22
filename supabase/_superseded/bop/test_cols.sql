CREATE OR REPLACE FUNCTION get_view_cols(v_name text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  res jsonb;
BEGIN
  SELECT jsonb_agg(column_name) INTO res
  FROM information_schema.columns
  WHERE table_name = v_name;
  RETURN res;
END;
$$;

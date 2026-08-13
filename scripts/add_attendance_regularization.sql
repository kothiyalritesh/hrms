CREATE TABLE IF NOT EXISTS attendance_regularization_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  attendance_id UUID NOT NULL REFERENCES attendance_logs(id),
  request_type TEXT NOT NULL CHECK(request_type IN('EARLY_CHECKOUT','MISSED_CHECKOUT')),
  requested_checkout TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')),
  reviewed_by UUID REFERENCES profiles(id), reviewed_at TIMESTAMPTZ, review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
UPDATE attendance_regularization_requests r SET requested_checkout=COALESCE(r.requested_checkout,a.checkout_time,(a.date::TEXT||' 18:30:00+05:30')::TIMESTAMPTZ)
FROM attendance_logs a WHERE a.id=r.attendance_id AND r.requested_checkout IS NULL;
DELETE FROM attendance_regularization_requests WHERE attendance_id IS NULL OR requested_checkout IS NULL;
ALTER TABLE attendance_regularization_requests ALTER COLUMN attendance_id SET NOT NULL;
ALTER TABLE attendance_regularization_requests ALTER COLUMN requested_checkout SET NOT NULL;
ALTER TABLE attendance_regularization_requests DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_regularization_pending ON attendance_regularization_requests(status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_regularization_one_pending
  ON attendance_regularization_requests(attendance_id,request_type) WHERE status='PENDING';

CREATE OR REPLACE FUNCTION rpc_request_attendance_regularization(
  p_user_id UUID,p_attendance_id UUID,p_request_type TEXT,p_reason TEXT,p_requested_checkout TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_att RECORD; v_id UUID; v_type TEXT:=UPPER(p_request_type); v_day_start TIMESTAMPTZ; v_day_end TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>p_user_id THEN RETURN jsonb_build_object('success',false,'error','FORBIDDEN'); END IF;
  IF v_type NOT IN('EARLY_CHECKOUT','MISSED_CHECKOUT') THEN RETURN jsonb_build_object('success',false,'error','INVALID_TYPE'); END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason))<3 THEN RETURN jsonb_build_object('success',false,'error','REASON_REQUIRED','message','Enter a reason for regularization.'); END IF;
  SELECT * INTO v_att FROM attendance_logs WHERE id=p_attendance_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ATTENDANCE_NOT_FOUND','message','Attendance record not found.'); END IF;
  v_day_start:=(v_att.date::TEXT||' 00:00:00+05:30')::TIMESTAMPTZ;
  v_day_end:=(v_att.date::TEXT||' 23:59:59+05:30')::TIMESTAMPTZ;
  IF p_requested_checkout IS NULL OR p_requested_checkout<v_att.checkin_time OR p_requested_checkout>v_day_end THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_CHECKOUT_TIME','message','Requested checkout must be after check-in and within the attendance day.');
  END IF;
  IF EXISTS(SELECT 1 FROM attendance_regularization_requests WHERE attendance_id=p_attendance_id AND request_type=v_type AND status='PENDING') THEN
    RETURN jsonb_build_object('success',false,'error','ALREADY_PENDING','message','A matching regularization request is already pending.');
  END IF;
  INSERT INTO attendance_regularization_requests(user_id,attendance_id,request_type,requested_checkout,reason)
  VALUES(p_user_id,p_attendance_id,v_type,p_requested_checkout,TRIM(p_reason)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id,'status','PENDING','message','Regularization request submitted.');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','ALREADY_PENDING','message','A matching regularization request is already pending.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error',SQLERRM,'message','Regularization request failed: '||SQLERRM);
END; $$;

CREATE OR REPLACE FUNCTION rpc_review_attendance_regularization(
  p_request_id UUID,p_admin_id UUID,p_approve BOOLEAN,p_notes TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_request RECORD; v_att RECORD; v_new_status TEXT:=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_admin_id AND UPPER(role) IN('ADMIN','SYSTEM_ADMIN','HR','HRD','HR_MANAGER') AND COALESCE(is_active,TRUE)) THEN
    RETURN jsonb_build_object('success',false,'error','FORBIDDEN','message','Only HR/admin can review regularization.');
  END IF;
  IF NOT p_approve AND (p_notes IS NULL OR LENGTH(TRIM(p_notes))<3) THEN
    RETURN jsonb_build_object('success',false,'error','REJECTION_REASON_REQUIRED','message','Enter a rejection reason.');
  END IF;
  SELECT * INTO v_request FROM attendance_regularization_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','NOT_FOUND','message','Request not found.'); END IF;
  IF v_request.status<>'PENDING' THEN RETURN jsonb_build_object('success',false,'error','ALREADY_REVIEWED','message','This request has already been reviewed.'); END IF;
  SELECT * INTO v_att FROM attendance_logs WHERE id=v_request.attendance_id AND user_id=v_request.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ATTENDANCE_NOT_FOUND','message','Linked attendance record no longer exists.'); END IF;

  IF p_approve THEN
    UPDATE attendance_logs SET checkout_time=v_request.requested_checkout,status='ADMIN_CORRECTED',checkout_source='ADMIN',
      corrected_by=p_admin_id,correction_reason=v_request.reason,undo_token=NULL,undo_expires_at=NULL,updated_at=NOW()
    WHERE id=v_request.attendance_id;
    INSERT INTO attendance_audit_logs(attendance_id,user_id,action,old_status,new_status,old_checkout_at,new_checkout_at,reason,source)
    VALUES(v_request.attendance_id,v_request.user_id,'REGULARIZATION_APPROVED',v_att.status,'ADMIN_CORRECTED',v_att.checkout_time,v_request.requested_checkout,
      v_request.reason||CASE WHEN NULLIF(TRIM(p_notes),'') IS NOT NULL THEN ' | HR: '||TRIM(p_notes) ELSE '' END,'ADMIN');
  END IF;
  UPDATE attendance_regularization_requests SET status=v_new_status,reviewed_by=p_admin_id,reviewed_at=NOW(),review_notes=NULLIF(TRIM(p_notes),'') WHERE id=v_request.id;
  RETURN jsonb_build_object('success',true,'status',v_new_status,'attendance_id',v_request.attendance_id,'message','Regularization '||LOWER(v_new_status)||'.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error',SQLERRM,'message','Regularization review failed: '||SQLERRM);
END; $$;

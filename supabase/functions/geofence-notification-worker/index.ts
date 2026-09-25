import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

serve(async (req) => {
  try {
    // 1. Get the Webhook Payload
    const payload = await req.json();
    const record = payload.record;
    
    if (!record || record.status !== 'PENDING') {
      return new Response(JSON.stringify({ message: "Ignored or not PENDING" }), { status: 200 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Fetch User's Push Token(s) from device_push_tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('device_push_tokens')
      .select('token')
      .eq('user_id', record.recipient_user_id)
      .eq('active', true);

    if (tokenError || !tokens || tokens.length === 0) {
      // Mark as error if no tokens found
      await supabase
        .from('notification_outbox')
        .update({ status: 'ERROR', error: 'No active push tokens found for user' })
        .eq('id', record.id);
      return new Response(JSON.stringify({ message: "No active push tokens found" }), { status: 200 });
    }

    // 3. Prepare Expo Push Payloads
    const pushMessages = tokens.map(t => ({
      to: t.token,
      sound: 'default',
      title: record.title || 'Attendance Alert',
      body: record.body || 'Please check your tracking status.',
      data: record.data || { geofence_event_id: record.geofence_event_id },
    }));

    // 4. Send to Expo
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pushMessages)
    });
    
    if (!response.ok) {
       const errText = await response.text();
       await supabase.from('notification_outbox').update({ status: 'ERROR', error: errText }).eq('id', record.id);
       return new Response(JSON.stringify({ error: errText }), { status: 500 });
    }

    // 5. Update Outbox Status to SENT
    await supabase
      .from('notification_outbox')
      .update({ status: 'SENT', sent_at: new Date().toISOString() })
      .eq('id', record.id);

    return new Response(JSON.stringify({ success: true, processed: pushMessages.length }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

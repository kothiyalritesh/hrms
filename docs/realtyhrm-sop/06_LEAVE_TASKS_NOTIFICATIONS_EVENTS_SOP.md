# Leave, Tasks, Notifications and Events SOP

## Leave

Employee submits through `rpc_submit_leave_request`; reviewer decides through `rpc_review_leave_request`; cancellation uses `rpc_cancel_leave_request`. Confirm status, dates, balance and review notes in the database-backed response.

## Tasks

Use hierarchy-aware task list (`rpc_my_tasks`), direct reports (`rpc_my_direct_reports`) and forwarding (`rpc_task_forward`). Do not infer edit rights from visibility.

## Notifications

Read the in-app notification row/unread count. For missing delivery, inspect outbox, delivery log, push token and Edge Function retry status. Delivery is asynchronous.

## Events

Admins create events and audience through `rpc_admin_create_event`; employees acknowledge and use `rpc_event_check_in_v2`/`rpc_event_check_out_v2`. Event attendance is separate from ordinary attendance and may calculate lateness/comp-off.


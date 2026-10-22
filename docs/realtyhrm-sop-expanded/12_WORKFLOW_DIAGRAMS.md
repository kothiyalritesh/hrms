# Workflow Diagrams

## Authentication and authorization

```mermaid
flowchart LR
  L[LoginScreen] --> A[AuthContext.requestOTP]
  A --> F[otp-auth request]
  F --> C[(otp_login_challenges)]
  L2[OTP entry] --> V[AuthContext.verifyOTP]
  V --> F2[otp-auth verify]
  F2 --> S[Supabase verifyOtp magic-link]
  S --> P[(profiles/session/device)]
  P --> G[get_my_permissions]
  G --> R[Route guard]
  R --> Q[RPC/RLS server authorization]
```

## Attendance source reconciliation

```mermaid
flowchart TD
  UI[Dashboard / Admin] --> APP[App attendance RPC]
  BIO[Device / import / webhook] --> RAW[Raw biometric punches]
  COR[Regularization / backdated correction] --> AUD[Correction + audit]
  APP --> CAN[rpc_attendance_canonical_range]
  RAW --> CAN
  AUD --> CAN
  POL[Attendance policy/auto-close] --> CAN
  CAN --> OUT[Official canonical row]
  OUT --> REPORT[UI/report/export]
```

## Offline write

```mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant O as Durable Outbox
  participant R as Replay RPC
  participant DB as Database
  U->>A: check-in/out while offline
  A->>O: idempotency key + captured GPS/time
  A-->>U: saved locally / pending sync
  O->>R: replay on network/app active/timer
  R->>DB: server validation + commit
  DB-->>R: confirmed row or permanent error
  R-->>A: confirmed / failed / dead-letter
  A-->>U: final state
```

## Field visit and evidence review

```mermaid
flowchart TD
  C[Create destination] --> CI[Server check-in/radius]
  CI --> T[Tracking/journey pings]
  T --> CO[Server checkout]
  CI --> M{Saved pin valid?}
  M -- yes --> V[Normal visit]
  M -- no --> E[Current-location declaration/GPS/photo]
  E --> P[Pending review child row]
  P --> D[Reviewer decision + audit]
```

## Permission grant

```mermaid
flowchart LR
  PM[Permission Manager] --> N[canonical key + scope + reason]
  N --> GR[grant RPC]
  GR --> AU[audit event]
  GR --> C[get_my_permissions cache refresh]
  C --> SG[screen guard]
  SG --> SR[server RPC/RLS scope]
```

## Release and incident recovery

```mermaid
flowchart TD
  PRE[Freeze commit/build metadata] --> SCH[Reconcile schema/function versions]
  SCH --> TEST[Typecheck/Jest/lint/staging tests]
  TEST --> BAK[Backup/restore evidence]
  BAK --> REL[Publish/rollback target]
  REL --> INC{Incident?}
  INC -- no --> MON[Monitor queues/audit/errors]
  INC -- yes --> EVI[Preserve redacted evidence]
  EVI --> FIX[Documented recovery or rollback]
  FIX --> VER[Server row/audit/test verification]
```


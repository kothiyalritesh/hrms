# REALTYHRM MASTER FEATURE IMPLEMENTATION ROADMAP

## PHASE 1: FOUNDATION & CORE HR (MVP)

### 1.1 Database Schema Normalization & Audit System
- [x] **Status**: Partially exists (profiles, roles, offices tables exist)
- [ ] Create `departments` table (UUID PK, name, code, parent_id self-reference, is_active, created_at)
- [ ] Create `designations` table (UUID PK, name, code, department_id, level, is_active)
- [ ] Normalize `profiles` table: add department_id, designation_id, reporting_manager_id FKs
- [ ] Create `employee_meta` table (UUID PK, employee_id FK, kyc_documents JSONB, bank_details JSONB, emergency_contacts JSONB, custom_fields JSONB)
- [ ] Create `audit_logs` table (UUID PK, table_name, record_id, action, old_values JSONB, new_values JSONB, performed_by, performed_at)
- [ ] Add soft-delete support: add `deleted_at` to all tables, create views that filter deleted records
- [ ] Add `company_id` to all tables for future multi-tenancy
- [ ] Create database triggers for automatic audit logging on INSERT/UPDATE/DELETE

### 1.2 Employee Lifecycle Management
- [x] **Status**: Basic CRUD exists in UserManagementScreen
- [ ] Enhance ProfileScreen: show full employee lifecycle (candidate → onboarded → active → exit)
- [ ] Add `employment_status` enum to profiles: CANDIDATE, ONBOARDING, ACTIVE, SUSPENDED, NOTICE_PERIOD, EXITED
- [ ] Add onboarding checklist screen (document uploads, IT asset assignments, training completions)
- [ ] Add exit workflow screen (clearance checklist, handover notes, F&F settlement trigger)

### 1.3 Document Management (KYC & Contracts)
- [x] **Status**: employee_documents table exists, DocumentsScreen exists
- [ ] Enhance DocumentsScreen: categorize by document type (KYC, CONTRACT, PAYSIP, POLICY, OTHER)
- [ ] Add document upload with S3/Supabase Storage integration
- [ ] Add document expiry tracking and notifications
- [ ] Add document approval workflow (HR verifies uploaded docs)
- [ ] Add document version control

### 1.4 Organization Hierarchy
- [x] **Status**: reporting_manager exists in profiles, roles table exists
- [ ] Create org chart visualization screen (tree view of departments and reporting lines)
- [ ] Add matrix organization support (secondary reporting manager)
- [ ] Add department-wise headcount and budget tracking
- [ ] Add designation levels and career path visualization

---

## PHASE 2: PAYROLL ENGINE (CRITICAL MODULE)

### 2.1 Salary Structure Management
- [ ] Create `salary_structures` table (UUID PK, employee_id FK, ctc_amount, effective_from, effective_to, is_active)
- [ ] Create `salary_components` table (UUID PK, structure_id FK, component_type: EARNING|DEDUCTION, name, amount, is_percentage, percentage_of, formula)
- [ ] Create admin screen: SalaryStructureScreen for configuring CTC → components breakdown
- [ ] Support formula engine: HRA = BASIC * 0.40, PF = MIN(1800, BASIC * 0.12)
- [ ] Add statutory component auto-calculation (PF, ESI, PT, TDS)

### 2.2 Payroll Run & Processing
- [ ] Create `payroll_runs` table (UUID PK, month, year, run_date, status: DRAFT|PROCESSING|COMPLETED|FAILED, processed_by, total_amount)
- [ ] Create `payslip_items` table (UUID PK, payroll_run_id, employee_id, component_id, amount)
- [ ] Create admin screen: PayrollRunScreen for monthly payroll processing
- [ ] Add cron/scheduled job logic for payroll processing (mark for backend implementation)
- [ ] Add payroll preview before finalization
- [ ] Add payroll reversal and regeneration capability

### 2.3 Payslip Generation
- [ ] Enhance PayrollScreen: show detailed component-wise breakdown
- [ ] Add PDF payslip generation (use react-native-html-to-pdf / expo-print)
- [ ] Add payslip download and share functionality
- [ ] Add payslip email delivery
- [ ] Add YTD (Year-to-Date) summary view

### 2.4 Tax & Compliance
- [ ] Create `tax_declarations` table (UUID PK, employee_id, financial_year, section_80c, section_80d, hra_exemption, other_income, total_taxable_income)
- [ ] Create TaxDeclarationScreen for employees to declare investments
- [ ] Add TDS calculation based on tax regime (old/new)
- [ ] Add Form 16 generation logic
- [ ] Add compliance reports: PF return, ESI return, PT payment

### 2.5 Reimbursements & Expense Claims
- [ ] Create `expense_claims` table (UUID PK, employee_id, category, amount, receipt_url, status, approved_by, approved_amount)
- [ ] Create ExpenseClaimScreen for employees to submit claims
- [ ] Create admin screen for approval workflow
- [ ] Add receipt upload with OCR/photo capture
- [ ] Integrate approved claims into next payroll run

---

## PHASE 3: ATTENDANCE & TIME TRACKING (ENHANCEMENT)

### 3.1 Multi-Mode Attendance
- [x] **Status**: Office geo-fenced check-in exists, basic attendance_logs exists
- [ ] Add biometric attendance integration (API ingestion endpoint: POST /api/attendance/punch)
- [ ] Add facial recognition attendance module (expo-camera integration)
- [ ] Add QR code based attendance for events/sites
- [ ] Add manual attendance override for admins with reason

### 3.2 Shift & Roster Management
- [ ] Create `shifts` table (UUID PK, name, start_time, end_time, break_duration, grace_period, night_shift_boolean)
- [ ] Create `rosters` table (UUID PK, employee_id, shift_id, week_start_date, days JSONB)
- [ ] Create admin screen: ShiftManagementScreen
- [ ] Create admin screen: RosterAssignmentScreen (bulk assign shifts)
- [ ] Add shift calendar view for employees
- [ ] Add shift swap request workflow

### 3.3 Timesheets & Project-Based Logging
- [ ] Create `timesheets` table (UUID PK, employee_id, project_id, date, hours, description, billable)
- [ ] Enhance existing TasksScreen with timesheet entry
- [ ] Add project-wise time tracking and cost allocation
- [ ] Add timesheet approval workflow (manager approval)
- [ ] Add weekly timesheet summary and submission

### 3.4 Geo-Fencing Enhancements
- [x] **Status**: Haversine formula exists, office radius check exists
- [ ] Add multiple geo-fence support per office (different buildings/zones)
- [ ] Add route tracking during field visits (GPS trail)
- [ ] Add auto check-out reminder when leaving geo-fence
- [ ] Add attendance anomaly detection (impossible travel, duplicate punches)

---

## PHASE 4: LEAVE MANAGEMENT (ENHANCEMENT)

### 4.1 Leave Policy Engine
- [x] **Status**: Basic leave types exist (sick, casual, earned, wfh), simple balance tracking exists
- [ ] Create `leave_policies` table (UUID PK, name, type, max_days, carry_forward, encashable, applicable_roles JSONB)
- [ ] Create `leave_accrual_rules` table (UUID PK, policy_id, frequency: MONTHLY|QUARTERLY|YEARLY, accrual_amount, max_balance)
- [ ] Add configurable leave policies per role/tenure
- [ ] Add leave accrual automation (monthly/quarterly credit)
- [ ] Add leave encashment calculation and workflow

### 4.2 Advanced Leave Workflows
- [x] **Status**: Basic pending→approved→rejected exists
- [ ] Enhance LeaveScreen: multi-level approval (Employee → Team Lead → Manager → HR)
- [ ] Add leave cancellation workflow (before start date)
- [ ] Add leave comp-off/auto-approval for overtime
- [ ] Add leave blacklist dates (blackout periods)
- [ ] Add half-day and quarter-day leave support
- [ ] Add LOP (Loss of Pay) automatic calculation

### 4.3 Leave Balance & Reports
- [ ] Create `leave_balances` table (UUID PK, employee_id, policy_id, accrued, used, encashed, carried_forward, year)
- [ ] Enhance leave balance display with accrual history
- [ ] Add leave utilization reports for managers
- [ ] Add leave liability report for finance

---

## PHASE 5: PERFORMANCE MANAGEMENT

### 5.1 Goal & OKR Management
- [ ] Create `goals` table (UUID PK, employee_id, title, description, category, weight, target_value, current_value, unit, start_date, end_date, status)
- [ ] Create `goal_progress` table (UUID PK, goal_id, progress_date, value, notes, evidence_url)
- [ ] Create GoalsScreen for employees to view and update goals
- [ ] Create admin screen: GoalAssignmentScreen (cascading goals)
- [ ] Add OKR alignment (individual → team → company objectives)
- [ ] Add progress tracking with visual indicators

### 5.2 Performance Reviews
- [ ] Create `review_cycles` table (UUID PK, name, type: QUARTERLY|HALF_YEARLY|ANNUAL, start_date, end_date, status)
- [ ] Create `reviews` table (UUID PK, cycle_id, employee_id, reviewer_id, review_type: SELF|MANAGER|PEER|360, status, overall_rating, comments)
- [ ] Create `review_competencies` table (UUID PK, review_id, competency_name, rating, weight, weighted_score)
- [ ] Create PerformanceReviewScreen for self-assessment
- [ ] Create ManagerReviewScreen for manager evaluations
- [ ] Add 360-degree feedback collection
- [ ] Add weighted scoring and normalization

### 5.3 Continuous Feedback
- [ ] Create `feedback` table (UUID PK, from_employee_id, to_employee_id, type: PRAISE|IMPROVEMENT|GENERAL, content, is_anonymous, created_at)
- [ ] Create FeedbackScreen for giving/receiving feedback
- [ ] Add real-time feedback notifications
- [ ] Add feedback summary dashboard

---

## PHASE 6: RECRUITMENT & ATS

### 6.1 Job Management
- [ ] Create `jobs` table (UUID PK, title, department_id, designation_id, location, description, requirements, salary_range, openings, status: DRAFT|OPEN|ON_HOLD|CLOSED, created_by, created_at)
- [ ] Create admin screen: JobPostingScreen (CRUD for job openings)
- [ ] Add job publishing to internal portal and external boards
- [ ] Add job duplicate/clone functionality

### 6.2 Candidate Pipeline
- [ ] Create `candidates` table (UUID PK, name, email, phone, resume_url, source, current_ctc, expected_ctc, notice_period, status: NEW|SCREENING|INTERVIEW|OFFER|HIRED|REJECTED|ON_HOLD)
- [ ] Create `applications` table (UUID PK, job_id, candidate_id, applied_date, status, current_stage, next_action, assigned_recruiter)
- [ ] Create `interviews` table (UUID PK, application_id, interviewer_id, scheduled_at, mode, feedback, rating, status)
- [ ] Create RecruitmentDashboardScreen (kanban pipeline view)
- [ ] Create CandidateDetailScreen (profile + timeline)
- [ ] Add interview scheduling with calendar integration
- [ ] Add resume parsing (basic NLP/regex for name, email, skills extraction)

### 6.3 Offer Management
- [ ] Create `offers` table (UUID PK, application_id, ctc, joining_date, expiry_date, status: DRAFT|SENT|ACCEPTED|REJECTED|NEGOTIATING, sent_at, accepted_at)
- [ ] Create OfferLetterScreen (generate offer letter PDF)
- [ ] Add offer approval workflow (HR → Hiring Manager → Business Head)
- [ ] Add offer negotiation tracking

---

## PHASE 7: EMPLOYEE ENGAGEMENT

### 7.1 Surveys & Polls
- [ ] Create `surveys` table (UUID PK, title, description, type: SURVEY|POLL|QUIZ, anonymous, start_date, end_date, created_by)
- [ ] Create `survey_questions` table (UUID PK, survey_id, question_text, type: RATING|TEXT|SINGLE_CHOICE|MULTI_CHOICE, options JSONB, required, order_index)
- [ ] Create `survey_responses` table (UUID PK, survey_id, employee_id, submitted_at)
- [ ] Create `survey_answers` table (UUID PK, response_id, question_id, answer_value)
- [ ] Create SurveyListScreen (available surveys)
- [ ] Create SurveyDetailScreen (take survey)
- [ ] Create admin screen: SurveyBuilderScreen
- [ ] Add survey results analytics and charts

### 7.2 Recognition & Rewards
- [ ] Create `recognitions` table (UUID PK, from_employee_id, to_employee_id, badge_type, message, points, is_public, created_at)
- [ ] Create `badges` table (UUID PK, name, icon, description, points_value, criteria)
- [ ] Create `reward_catalog` table (UUID PK, name, description, points_cost, image_url, quantity)
- [ ] Create `reward_redemptions` table (UUID PK, employee_id, reward_id, points_used, status, redeemed_at)
- [ ] Create RecognitionFeedScreen (social feed of recognitions)
- [ ] Create BadgeCollectionScreen (my badges)
- [ ] Create RewardStoreScreen (redeem points)

### 7.3 Sentiment Analysis
- [ ] Add basic sentiment scoring to survey text responses
- [ ] Add employee sentiment dashboard (aggregated happiness index)
- [ ] Add pulse survey (1-question daily/weekly mood check)
- [ ] Add sentiment trend charts

---

## PHASE 8: WORKFLOW AUTOMATION

### 8.1 Event System
- [ ] Create `event_definitions` table (UUID PK, event_name, description, category)
- [ ] Create `workflow_rules` table (UUID PK, name, event_id, condition JSONB, actions JSONB, is_active, priority)
- [ ] Create `workflow_executions` table (UUID PK, rule_id, trigger_event_id, status, executed_at, result)
- [ ] Create admin screen: WorkflowBuilderScreen

### 8.2 Trigger → Action Engine
- [ ] Implement core event triggers:
  - leave.approved → notify_manager + update_balance + log_audit
  - attendance.late → notify_hr + mark_for_review
  - employee.onboarded → create_default_leave_balance + send_welcome_email
  - payroll.processed → send_payslip_notification
- [ ] Add notification actions (push, email, SMS)
- [ ] Add data update actions (update table, calculate field)
- [ ] Add webhook actions (POST to external URL)

### 8.3 Queue System Integration
- [ ] Add Redis/Bull queue integration for background job processing
- [ ] Add retry logic for failed workflow executions
- [ ] Add workflow execution logs and monitoring

---

## PHASE 9: ANALYTICS & REPORTING

### 9.1 HR Dashboards
- [ ] Create `hr_metrics` materialized view (precomputed daily metrics)
- [ ] Create `employee_count` metric (total, active, by department, by role)
- [ ] Create `attrition_rate` metric (monthly, quarterly, yearly)
- [ ] Create `attendance_rate` metric (department-wise, trend)
- [ ] Create `leave_utilization` metric (type-wise, department-wise)
- [ ] Create AnalyticsDashboardScreen with charts (using react-native-chart-kit)

### 9.2 Pre-built Reports
- [ ] Add Headcount Report (with filters: department, role, date range)
- [ ] Add Attendance Report (daily, monthly, with absenteeism analysis)
- [ ] Add Leave Report (balance, usage, encashment)
- [ ] Add Payroll Report (cost center, component-wise, variance)
- [ ] Add Recruitment Report (time-to-hire, source effectiveness, funnel)
- [ ] Add Performance Report (rating distribution, completion rate)

### 9.3 Data Export
- [ ] Add CSV/Excel export for all reports
- [ ] Add PDF report generation
- [ ] Add scheduled report delivery (email)

---

## PHASE 10: EMPLOYEE SELF-SERVICE (ESS) PORTAL

### 10.1 Profile Management
- [x] **Status**: Basic ProfileScreen exists
- [ ] Enhance ProfileScreen: edit personal details, contact info, bank details
- [ ] Add profile photo upload and crop
- [ ] Add emergency contact management
- [ ] Add dependent/family member information

### 10.2 Document Access
- [x] **Status**: DocumentsScreen exists
- [ ] Enhance DocumentsScreen: view and download own documents
- [ ] Add document request workflow (request letters, certificates)

### 10.3 Self-Service Actions
- [ ] Add attendance regularization request (missed punch correction)
- [ ] Add shift preference request
- [ ] Add comp-off request for extra hours worked
- [ ] Add resignation submission workflow
- [ ] Add helpdesk/ticket creation for HR queries

---

## PHASE 11: INTEGRATIONS

### 11.1 API-First Architecture
- [ ] Create standardized API response format
- [ ] Add API versioning (v1, v2)
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Add API rate limiting middleware
- [ ] Add API key management for external consumers

### 11.2 Webhooks
- [ ] Create `webhooks` table (UUID PK, name, url, events JSONB, secret, is_active)
- [ ] Create `webhook_deliveries` table (UUID PK, webhook_id, event_name, payload, status, response_status, delivered_at)
- [ ] Implement webhook retry mechanism (exponential backoff)
- [ ] Create admin screen: WebhookManagementScreen

### 11.3 Third-Party Integrations
- [ ] Add CRM integration (push employee data to CRM on creation)
- [ ] Add accounting software integration (Tally, Zoho Books)
- [ ] Add biometric device integration (eSSL, Matrix)
- [ ] Add email service integration (SendGrid, AWS SES)
- [ ] Add SMS gateway integration (Twilio, Exotel)
- [ ] Add cloud storage integration (AWS S3, Google Cloud Storage)

---

## PHASE 12: SYSTEM HARDENING & SCALE

### 12.1 RBAC Enhancement
- [x] **Status**: Basic role check exists in AuthContext
- [ ] Create `permissions` table (UUID PK, name, resource, action, description)
- [ ] Create `role_permissions` table (UUID PK, role_id, permission_id)
- [ ] Implement fine-grained permission checks in all screens
- [ ] Add role-based menu filtering
- [ ] Add data-level permissions (manager sees only team data)

### 12.2 Multi-Tenancy
- [ ] Add `companies` table (UUID PK, name, domain, settings JSONB, subscription_plan)
- [ ] Add company isolation to all queries
- [ ] Add subdomain-based routing
- [ ] Add white-labeling support (logo, colors, branding)

### 12.3 Performance Optimization
- [ ] Add Redis caching layer for frequent queries
- [ ] Add database indexing strategy for all foreign keys and search fields
- [ ] Add pagination to all list APIs (cursor-based)
- [ ] Add query optimization for large datasets
- [ ] Add connection pooling configuration

### 12.4 Security Hardening
- [ ] Add JWT token refresh mechanism
- [ ] Add device binding for sensitive operations
- [ ] Add brute force protection (login attempts)
- [ ] Add data encryption at rest for sensitive fields
- [ ] Add GDPR/data privacy compliance features

---

## CURRENT EXISTING FEATURES (Already Implemented)

| Module | Feature | Status |
|--------|---------|--------|
| Auth | Custom phone/password login | ✅ |
| Auth | Role-based access (basic) | ✅ |
| Core HR | Employee CRUD | ✅ |
| Core HR | Roles & Offices | ✅ |
| Core HR | Reporting manager | ✅ |
| Attendance | Geo-fenced check-in/out | ✅ |
| Attendance | Office selection | ✅ |
| Attendance | Calendar view | ✅ |
| Attendance | Location monitoring | ✅ |
| Leave | Apply leave | ✅ |
| Leave | Balance tracking (basic) | ✅ |
| Leave | Approval workflow (basic) | ✅ |
| Payroll | Basic payslip view | ✅ |
| Payroll | YTD earnings | ✅ |
| Documents | Document upload (basic) | ✅ |
| Tasks | Task assignment | ✅ |
| Field Visit | Visit logging | ✅ |
| Field Visit | GPS tracking | ✅ |
| Admin | Dashboard with stats | ✅ |
| Admin | User management | ✅ |
| Admin | Attendance control | ✅ |
| Admin | Leave management | ✅ |
| Admin | Activity analysis | ✅ |
| Admin | Office settings | ✅ |
| Notifications | Push notifications | ✅ |
| Activity Logs | Meeting/site visit logging | ✅ |
| Activity Logs | AI analysis (basic) | ✅ |

---

## IMPLEMENTATION PRIORITY ORDER

### Sprint 1-2: Foundation
1. Database schema normalization (departments, designations, audit_logs)
2. Employee lifecycle states
3. Enhanced document management

### Sprint 3-4: Payroll Engine
4. Salary structure configuration
5. Payroll run processing
6. Payslip PDF generation
7. Tax declaration module

### Sprint 5-6: Attendance & Leave Enhancement
8. Shift & roster management
9. Timesheets
10. Leave policy engine
11. Multi-level leave approval

### Sprint 7-8: Performance & Recruitment
12. Goal/OKR management
13. Performance reviews
14. Job postings
15. Candidate pipeline
16. Interview management

### Sprint 9-10: Engagement & Automation
17. Surveys & polls
18. Recognition & badges
19. Workflow automation engine
20. Event-driven triggers

### Sprint 11-12: Analytics & Integrations
21. Analytics dashboards
22. Pre-built reports
23. API gateway
24. Webhooks
25. Third-party integrations

---

## TECHNICAL NOTES

- **Frontend**: React Native (Expo) with TypeScript
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Auth**: Custom auth (profiles table, NOT Supabase Auth)
- **Storage**: Supabase Storage (S3-compatible)
- **Queue**: Redis / Bull (for background jobs)
- **Charts**: react-native-chart-kit / victory-native
- **PDF**: react-native-html-to-pdf / expo-print
- **Maps**: react-native-maps
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **State Management**: React Context (currently), consider Zustand/Redux for scale


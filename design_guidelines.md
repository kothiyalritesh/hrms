# Real Estate HRMS Mobile App - Design Guidelines

## Authentication & Onboarding

**Firebase Auth**: Email/password (verified), Google Sign-In, OTP phone auth

**Flow**: Welcome → Login/Signup → Profile completion (admin creates accounts) → KYC upload (PAN/Aadhaar) → Team assignment

**Account Management**: Editable profile (name, phone, address, emergency contact), change password, logout with confirmation, delete account (Settings > Account > Delete, double confirm)

## User Roles & Navigation

**4 Roles**: Employee (attendance, leave, tasks, docs) | HR (employee mgmt, approvals, payroll) | Manager (team tasks, reports) | Admin (full access, employee creation, projects)

**Employee**: Bottom tabs (Dashboard, Tasks, Attendance, Profile) + FAB for check-in

**HR/Manager/Admin**: Drawer nav (Dashboard, Employee Mgmt, Reports, Approvals, Tasks, Payroll, Projects, Analytics, Notifications, Settings) + 3 bottom tabs (Dashboard, Tasks, Profile)

## Screen Layouts

### Common Pattern
- **Header**: Custom transparent OR default nav
- **Insets**: Top (headerHeight + Spacing.xl), Bottom (tabBarHeight + Spacing.xl)
- **Content**: ScrollView or FlatList

### Key Screens

**Dashboard**
- Header: Menu/logo left, notification bell (badged) right, "Good Morning, [Name]"
- 2-column status cards: Attendance, tasks pending, leave balance, site visits
- RE KPIs (sales): Leads, deals, site visits
- Quick actions: Mark attendance, apply leave, upload doc
- Activity feed, upcoming events

**Attendance**
- Filter icon right (monthly/weekly toggle)
- Large check-in/out button (geo-location + selfie camera)
- Map preview (current vs office/site location)
- Color-coded calendar: present/absent/late/WFH
- Summary: Present days, absent, late marks, overtime

**Leave Application**
- Leave balance indicator right
- Form: Type dropdown (Sick/Casual/Earned/WFH), date range, reason (multi-line), doc upload
- Primary submit button at bottom
- History list: status badges (Pending/Approved/Rejected), dates, reason

**Tasks**
- Search bar (collapsible), filter by status/priority right
- Task cards: Title, deadline, priority badge (High/Med/Low), assignee avatar, status
- Swipe actions: Complete, update, view details
- FAB (managers only): Create task, bottom right, inset (insets.bottom + Spacing.xl)
- Detail modal: Full info, status dropdown, location/image upload, comments

**Payroll**
- Current month highlighted: Gross, deductions, net pay, download PDF
- History (expandable monthly cards)
- Reimbursements: Pending/approved, upload button

**Documents**
- Upload icon right
- Categories: Personal (PAN/Aadhaar), HR (offer/appointment), Property (sales), Certificates
- Cards: Icon, name, date, size, view/delete
- Upload modal: File picker, category, description

**RE Projects Directory**
- Search bar, filter (location/price/status) right
- 2-column grid or vertical list
- Cards: Image, name, location, price, availability badge
- Detail: Image carousel, pricing, amenities, map (Google Maps), brochure PDF, contact

**Profile & Settings**
- Avatar with edit (camera overlay)
- Fields: Name, phone, email, address, emergency contact
- Sections: Personal, Work, Preferences, Account
- Toggles: Notifications, dark mode
- Actions: Change password, logout, delete account (destructive)

**Admin Employee Management** (no tabs)
- Search bar, filters (role/dept/status)
- Employee cards: Avatar, name, role badge, dept, contact
- FAB: Add employee
- Detail modal: Full profile, edit, role/dept assignment, deactivate

## Design System

### Colors
**Primary**: #1E40AF (deep blue), Light #3B82F6, Dark #1E3A8A  
**Neutral**: Background #F9FAFB, Surface #FFFFFF, Border #E5E7EB, Text #111827, Secondary text #6B7280  
**Accent**: Success #10B981, Warning #F59E0B, Error #EF4444, Info #3B82F6  
**Status Badges**: Approved (#DCFCE7 bg, #16A34A text), Pending (#FEF3C7 bg, #D97706 text), Rejected (#FEE2E2 bg, #DC2626 text)

### Typography
**Font**: System (SF/Roboto)  
**H1**: 28px Bold, 34px line | **H2**: 22px SemiBold, 28px line | **H3**: 18px SemiBold, 24px line  
**Body**: 16px Regular, 24px line | **Small**: 14px Regular, 20px line | **Caption**: 12px Regular, 16px line

### Spacing
xs:4px | sm:8px | md:12px | lg:16px | xl:24px | 2xl:32px | 3xl:48px

### Components

**Cards**: White bg, 12px radius, 16px padding, 1px solid #E5E7EB border, no shadow. Press: opacity 0.7

**Buttons**  
Primary: #1E40AF bg, white text, 8px radius, 12px vertical/16px horizontal padding  
Secondary: #F3F4F6 bg, #1E40AF text  
Destructive: #EF4444 bg, white text  
Icon: 40x40px target, centered. Press: opacity 0.8

**FAB**: 56x56px, primary bg, white icon (24px), 28px radius, bottom right (16px from edge, insets.bottom + 16px)  
Shadow: offset {0,2}, opacity 0.10, radius 2, elevation 4 (Android)

**Forms**: 48px height, 1px #D1D5DB border, 8px radius, 12px horizontal padding  
Focus: #1E40AF border, 2px width | Error: #EF4444 border, helper text below

**Lists**: 1px #F3F4F6 separator, 16px padding. Pull-to-refresh: primary color

**Tab Bar**: 60px (iOS)/56px (Android) height, white bg, active #1E40AF, inactive #9CA3AF, 1px #E5E7EB top border

**Drawer**: 80% width (max 320px), white bg, primary header with avatar/name, 48px menu items, press bg #F3F4F6

### Interactions

**Touch Feedback**: Buttons (opacity 0.8), cards (opacity 0.7, scale 0.98), list items (bg #F3F4F6)

**Loading**: Skeleton screens (grey boxes), inline spinners (primary), pull-to-refresh

**Animations**: Slide right (iOS)/fade (Android) transitions, modal slide from bottom, list fade-in, tab crossfade

**Gestures**: Swipe left (quick actions), pull-to-refresh, pinch-zoom (images)

### Accessibility

**Touch Targets**: 44x44px (iOS), 48x48px (Android)  
**Contrast**: WCAG AA (4.5:1 text, 3:1 interactive)  
**Screen Readers**: Labels on all interactive elements, hints on forms, status announcements  
**Dynamic Type**: Support iOS/Android font scaling  
**Focus**: 2px primary border for keyboard nav

### Assets

**Icons**: Feather icons (@expo/vector-icons), 24px default

**Required**:
- App icon: Building silhouette, primary blue
- Splash: Company logo, white bg
- Empty states: Checklist (no tasks), building (no projects), folder (no docs) in primary
- Welcome: Office/team illustration, primary colors
- Avatars: 8 presets, geometric RE patterns (buildings/keys/locations), primary palette

**Doc Icons**: Card (PAN), ID (Aadhaar), Award (certs), File-text (property), Dollar (salary)

**No emojis** - Feather or custom SVG only

---
**Token count optimized. All critical specs, patterns, and standards preserved for frontend implementation.**
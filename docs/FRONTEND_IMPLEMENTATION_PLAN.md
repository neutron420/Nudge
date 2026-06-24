# Nudge Mobile App — Frontend Implementation Plan

**Document status:** Ready for implementation  
**Target:** Expo SDK 56, React Native, TypeScript, Expo Router  
**Platforms:** Android and iOS first; responsive web is secondary  
**Product goal:** Make creating and trusting reminders fast enough that users never feel the need to use another app.

---

## 1. Product Structure

The app should use:

- **4 persistent bottom tabs**
- **1 central create action**
- **17 route-level screens**
- **7 reusable bottom sheets**
- Stack navigation for authentication, onboarding, event details, forms, and settings

The central create action should visually sit above the tab bar, but it should open a stack route instead of behaving like a fifth tab. This keeps navigation stable and makes event creation feel primary.

### Bottom tabs

| Tab | Purpose | Default route |
|---|---|---|
| Home | Today's schedule, next reminder, overdue items, quick actions | `/(app)/(tabs)/home` |
| Events | Upcoming/past events with list and calendar modes | `/(app)/(tabs)/events` |
| Notifications | Delivery history, failed reminders, notification status | `/(app)/(tabs)/notifications` |
| Profile | Account, timezone, notification settings, sessions | `/(app)/(tabs)/profile` |

### Central create action

- A floating `+` button should be positioned in the middle of the tab bar.
- It opens `/event/new`.
- It is not a tab and should not preserve a separate navigation stack.
- Long press may later offer quick templates, but this is not required for v1.

---

## 2. Complete Screen Inventory

### Authentication and onboarding — 6 screens

| # | Screen | Route | Main responsibility |
|---|---|---|---|
| 1 | App Bootstrap | `/` | Restore the secure session, refresh tokens, and route to auth or the app |
| 2 | Welcome | `/(auth)/welcome` | Product introduction, Google sign-in, email sign-in, sign-up entry |
| 3 | Sign In | `/(auth)/sign-in` | Email/password login and Google login |
| 4 | Sign Up | `/(auth)/sign-up` | Name, email, password, timezone, terms acceptance |
| 5 | Forgot Password | `/(auth)/forgot-password` | Request a password reset email |
| 6 | First-Time Setup | `/(onboarding)/setup` | Confirm timezone and explain/ask for notification permission |

Google-created accounts skip password entry. A newly created Google user still visits First-Time Setup so timezone and notification permissions are configured correctly.

### Main application — 11 screens

| # | Screen | Route | Main responsibility |
|---|---|---|---|
| 7 | Home Dashboard | `/(app)/(tabs)/home` | Today, next reminder, overdue events, quick create |
| 8 | Events | `/(app)/(tabs)/events` | Search, filter, list/calendar toggle, upcoming and completed events |
| 9 | Notifications | `/(app)/(tabs)/notifications` | Push delivery history, failures, retry status |
| 10 | Profile | `/(app)/(tabs)/profile` | Account overview and settings navigation |
| 11 | Event Details | `/(app)/event/[id]` | Full event, reminders, status, edit/delete/complete actions |
| 12 | Create Event | `/(app)/event/new` | Create an event and one or more reminders |
| 13 | Edit Event | `/(app)/event/[id]/edit` | Edit event fields and reconcile reminders |
| 14 | Edit Profile | `/(app)/settings/profile` | Name, avatar, and timezone |
| 15 | Notification Settings | `/(app)/settings/notifications` | Permission status, reminder defaults, push preferences |
| 16 | Devices and Sessions | `/(app)/settings/sessions` | Current device, other active sessions, remote logout |
| 17 | Help and About | `/(app)/settings/about` | App version, privacy, terms, support, diagnostics |

Total route-level screens: **17**.

---

## 3. Screen Specifications

### 3.1 App Bootstrap

The bootstrap screen should show the branded splash while it:

1. Reads the refresh token and session ID from `expo-secure-store`.
2. Calls the refresh endpoint when a stored session exists.
3. Loads the current user.
4. Registers or refreshes the push token after authentication.
5. Routes to:
   - Welcome when no session exists.
   - First-Time Setup when timezone or notification onboarding is incomplete.
   - Home when the session is valid.

If refresh fails because the session is expired or revoked, clear local auth data and route to Welcome. Network failure should show a retry state rather than silently logging the user out.

### 3.2 Welcome

Contents:

- Logo and short product promise
- Primary “Continue with Google” button
- Secondary “Sign in with email” button
- “Create account” link
- Terms and Privacy links

The Google button begins native Google authentication, receives an ID token, sends it to the backend, and stores only Nudge's returned tokens.

### 3.3 Sign In

Fields and actions:

- Email
- Password with visibility toggle
- Forgot password
- Sign in
- Divider
- Continue with Google
- Link to Sign Up

Validation should be immediate but not noisy. Server errors should be mapped to user-readable states such as invalid credentials, inactive account, rate limit, or network unavailable.

### 3.4 Sign Up

Fields:

- Full name
- Email
- Password
- Confirm password
- Auto-detected timezone with edit action
- Terms acceptance

Password requirements should be visible before submission. A successful registration creates a 30-day session and takes the user to First-Time Setup.

### 3.5 First-Time Setup

Use a short two-step pager inside one route:

1. **Timezone**
   - Auto-detected IANA timezone
   - Searchable timezone picker
   - Explanation that events are stored as instants but displayed locally
2. **Notifications**
   - Explain why reminders need permission
   - Ask for OS permission only after the user taps “Enable notifications”
   - Allow “Not now,” but surface a persistent warning on Home

---

## 4. Main Tab Specifications

### 4.1 Home

Sections, in order:

1. Greeting and current date
2. Notification health banner when permission/token registration is unhealthy
3. Next event hero card with countdown
4. Today timeline
5. Overdue or failed reminders
6. Upcoming events preview
7. Quick-create chips such as Exam, Interview, Meeting, and Personal

States:

- First-use empty state
- Today is empty, but upcoming events exist
- Offline cached state
- Loading skeleton
- API failure with retry
- Notification permission disabled

### 4.2 Events

Header controls:

- Search
- Filter button
- List/calendar segmented control

List mode groups:

- Today
- Tomorrow
- This week
- Later
- Completed

Calendar mode:

- Month selector
- Dots/badges for dates with events
- Selected-day agenda below the calendar

Event cards show type, title, start time, location, reminder count, and status. Swipe actions may expose Complete and Delete, but destructive actions require confirmation.

### 4.3 Notifications

This tab is a delivery and reliability center, not a generic social inbox.

Sections:

- Failed or exhausted reminders at the top
- Today
- Earlier

Each item displays:

- Event title
- Intended reminder time
- Delivery status
- Device name when available
- Attempt number
- Error summary for failed sends

Actions:

- Open related event
- Retry failed reminder when the backend permits it
- Fix notification settings
- Pull to refresh

Unread badges require a future `readAt` or notification-inbox model. Until that exists, the tab badge should represent failed reminders rather than unread history.

### 4.4 Profile

Sections:

- Avatar, name, and email
- Edit profile
- Notification settings
- Timezone
- Devices and sessions
- Help and About
- Logout

Logout should revoke only the current session and deactivate the current device token. “Log out all devices” belongs in Devices and Sessions.

---

## 5. Event Creation and Editing

The form should be one scrollable screen with progressive disclosure.

### Required fields

- Title
- Event type
- Start date and time
- Timezone

### Optional fields

- End date and time
- All-day toggle
- Location
- Description/notes

### Reminder section

Default quick options:

- At event time
- 10 minutes before
- 30 minutes before
- 1 hour before
- 1 day before
- Custom

Users may add multiple reminders. Duplicate reminder times must be blocked locally and are also blocked by the database unique constraint.

Validation:

- End must not precede start.
- Reminder offset cannot be negative.
- A reminder cannot resolve to an invalid timestamp.
- Warn when a newly created reminder time is already in the past.
- Display all stored times in the selected event timezone.

On save:

- Disable duplicate submissions.
- Use one backend transaction for the event and reminders.
- Show a success confirmation and route to Event Details.
- If offline mutation support is enabled, clearly mark the event as “Waiting to sync.”

---

## 6. Bottom Sheets

Use one shared bottom-sheet component with snap points, safe-area handling, keyboard avoidance, drag-to-dismiss rules, and accessibility focus management.

| # | Bottom sheet | Used by | Contents |
|---|---|---|---|
| 1 | Event Type Picker | Create/Edit Event | Searchable event-type grid |
| 2 | Reminder Picker | Create/Edit Event | Presets, custom amount/unit, validation |
| 3 | Event Filter and Sort | Events | Status, type, date range, sort order |
| 4 | Timezone Picker | Sign Up, Onboarding, Profile, Event form | Searchable IANA timezone list |
| 5 | Event Quick Actions | Event cards/details | Edit, complete, duplicate later, delete |
| 6 | Notification Permission Help | Home, Settings | Current OS state and route to system settings |
| 7 | Session Actions | Devices and Sessions | Session details and revoke action |

Date and time selection should use platform-native pickers or a tested Expo-compatible component rather than a custom bottom sheet.

---

## 7. Push Notification Architecture

### Permission and token lifecycle

1. Explain the benefit before showing the native permission prompt.
2. Request permission during First-Time Setup or from Notification Settings.
3. Obtain the platform push token/FCM token.
4. Send it to `POST /api/v1/notifications/device-token`.
5. Refresh registration:
   - after login
   - when the app returns to foreground
   - when the token changes
6. Deactivate the token on logout.

### Notification handling

| App state | Expected behavior |
|---|---|
| Foreground | Show an in-app banner and update relevant cached queries |
| Background | OS displays the push; tapping opens Event Details |
| Terminated | Bootstrap auth, then deep-link to Event Details |

Payload should contain stable routing data:

```json
{
  "type": "REMINDER",
  "eventId": "event-uuid",
  "reminderId": "reminder-uuid"
}
```

Do not trust notification title/body as source-of-truth data. Fetch the event after opening.

### Android notification channels

Create at least:

- `reminders-high`: high importance, sound and vibration
- `reminders-default`: normal reminders
- `system`: account and service notices

### Notification health

The app should calculate and display:

- OS permission state
- Whether a current active device token is registered
- Last successful token registration time
- Recent failed reminder count

### Local notifications

For v1, the server remains the source of truth. Local notifications may later be added as a backup, but only with a reconciliation strategy to prevent duplicate alerts.

---

## 8. State, Networking, and Storage

Recommended responsibilities:

- **TanStack Query:** server state, caching, invalidation, retries
- **Zustand:** small client-only UI/session state
- **React Hook Form + Zod:** forms and shared validation
- **expo-secure-store:** refresh token and session identifier
- **AsyncStorage:** non-sensitive preferences and optional offline mutation queue
- **Axios or typed fetch wrapper:** HTTP client and token refresh coordination

Never store refresh tokens in AsyncStorage.

### Token refresh behavior

- Access token: short-lived and held in memory.
- Refresh token: encrypted in SecureStore.
- On `401`, perform one coordinated refresh request.
- Queue concurrent failed requests while refresh is running.
- Retry each request once.
- If refresh fails, clear the session and route to Welcome.

---

## 9. Suggested Folder Structure

```text
apps/user-app/src/
  app/
    _layout.tsx
    index.tsx
    (auth)/
      _layout.tsx
      welcome.tsx
      sign-in.tsx
      sign-up.tsx
      forgot-password.tsx
    (onboarding)/
      setup.tsx
    (app)/
      _layout.tsx
      (tabs)/
        _layout.tsx
        home.tsx
        events.tsx
        notifications.tsx
        profile.tsx
      event/
        new.tsx
        [id].tsx
        [id]/
          edit.tsx
      settings/
        profile.tsx
        notifications.tsx
        sessions.tsx
        about.tsx
  components/
    common/
    events/
    notifications/
    sheets/
  features/
    auth/
    dashboard/
    events/
    notifications/
    profile/
  lib/
    api/
    auth/
    notifications/
    storage/
  providers/
  stores/
  theme/
  types/
```

---

## 10. Design System

Define tokens before building screens:

- Brand, success, warning, danger, and neutral colors
- Light and dark themes
- Typography scale
- 4/8-point spacing system
- Border radii
- Shadows/elevation
- Minimum 44x44 touch targets

Core reusable components:

- Button
- IconButton
- TextField
- PasswordField
- SearchField
- SelectRow
- EventCard
- ReminderChip
- StatusBadge
- EmptyState
- ErrorState
- Skeleton
- InAppBanner
- BottomSheet
- ConfirmationDialog

Accessibility:

- Semantic labels for all icons
- Dynamic font support
- Sufficient color contrast
- Do not communicate status using color alone
- Screen-reader announcements for form errors and save results

---

## 11. API-to-Screen Mapping

| Screen | Required APIs |
|---|---|
| Bootstrap | `POST /auth/refresh`, `GET /auth/me` |
| Sign In | `POST /auth/login`, `POST /auth/google` |
| Sign Up | `POST /auth/register` |
| Forgot Password | `POST /auth/forgot-password` |
| Home | `GET /dashboard` |
| Events | `GET /events`, `GET /events/upcoming` |
| Event Details | `GET /events/:id` |
| Create Event | `POST /events` |
| Edit Event | `PATCH /events/:id` |
| Notifications | `GET /notifications/history` |
| Notification Settings | Profile/preferences endpoint plus device-token APIs |
| Profile | `GET /auth/me`, `PATCH /auth/me` |
| Sessions | `GET /auth/sessions`, session revoke endpoints |

Several auth/session/preference endpoints are additions to the original HLD and are specified in the backend plan.

---

## 12. Implementation Phases

### Phase 1 — Foundation

- Replace starter Expo UI
- Add route groups and providers
- Add design tokens and reusable primitives
- Add API client and environment configuration

### Phase 2 — Authentication

- Email registration/login
- Google login
- Secure 30-day session restoration
- Token refresh and logout
- First-Time Setup

### Phase 3 — Event core

- Home dashboard
- Event list and details
- Create/edit/delete/complete
- Multiple reminders

### Phase 4 — Notifications

- Permission onboarding
- Device-token registration
- Foreground/background/deep-link handling
- Notification history and failure states

### Phase 5 — Reliability and polish

- Offline read cache
- Optional mutation queue
- Accessibility
- Analytics and crash reporting
- Unit, integration, and end-to-end tests

---

## 13. Frontend Definition of Done

- All 17 routes work on Android and iOS.
- The four-tab navigation and central create action are stable.
- Email and Google authentication create 30-day sessions.
- Tokens are stored securely and rotate correctly.
- Events and reminders support all loading, empty, error, and offline states.
- Push permission, registration, receipt, and deep links are tested on real devices.
- Logout revokes the current session and device token.
- No sensitive values appear in logs or AsyncStorage.
- Accessibility checks and critical end-to-end flows pass.

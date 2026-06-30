# Nudge Project: Complete Production & Integration Guide

This guide outlines the remaining tasks, configurations, and integrations required to take the Nudge application from local development to a fully production-ready, feature-complete state.

---

## 1. Frontend & Mobile App Integration (`apps/user-app`)
The core API endpoints and background scheduler are fully operational. The frontend React Native/Expo app needs to be connected to these endpoints.

### Authentication Integration
- [ ] **Google Sign-In Wrapper:** Update Google Login components in the Expo app to forward the identity token to `POST /api/v1/auth/google`.
- [ ] **JWT Storage:** Store access and refresh tokens securely on the device using `expo-secure-store`.
- [ ] **Interceptors:** Configure an Axios or Fetch HTTP client wrapper with request interceptors to append the `Authorization: Bearer <token>` header.
- [ ] **Token Rotation Client-Side:** Add response interceptors that intercept `401 Unauthorized` responses, fetch a new access token using `POST /api/v1/auth/refresh`, and transparently retry the failed request.

### Events & Dashboard Integration
- [ ] **Dashboard Syncing:** Bind dashboard stats (`GET /api/v1/dashboard`) to the home screen.
- [ ] **Offline Cache:** Store lists of active events locally using AsyncStorage or SQLite for instant rendering on boot.
- [ ] **Device Token Registration:** Call `POST /api/v1/notifications/devices` upon successful user login to link the device's FCM token with their account.

---

## 2. Push Notification Production Setup
The backend currently runs FCM pushes in a fallback **SIMULATOR** mode because Firebase environment variables are not set.

- [ ] **Create Firebase Project:** Go to the [Firebase Console](https://console.firebase.google.com/) and create a project.
- [ ] **Generate Service Account Private Key:** Under Project Settings -> Service Accounts, generate a new Node.js private key.
- [ ] **Set Environment Variables:** Add the following variables to `apps/backend/.env` on your server:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY` (ensure newline characters `\n` are escaped properly in your env runner).

---

## 3. CI/CD Pipeline Configuration
To keep the codebase stable as new features are added:

- [ ] **GitHub Actions Workflow:** Add a `.github/workflows/ci.yml` file to the root of the workspace.
- [ ] **Build Verification:** Configure steps to install workspace dependencies, compile the database package, build the backend, and run the Vitest test suite on every pull request to `main`:
  ```yaml
  name: CI Pipeline
  on: [push, pull_request]
  jobs:
    build-and-test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: 'npm'
        - run: npm ci
        - run: npm run build
        - run: npm run test --workspace=backend
          env:
            DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
            JWT_ACCESS_SECRET: ${{ secrets.TEST_JWT_ACCESS_SECRET }}
            JWT_REFRESH_SECRET: ${{ secrets.TEST_JWT_REFRESH_SECRET }}
  ```

---

## 4. Production Deployment & Monitoring

### Database Tuning (Neon Connection Pooler)
- [ ] **Pool Connection Optimization:** For high-throughput scenarios, configure database connections using the Neon Transaction Pooler URL (usually port `5432` or pooler domain prefixes) to prevent depleting open database connection slots.

### Process Management
- [ ] **Process Control (PM2):** Deploy the backend on your server using PM2 or Docker. This guarantees the backend process automatically restarts if it encounters an uncaught exception:
  ```bash
  pm2 start dist/server.js --name nudge-backend
  ```

### Reverse Proxy & SSL/TLS
- [ ] **Nginx Reverse Proxy:** Route HTTP requests from port `80/443` to our local Express app (port `5000` by default).
- [ ] **Let's Encrypt SSL:** Install Certbot on Nginx to secure mobile-to-server communication over HTTPS.

### Log Aggregation & Metrics
- [ ] **Pino Transport:** Pipe Pino's stdout logs to an aggregator (e.g. Datadog, Datadust, Grafana Loki, or logrotate) for querying system behavior and auditing dispatched notifications.

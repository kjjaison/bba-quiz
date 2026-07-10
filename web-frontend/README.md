# Web Frontend (Firebase Hosting)

Generated from `gas/index.html` for hosting outside Apps Script.

## Choose a plan

| Option | Firebase plan | Cloud Functions | Cost |
|--------|---------------|-----------------|------|
| **A — Free (recommended to start)** | Spark | No — browser calls Apps Script directly | $0 |
| **B — With API proxy** | Blaze (pay-as-you-go) | Yes — `/api` proxies to Apps Script | Usually $0* |

\* Blaze requires a card on file, but a small quiz app typically stays within the free tier (2M function calls/month).

---

## Option A — Free on Spark (no Blaze)

### 1) API config

```powershell
copy web-frontend\config.example.js web-frontend\config.js
```

Edit `web-frontend/config.js` — set your Apps Script `/exec` URL (same as in `functions/.env`).

### 2) Deploy hosting only

```powershell
firebase deploy --only hosting --config firebase.spark.json
```

This skips Cloud Functions entirely. No Blaze upgrade needed.

### 3) Test

Open `https://YOUR_PROJECT.web.app` and try login.

If the browser shows a **CORS** error, use Option B (Blaze) or keep using the Apps Script `/exec` URL directly.

---

## Option B — Blaze + Cloud Functions (API proxy)

### 1) Upgrade project

Firebase Console → your project → **Upgrade** (Blaze). You are only charged above free limits.

### 2) Configure proxy

```powershell
copy functions\.env.example functions\.env
```

Set `APPS_SCRIPT_URL` in `functions/.env`.

In `web-frontend/config.js`, use the proxy:

```javascript
window.BBA_API_URL = "/api";
```

### 3) Deploy

```powershell
cd functions
npm install
cd ..
firebase deploy --only functions
firebase deploy --only hosting
```

---

## Regenerate UI from Apps Script version

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\sync-web-frontend.ps1"
```

Re-copy or update `web-frontend/config.js` after regenerating (it is gitignored).

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const { readAllSheetData } = require("./lib/sheetReader");
const { syncSheetDataToFirestore } = require("./lib/firestoreSync");

const APPS_SCRIPT_URL = defineString("APPS_SCRIPT_URL");
const SPREADSHEET_ID = defineString("SPREADSHEET_ID");
const SYNC_SECRET = defineString("SYNC_SECRET");

const FUNCTION_REGION = "europe-west1";

function readAppsScriptUrl() {
  const fromParam = APPS_SCRIPT_URL.value();
  if (fromParam) return fromParam.trim();
  if (process.env.APPS_SCRIPT_URL) return process.env.APPS_SCRIPT_URL.trim();
  return "";
}

function readSpreadsheetId() {
  const fromParam = SPREADSHEET_ID.value();
  if (fromParam) return fromParam.trim();
  if (process.env.SPREADSHEET_ID) return process.env.SPREADSHEET_ID.trim();
  return "";
}

function readSyncSecret() {
  const fromParam = SYNC_SECRET.value();
  if (fromParam) return fromParam.trim();
  if (process.env.SYNC_SECRET) return process.env.SYNC_SECRET.trim();
  return "";
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function isHtmlResponse(text) {
  const trimmed = (text || "").trim();
  return trimmed.startsWith("<!") || trimmed.startsWith("<html");
}

function authorizeSync(req) {
  const expected = readSyncSecret();
  if (!expected) {
    return { ok: false, error: "Missing SYNC_SECRET in functions config." };
  }

  const provided =
    req.get("x-sync-secret") ||
    req.get("X-Sync-Secret") ||
    (req.body && req.body.secret) ||
    req.query.secret;

  if (provided !== expected) {
    return { ok: false, error: "Unauthorized sync request." };
  }

  return { ok: true };
}

async function runSheetToFirestoreSync() {
  const spreadsheetId = readSpreadsheetId();
  if (!spreadsheetId) {
    throw new Error("Missing SPREADSHEET_ID. Set it in functions/.env before deploying.");
  }

  const sheetData = await readAllSheetData(spreadsheetId);
  return syncSheetDataToFirestore(sheetData);
}

/** Proxy to Apps Script (legacy path while auth/submissions remain on Sheet). */
exports.api = onRequest({ region: FUNCTION_REGION, cors: true }, async (req, res) => {
  try {
    const appsScriptUrl = readAppsScriptUrl();
    if (!appsScriptUrl) {
      sendJson(res, 500, {
        success: false,
        error: "Missing APPS_SCRIPT_URL. Copy functions/.env.example to functions/.env and set your /exec URL.",
      });
      return;
    }

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { success: false, error: "Method not allowed" });
      return;
    }

    const upstream = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
      redirect: "follow",
    });

    const text = await upstream.text();

    if (isHtmlResponse(text)) {
      sendJson(res, 502, {
        success: false,
        error:
          "Apps Script returned HTML instead of JSON. " +
          "Use the Web App /exec URL (not a Sheet link), deploy with access set to Anyone, and verify APPS_SCRIPT_URL.",
      });
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      sendJson(res, 502, {
        success: false,
        error: "Apps Script returned invalid JSON: " + text.slice(0, 120),
      });
      return;
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      error: err && err.message ? err.message : "Proxy error",
    });
  }
});

/** Manual sync: Sheet → Firestore. POST with header X-Sync-Secret. */
exports.syncSheetToFirestore = onRequest(
  { region: FUNCTION_REGION, cors: true, timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { success: false, error: "POST required" });
        return;
      }

      const auth = authorizeSync(req);
      if (!auth.ok) {
        sendJson(res, 401, { success: false, error: auth.error });
        return;
      }

      const result = await runSheetToFirestoreSync();
      sendJson(res, 200, { success: true, result });
    } catch (err) {
      sendJson(res, 500, {
        success: false,
        error: err && err.message ? err.message : "Sync failed",
      });
    }
  }
);

/** Automatic Sheet → Firestore sync disabled. Questions sync is manual only. */
exports.syncSheetToFirestoreScheduled = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Europe/Dublin",
    region: FUNCTION_REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async () => {
    console.warn(
      "Sheet → Firestore scheduled sync is disabled. " +
      "Sync questions manually from Apps Script. " +
      "Use Apps Script 'Install 15-min Firestore → Sheet backup' for runtime standby."
    );
  }
);

const { onRequest } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");

// Set in functions/.env (see .env.example) or when prompted during deploy.
const APPS_SCRIPT_URL = defineString("APPS_SCRIPT_URL");

const FUNCTION_REGION = "europe-west1";

function readAppsScriptUrl() {
  const fromParam = APPS_SCRIPT_URL.value();
  if (fromParam) return fromParam.trim();
  if (process.env.APPS_SCRIPT_URL) return process.env.APPS_SCRIPT_URL.trim();
  return "";
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function isHtmlResponse(text) {
  const trimmed = (text || "").trim();
  return trimmed.startsWith("<!") || trimmed.startsWith("<html");
}

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

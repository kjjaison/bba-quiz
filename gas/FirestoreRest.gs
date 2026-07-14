/**
 * Firestore REST client for Apps Script (Spark plan — no Cloud Functions).
 *
 * Auth modes (Settings → firestore_auth_mode):
 *   user            — your Google account OAuth (default; works when org blocks SA keys)
 *   service_account — FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in Script properties
 */

var FIRESTORE_BATCH_WRITE_SIZE = 400;
var FIRESTORE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/datastore';

function getFirebaseProjectId_() {
  var fromSettings = getSetting_('firebase_project_id');
  if (fromSettings) return fromSettings;
  var fromConfig = CONFIG.FIREBASE_PROJECT_ID || '';
  if (fromConfig) return fromConfig;
  var fromProps = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (fromProps) return fromProps.trim();
  throw new Error(
    'Missing Firebase project ID. Add Settings row: firebase_project_id | bbadublin-quiz'
  );
}

function getFirestoreAuthMode_() {
  var mode = getSetting_('firestore_auth_mode') ||
    PropertiesService.getScriptProperties().getProperty('FIRESTORE_AUTH_MODE') ||
    (CONFIG.FIRESTORE_AUTH_MODE || 'user');
  return String(mode).toLowerCase();
}

function getFirebaseCredentials_() {
  var props = PropertiesService.getScriptProperties();
  var clientEmail = props.getProperty('FIREBASE_CLIENT_EMAIL');
  var privateKey = props.getProperty('FIREBASE_PRIVATE_KEY');
  if (!clientEmail || !privateKey) {
    throw new Error(
      'Missing service account Script properties (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).\n' +
      'If your organisation blocks key creation, use firestore_auth_mode = user instead.\n' +
      'See docs/FIRESTORE-SPARK.md'
    );
  }
  privateKey = privateKey.replace(/\\n/g, '\n');
  if (privateKey.indexOf('BEGIN PRIVATE KEY') === -1) {
    throw new Error('FIREBASE_PRIVATE_KEY must be a PEM private key from the service account JSON.');
  }
  return { clientEmail: clientEmail.trim(), privateKey: privateKey };
}

function base64UrlEncode_(value) {
  var bytes;
  if (typeof value === 'string') {
    bytes = Utilities.newBlob(value).getBytes();
  } else {
    bytes = value;
  }
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function getFirestoreAccessTokenViaServiceAccount_() {
  var creds = getFirebaseCredentials_();
  var now = Math.floor(Date.now() / 1000);
  var header = base64UrlEncode_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claim = base64UrlEncode_(JSON.stringify({
    iss: creds.clientEmail,
    scope: FIRESTORE_OAUTH_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  var signatureInput = header + '.' + claim;
  var signature = Utilities.computeRsaSha256Signature(signatureInput, creds.privateKey);
  var jwt = signatureInput + '.' + base64UrlEncode_(signature);

  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  var body = response.getContentText();
  var result = JSON.parse(body);
  if (!result.access_token) {
    throw new Error('Service account token failed: ' + body);
  }
  return result.access_token;
}

function getFirestoreAccessTokenViaUser_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (e) {
    // getEmail() may fail in some trigger contexts until authorized
  }

  // Scopes come from appsscript.json oauthScopes — getOAuthToken() takes no arguments.
  var token = ScriptApp.getOAuthToken();
  if (!token) {
    throw new Error(
      'Could not get user OAuth token for Firestore.\n\n' +
      '1. Run "Authorize Firebase access" from the BBA Quiz menu\n' +
      '2. Approve the new permission when prompted\n' +
      '3. Ensure your Google account is Editor on the Firebase project'
    );
  }
  return token;
}

function getFirestoreAccessToken_() {
  var mode = getFirestoreAuthMode_();
  var cache = CacheService.getScriptCache();
  var cacheKey = 'firestore_token_' + mode;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var token = mode === 'service_account'
    ? getFirestoreAccessTokenViaServiceAccount_()
    : getFirestoreAccessTokenViaUser_();

  cache.put(cacheKey, token, 3300);
  return token;
}

function encodeFirestoreValue_(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Math.floor(value) === value) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'object') {
    var fields = {};
    for (var key in value) {
      if (value.hasOwnProperty(key)) {
        fields[key] = encodeFirestoreValue_(value[key]);
      }
    }
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields_(obj) {
  var fields = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      fields[key] = encodeFirestoreValue_(obj[key]);
    }
  }
  return fields;
}

function decodeFirestoreValue_(valueObj) {
  if (!valueObj) return null;
  if ('stringValue' in valueObj) return valueObj.stringValue;
  if ('integerValue' in valueObj) return Number(valueObj.integerValue);
  if ('doubleValue' in valueObj) return valueObj.doubleValue;
  if ('booleanValue' in valueObj) return valueObj.booleanValue;
  if ('timestampValue' in valueObj) return valueObj.timestampValue;
  if ('nullValue' in valueObj) return null;
  if (valueObj.mapValue && valueObj.mapValue.fields) {
    var map = {};
    var inner = valueObj.mapValue.fields;
    for (var key in inner) {
      if (inner.hasOwnProperty(key)) {
        map[key] = decodeFirestoreValue_(inner[key]);
      }
    }
    return map;
  }
  return null;
}

function firestoreDocumentPath_(collectionId, docId) {
  return 'projects/' + getFirebaseProjectId_() +
    '/databases/(default)/documents/' + collectionId + '/' + docId;
}

function firestoreCommitWrites_(writes) {
  if (!writes.length) return;

  var token = getFirestoreAccessToken_();
  var projectId = getFirebaseProjectId_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents:commit';

  for (var i = 0; i < writes.length; i += FIRESTORE_BATCH_WRITE_SIZE) {
    var chunk = writes.slice(i, i + FIRESTORE_BATCH_WRITE_SIZE);
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ writes: chunk }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) {
      throw new Error('Firestore commit failed: ' + response.getContentText());
    }
  }
}

function buildFirestoreUpdateWrite_(collectionId, docId, data) {
  return {
    update: {
      name: firestoreDocumentPath_(collectionId, docId),
      fields: encodeFirestoreFields_(data)
    }
  };
}

function listFirestoreCollection_(collectionId) {
  var token = getFirestoreAccessToken_();
  var projectId = getFirebaseProjectId_();
  var docs = [];
  var pageToken = '';

  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
      '/databases/(default)/documents/' + collectionId + '?pageSize=300';
    if (pageToken) {
      url += '&pageToken=' + encodeURIComponent(pageToken);
    }
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) {
      throw new Error('Firestore list failed for ' + collectionId + ': ' + response.getContentText());
    }
    var data = JSON.parse(response.getContentText());
    if (data.documents) {
      docs = docs.concat(data.documents);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return docs;
}

function deleteStaleFirestoreDocs_(collectionId, syncBatchId) {
  var docs = listFirestoreCollection_(collectionId);
  var deletes = [];

  for (var i = 0; i < docs.length; i++) {
    var fields = docs[i].fields || {};
    var docBatch = fields.syncBatchId ? decodeFirestoreValue_(fields.syncBatchId) : '';
    if (docBatch !== syncBatchId) {
      deletes.push({ delete: docs[i].name });
    }
  }

  firestoreCommitWrites_(deletes);
  return deletes.length;
}

/** Run once after updating appsscript.json — triggers OAuth consent for Firestore. */
function authorizeFirestoreAccess() {
  try {
    var projectId = getFirebaseProjectId_();
    getFirestoreAccessToken_();
    var email = Session.getActiveUser().getEmail() || '(your account)';
    showMessage_(
      'Firebase access authorized!\n\n' +
      'Account: ' + email + '\n' +
      'Project: ' + projectId + '\n' +
      'Auth mode: ' + getFirestoreAuthMode_() + '\n\n' +
      'You can now sync Sheet → Firestore.'
    );
  } catch (err) {
    showMessage_('Authorization failed:\n\n' + (err.message || err));
  }
}

function testFirebaseConnection() {
  try {
    var projectId = testFirebaseConnection_();
    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (e) {}
    showMessage_(
      'Firebase connection OK!\n\n' +
      'Project: ' + projectId + '\n' +
      'Auth mode: ' + getFirestoreAuthMode_() + '\n' +
      (email ? 'Account: ' + email + '\n' : '') +
      'Ready to sync Sheet → Firestore.'
    );
  } catch (err) {
    showMessage_('Firebase connection failed:\n\n' + (err.message || err));
  }
}

function testFirebaseConnection_() {
  getFirestoreAccessToken_();
  return getFirebaseProjectId_();
}

function decodeFirestoreDocument_(doc) {
  if (!doc || !doc.fields) return {};
  var result = {};
  for (var key in doc.fields) {
    if (doc.fields.hasOwnProperty(key)) {
      result[key] = decodeFirestoreValue_(doc.fields[key]);
    }
  }
  return result;
}

function firestoreStringFilter_(fieldPath, value) {
  return {
    fieldFilter: {
      field: { fieldPath: fieldPath },
      op: 'EQUAL',
      value: { stringValue: String(value) }
    }
  };
}

function getFirestoreDocument_(collectionId, docId) {
  var token = getFirestoreAccessToken_();
  var projectId = getFirebaseProjectId_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/' + collectionId + '/' + encodeURIComponent(docId);

  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() >= 300) {
    throw new Error('Firestore get ' + collectionId + '/' + docId + ' failed: ' + response.getContentText());
  }

  return decodeFirestoreDocument_(JSON.parse(response.getContentText()));
}

function runFirestoreQuery_(structuredQuery) {
  var token = getFirestoreAccessToken_();
  var projectId = getFirebaseProjectId_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents:runQuery';

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ structuredQuery: structuredQuery }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 300) {
    throw new Error('Firestore query failed: ' + response.getContentText());
  }

  var rows = JSON.parse(response.getContentText());
  var docs = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].document) {
      docs.push(decodeFirestoreDocument_(rows[i].document));
    }
  }
  return docs;
}

function queryFirestoreByQuizAndLanguage_(collectionId, quizId, language) {
  return runFirestoreQuery_({
    from: [{ collectionId: collectionId }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          firestoreStringFilter_('quizId', quizId),
          firestoreStringFilter_('language', language)
        ]
      }
    },
    orderBy: [{ field: { fieldPath: 'questionNum' }, direction: 'ASCENDING' }]
  });
}

function getFirestoreScheduleForDate_(date) {
  return getFirestoreDocument_('schedule', date);
}

function loadQuestionsFromFirestore_(quizId, language, includeAnswers) {
  var lang = normalizeLanguage_(language);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'fq:' + lang + ':' + quizId + ':' + (includeAnswers ? 'a' : 'q');
  var cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  var docs = queryFirestoreByQuizAndLanguage_('questions', quizId, lang);
  if (!docs.length && lang !== 'en') {
    docs = queryFirestoreByQuizAndLanguage_('questions', quizId, 'en');
  }

  var answerMap = {};
  if (includeAnswers && docs.length) {
    var keys = queryFirestoreByQuizAndLanguage_('answerKeys', quizId, lang);
    if (!keys.length && lang !== 'en') {
      keys = queryFirestoreByQuizAndLanguage_('answerKeys', quizId, 'en');
    }
    for (var k = 0; k < keys.length; k++) {
      answerMap[String(keys[k].questionNum)] = keys[k].correctAnswer;
    }
  }

  var questions = [];
  for (var i = 0; i < docs.length; i++) {
    var doc = docs[i];
    var q = {
      id: Number(doc.questionNum),
      question: doc.question,
      chapter: String(doc.bookReference || '').trim(),
      options: normalizeQuestionOptions_(doc.options || {})
    };
    if (includeAnswers) {
      q.correctAnswer = answerMap[String(doc.questionNum)] || '';
    }
    questions.push(q);
  }

  questions.sort(function(a, b) { return a.id - b.id; });

  try {
    var json = JSON.stringify(questions);
    if (json.length < 95000) {
      cache.put(cacheKey, json, 300);
    }
  } catch (e) {}

  return questions;
}

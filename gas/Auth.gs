/**
 * Authentication: email+password and email+OTP
 * Supports multiple concurrent sessions per user (web + mobile).
 */

var SESSION_COL = {
  EMAIL: 0,
  TOKEN: 1,
  EXPIRES: 2,
  CREATED: 3
};

function hashPassword_(password) {
  var raw = CONFIG.SALT + password;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function generateToken_() {
  return Utilities.getUuid() + '-' + Utilities.getUuid();
}

var SESSION_COL = {
  EMAIL: 0,
  TOKEN: 1,
  EXPIRES: 2,
  CREATED: 3,
  REMEMBER: 4
};

function parseRememberMe_(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function sessionExpiresAt_(fromDate, rememberMe) {
  var base = fromDate || new Date();
  var hours = parseRememberMe_(rememberMe)
    ? CONFIG.SESSION_REMEMBER_HOURS
    : CONFIG.SESSION_HOURS;
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function getSessionsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.SESSIONS);
    sheet.appendRow(['email', 'session_token', 'expires_at', 'created_at', 'remember_me']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function createSession_(email, rememberMe) {
  email = (email || '').toLowerCase().trim();
  var remember = parseRememberMe_(rememberMe);
  var token = generateToken_();
  var now = new Date();
  var expires = sessionExpiresAt_(now, remember);
  var sheet = getSessionsSheet_();

  sheet.appendRow([email, token, expires, now, remember]);
  pruneSessionsForUser_(email);

  return token;
}

function pruneSessionsForUser_(email) {
  var sheet = getSessionsSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var rowsToDelete = [];
  var active = [];

  for (var i = 1; i < data.length; i++) {
    var rowEmail = (data[i][SESSION_COL.EMAIL] || '').toLowerCase();
    if (rowEmail !== email) continue;

    var expires = new Date(data[i][SESSION_COL.EXPIRES]);
    if (expires < now) {
      rowsToDelete.push(i + 1);
      continue;
    }

    active.push({
      row: i + 1,
      created: data[i][SESSION_COL.CREATED] instanceof Date
        ? data[i][SESSION_COL.CREATED].getTime()
        : new Date(data[i][SESSION_COL.CREATED] || 0).getTime()
    });
  }

  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var d = 0; d < rowsToDelete.length; d++) {
    sheet.deleteRow(rowsToDelete[d]);
  }

  var maxSessions = CONFIG.MAX_SESSIONS_PER_USER || 10;
  if (active.length <= maxSessions) return;

  active.sort(function(a, b) { return a.created - b.created; });
  var excess = active.length - maxSessions;
  for (var j = 0; j < excess; j++) {
    sheet.deleteRow(active[j].row);
  }
}

function getUserProfileByEmail_(email) {
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      return {
        row: i + 1,
        email: data[i][0],
        displayName: data[i][2],
        totalScore: Number(data[i][6]) || 0,
        totalQuizzes: Number(data[i][7]) || 0,
        perfectScores: Number(data[i][8]) || 0,
        streak: Number(data[i][9]) || 0
      };
    }
  }

  throw new Error('User not found');
}

function registerUser_(email, password, displayName, rememberMe) {
  email = (email || '').toLowerCase().trim();
  displayName = (displayName || '').trim();

  if (!email || !password) {
    throw new Error('Email and password are required');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  if (!displayName) {
    throw new Error('Display name is required');
  }

  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      throw new Error('An account with this email already exists');
    }
  }

  var now = new Date();
  var token = createSession_(email, rememberMe);

  sheet.appendRow([
    email,
    hashPassword_(password),
    displayName,
    now,
    '',  // legacy session_token (unused — see Sessions sheet)
    '',  // legacy session_expires
    0,
    0,
    0,
    0
  ]);

  return { email: email, displayName: displayName, token: token };
}

function loginWithPassword_(email, password, rememberMe) {
  email = (email || '').toLowerCase().trim();
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = sheet.getDataRange().getValues();
  var hash = hashPassword_(password);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      if (data[i][1] !== hash) {
        throw new Error('Invalid email or password');
      }
      var token = createSession_(email, rememberMe);
      return {
        email: data[i][0],
        displayName: data[i][2],
        token: token
      };
    }
  }
  throw new Error('Invalid email or password');
}

function requestOTP_(email) {
  email = (email || '').toLowerCase().trim();
  if (!email) {
    throw new Error('Email is required');
  }

  var usersSheet = getSheet_(CONFIG.SHEETS.USERS);
  var users = usersSheet.getDataRange().getValues();
  var userExists = false;
  for (var i = 1; i < users.length; i++) {
    if ((users[i][0] || '').toLowerCase() === email) {
      userExists = true;
      break;
    }
  }
  if (!userExists) {
    throw new Error('No account found with this email. Please register first.');
  }

  var otp = String(Math.floor(100000 + Math.random() * 900000));
  var expires = new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60 * 1000);

  var otpSheet = getSheet_(CONFIG.SHEETS.OTP);
  var otpData = otpSheet.getDataRange().getValues();

  for (var j = otpData.length - 1; j >= 1; j--) {
    if ((otpData[j][0] || '').toLowerCase() === email) {
      otpSheet.deleteRow(j + 1);
    }
  }

  otpSheet.appendRow([email, otp, expires]);

  MailApp.sendEmail({
    to: email,
    subject: 'BBA Dublin Bible Quiz - Your Login Code',
    htmlBody: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">' +
      '<h2 style="color:#1a365d;">BBA Dublin Bible Quiz</h2>' +
      '<p>Your one-time login code is:</p>' +
      '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2b6cb0;">' + otp + '</p>' +
      '<p style="color:#718096;">This code expires in ' + CONFIG.OTP_EXPIRY_MINUTES + ' minutes.</p>' +
      '<p style="color:#a0aec0;font-size:12px;">If you did not request this code, you can ignore this email.</p>' +
      '</div>'
  });

  return { message: 'OTP sent to your email' };
}

function loginWithOTP_(email, otp, rememberMe) {
  email = (email || '').toLowerCase().trim();
  otp = (otp || '').trim();

  if (!email || !otp) {
    throw new Error('Email and OTP are required');
  }

  var otpSheet = getSheet_(CONFIG.SHEETS.OTP);
  var otpData = otpSheet.getDataRange().getValues();
  var validOtp = false;

  for (var i = otpData.length - 1; i >= 1; i--) {
    if ((otpData[i][0] || '').toLowerCase() === email) {
      if (String(otpData[i][1]) === otp && new Date(otpData[i][2]) > new Date()) {
        validOtp = true;
        otpSheet.deleteRow(i + 1);
        break;
      }
    }
  }

  if (!validOtp) {
    throw new Error('Invalid or expired OTP');
  }

  var usersSheet = getSheet_(CONFIG.SHEETS.USERS);
  var users = usersSheet.getDataRange().getValues();

  for (var j = 1; j < users.length; j++) {
    if ((users[j][0] || '').toLowerCase() === email) {
      var token = createSession_(email, rememberMe);
      return {
        email: users[j][0],
        displayName: users[j][2],
        token: token
      };
    }
  }
  throw new Error('User not found');
}

function validateSession_(token) {
  if (!token) {
    throw new Error('Authentication required');
  }

  token = String(token).trim();
  var sessionsSheet = getSessionsSheet_();
  var data = sessionsSheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][SESSION_COL.TOKEN]) === token) {
      var expires = new Date(data[i][SESSION_COL.EXPIRES]);
      if (expires < new Date()) {
        sessionsSheet.deleteRow(i + 1);
        throw new Error('Session expired. Please log in again.');
      }

      if (CONFIG.SESSION_EXTEND_ON_USE) {
        var remember = parseRememberMe_(data[i][SESSION_COL.REMEMBER]);
        sessionsSheet.getRange(i + 1, SESSION_COL.EXPIRES + 1)
          .setValue(sessionExpiresAt_(new Date(), remember));
      }

      var email = (data[i][SESSION_COL.EMAIL] || '').toLowerCase();
      return getUserProfileByEmail_(email);
    }
  }

  return validateLegacySession_(token);
}

/** Backward compatibility for tokens stored on the Users sheet (single device). */
function validateLegacySession_(token) {
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][4]) === token) {
      if (!data[i][5] || new Date(data[i][5]) < new Date()) {
        throw new Error('Session expired. Please log in again.');
      }

      var email = (data[i][0] || '').toLowerCase();
      var sessionsSheet = getSessionsSheet_();
      sessionsSheet.appendRow([
        email,
        token,
        sessionExpiresAt_(new Date(), true),
        new Date(),
        true
      ]);
      pruneSessionsForUser_(email);

      return getUserProfileByEmail_(email);
    }
  }

  throw new Error('Invalid session. Please log in again.');
}

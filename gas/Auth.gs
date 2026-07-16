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

function getQuizFromEmail_() {
  return String(CONFIG.QUIZ_FROM_EMAIL || 'bba@bbadublin.com').trim();
}

function getQuizReplyEmail_() {
  return String(CONFIG.QUIZ_REPLY_EMAIL || CONFIG.QUIZ_MASTER_EMAIL || 'quizmaster@bbadublin.com').trim();
}

/** Contact / reply address shown in email footers */
function getQuizMasterEmail_() {
  return getQuizReplyEmail_();
}

function getScriptRunnerEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function sendQuizEmail_(options) {
  var senderName = CONFIG.QUIZ_EMAIL_NAME || 'BBA Dublin Bible Quiz';
  var replyTo = getQuizReplyEmail_();

  MailApp.sendEmail({
    to: options.to,
    subject: options.subject,
    htmlBody: options.htmlBody,
    name: senderName,
    replyTo: replyTo
  });
}

/** Re-authorize email sending (MailApp uses the deployer account). */
function authorizeQuizEmailAccess() {
  try {
    var runner = getScriptRunnerEmail_();
    showMessage_(
      'Email is ready.\n\n' +
      'Sends from: ' + (runner || getQuizFromEmail_()) + '\n' +
      'Reply-To: ' + getQuizReplyEmail_() + '\n\n' +
      'Use “Test quiz email” to confirm.'
    );
  } catch (err) {
    showMessage_('Email check failed:\n\n' + (err.message || err));
  }
}

function generateTempPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var length = 10;
  var result = '';
  for (var i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function invalidateAllSessionsForUser_(email) {
  email = (email || '').toLowerCase().trim();
  var sheet = getSessionsSheet_();
  var data = getSheetData_(CONFIG.SHEETS.SESSIONS);
  var rowsToDelete = [];

  for (var i = data.length - 1; i >= 1; i--) {
    if ((data[i][SESSION_COL.EMAIL] || '').toLowerCase() === email) {
      rowsToDelete.push(i + 1);
    }
  }

  for (var j = 0; j < rowsToDelete.length; j++) {
    sheet.deleteRow(rowsToDelete[j]);
  }
  if (rowsToDelete.length) {
    invalidateSheetCache_(CONFIG.SHEETS.SESSIONS);
  }
}

var USER_COL = {
  EMAIL: 0,
  PASSWORD_HASH: 1,
  DISPLAY_NAME: 2,
  CREATED: 3,
  LEGACY_SESSION_TOKEN: 4,
  LEGACY_SESSION_EXPIRES: 5,
  TOTAL_SCORE: 6,
  TOTAL_QUIZZES: 7,
  PERFECT_SCORES: 8,
  STREAK: 9,
  MUST_CHANGE_PASSWORD: 10
};

function userMustChangePassword_(row) {
  var val = row[USER_COL.MUST_CHANGE_PASSWORD];
  return val === true || val === 'TRUE' || val === 'true' || val === 1 || val === '1';
}

function setMustChangePassword_(email, mustChange) {
  email = (email || '').toLowerCase().trim();
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      sheet.getRange(i + 1, USER_COL.MUST_CHANGE_PASSWORD + 1).setValue(!!mustChange);
      invalidateSheetCache_(CONFIG.SHEETS.USERS);
      invalidateUserProfileCache_(email);
      writeFirestoreUserProfile_({
        email: email,
        displayName: data[i][2],
        totalScore: Number(data[i][6]) || 0,
        totalQuizzes: Number(data[i][7]) || 0,
        perfectScores: Number(data[i][8]) || 0,
        streak: Number(data[i][9]) || 0,
        mustChangePassword: !!mustChange,
        passwordHash: data[i][1]
      });
      return;
    }
  }
}

function updateUserPassword_(email, newPassword, invalidateSessions) {
  email = (email || '').toLowerCase().trim();
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);
  var hash = hashPassword_(newPassword);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      sheet.getRange(i + 1, USER_COL.PASSWORD_HASH + 1).setValue(hash);
      invalidateSheetCache_(CONFIG.SHEETS.USERS);
      invalidateUserProfileCache_(email);
      writeFirestoreUserProfile_({
        email: email,
        displayName: data[i][2],
        totalScore: Number(data[i][6]) || 0,
        totalQuizzes: Number(data[i][7]) || 0,
        perfectScores: Number(data[i][8]) || 0,
        streak: Number(data[i][9]) || 0,
        mustChangePassword: userMustChangePassword_(data[i]),
        passwordHash: hash
      });
      if (invalidateSessions !== false) {
        invalidateAllSessionsForUser_(email);
      }
      return true;
    }
  }
  return false;
}

function changePassword_(user, currentPassword, newPassword) {
  currentPassword = String(currentPassword || '');
  newPassword = String(newPassword || '');

  if (!currentPassword || !newPassword) {
    throw new Error('Current and new password are required');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters');
  }
  if (currentPassword === newPassword) {
    throw new Error('New password must be different from your current password');
  }

  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);
  var email = (user.email || '').toLowerCase();

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      if (data[i][USER_COL.PASSWORD_HASH] !== hashPassword_(currentPassword)) {
        throw new Error('Current password is incorrect');
      }
      sheet.getRange(i + 1, USER_COL.PASSWORD_HASH + 1).setValue(hashPassword_(newPassword));
      setMustChangePassword_(email, false);
      invalidateUserProfileCache_(email);
      return { message: 'Password updated successfully', mustChangePassword: false };
    }
  }
  throw new Error('User not found');
}

function requestPasswordReset_(email) {
  email = (email || '').toLowerCase().trim();
  if (!email) {
    throw new Error('Email is required');
  }

  var users = getSheetData_(CONFIG.SHEETS.USERS);
  var userRow = null;
  for (var i = 1; i < users.length; i++) {
    if ((users[i][0] || '').toLowerCase() === email) {
      userRow = users[i];
      break;
    }
  }

  if (!userRow) {
    throw new Error('No account found with this email. Please register first.');
  }

  var tempPassword = generateTempPassword_();
  updateUserPassword_(email, tempPassword, true);
  setMustChangePassword_(email, true);

  var displayName = userRow[2] || 'there';
  sendQuizEmail_({
    to: email,
    subject: 'BBA Dublin Bible Quiz - Your Password Reset',
    htmlBody: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">' +
      '<h2 style="color:#1a365d;">BBA Dublin Bible Quiz</h2>' +
      '<p>Hi ' + displayName + ',</p>' +
      '<p>We received a request to reset your quiz password. Your new temporary password is:</p>' +
      '<p style="font-size:24px;font-weight:bold;letter-spacing:2px;color:#2b6cb0;">' + tempPassword + '</p>' +
      '<p style="color:#718096;">Sign in with this password — you will be asked to set a new password right away.</p>' +
      '<p style="color:#a0aec0;font-size:12px;">If you did not request this, contact ' +
      getQuizMasterEmail_() + ' immediately.</p>' +
      '</div>'
  });

  return { message: 'A new password has been sent to your email.' };
}

/** Run from Sheet menu to verify quiz email From / Reply-To */
function testQuizEmailSend() {
  try {
    var to = Session.getActiveUser().getEmail();
    if (!to) {
      showMessage_('Could not detect your email. Open the Sheet and run this from the BBA Quiz menu.');
      return;
    }
    var runner = getScriptRunnerEmail_();
    sendQuizEmail_({
      to: to,
      subject: 'BBA Dublin Bible Quiz - Email Test',
      htmlBody: '<div style="font-family:sans-serif;padding:16px;">' +
        '<p>Quiz emails send from <b>' + (runner || getQuizFromEmail_()) + '</b>.</p>' +
        '<p>Replies go to <b>' + getQuizReplyEmail_() + '</b>.</p>' +
        '</div>'
    });
    showMessage_(
      'Test email sent to ' + to + '\n\n' +
      'From: ' + (runner || getQuizFromEmail_()) + '\n' +
      'Reply-To: ' + getQuizReplyEmail_()
    );
  } catch (err) {
    showMessage_('Email test failed:\n\n' + (err.message || err));
  }
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

  // Firestore only on login hot path — Sheet sessions refreshed by 15-min backup
  writeFirestoreSession_({
    email: email,
    token: token,
    expiresAt: expires,
    createdAt: now,
    rememberMe: remember
  });

  try {
    var cache = CacheService.getScriptCache();
    cache.put(
      'sv:' + Utilities.base64EncodeWebSafe(token).substring(0, 80),
      email,
      180
    );
  } catch (e) {}

  return token;
}

function pruneSessionsForUser_(email) {
  var sheet = getSessionsSheet_();
  var data = getSheetData_(CONFIG.SHEETS.SESSIONS);
  var now = new Date();
  var active = [];

  for (var i = 1; i < data.length; i++) {
    var rowEmail = (data[i][SESSION_COL.EMAIL] || '').toLowerCase();
    if (rowEmail !== email) continue;

    var expires = new Date(data[i][SESSION_COL.EXPIRES]);
    if (expires < now) continue;

    active.push({
      row: i + 1,
      created: data[i][SESSION_COL.CREATED] instanceof Date
        ? data[i][SESSION_COL.CREATED].getTime()
        : new Date(data[i][SESSION_COL.CREATED] || 0).getTime()
    });
  }

  var maxSessions = CONFIG.MAX_SESSIONS_PER_USER || 10;
  if (active.length <= maxSessions) return;

  active.sort(function(a, b) { return a.created - b.created; });
  var excess = active.length - maxSessions;
  for (var j = 0; j < excess; j++) {
    sheet.deleteRow(active[j].row);
  }
  invalidateSheetCache_(CONFIG.SHEETS.SESSIONS);
}

function invalidateUserProfileCache_(email) {
  if (!email) return;
  CacheService.getScriptCache().remove('usr:' + String(email).toLowerCase());
}

function getUserProfileByEmail_(email) {
  email = (email || '').toLowerCase();
  var cache = CacheService.getScriptCache();
  var cacheKey = 'usr:' + email;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var fsUser = getFirestoreUserByEmail_(email);
  if (fsUser) {
    var fsProfile = {
      row: null,
      email: fsUser.email,
      displayName: fsUser.displayName,
      totalScore: fsUser.totalScore,
      totalQuizzes: fsUser.totalQuizzes,
      perfectScores: fsUser.perfectScores,
      streak: fsUser.streak,
      mustChangePassword: fsUser.mustChangePassword === true,
      passwordHash: fsUser.passwordHash || '',
      source: 'firestore'
    };
    try {
      cache.put(cacheKey, JSON.stringify(fsProfile), SESSION_USER_CACHE_SEC);
    } catch (e) {}
    return fsProfile;
  }

  var data = getSheetData_(CONFIG.SHEETS.USERS);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      var profile = {
        row: i + 1,
        email: data[i][0],
        displayName: data[i][2],
        totalScore: Number(data[i][6]) || 0,
        totalQuizzes: Number(data[i][7]) || 0,
        perfectScores: Number(data[i][8]) || 0,
        streak: Number(data[i][9]) || 0,
        mustChangePassword: userMustChangePassword_(data[i]),
        passwordHash: String(data[i][1] || ''),
        source: 'sheet'
      };
      try {
        cache.put(cacheKey, JSON.stringify(profile), SESSION_USER_CACHE_SEC);
      } catch (e) {}
      // Warm Firestore for next login
      writeFirestoreUserProfile_(profile);
      return profile;
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

  if (getFirestoreUserByEmail_(email)) {
    throw new Error('An account with this email already exists');
  }

  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      throw new Error('An account with this email already exists');
    }
  }

  var now = new Date();
  var passwordHash = hashPassword_(password);

  writeFirestoreUserProfile_({
    email: email,
    displayName: displayName,
    totalScore: 0,
    totalQuizzes: 0,
    perfectScores: 0,
    streak: 0,
    mustChangePassword: false,
    passwordHash: passwordHash
  });

  var token = createSession_(email, rememberMe);

  try {
    sheet.appendRow([
      email,
      passwordHash,
      displayName,
      now,
      '',
      '',
      0,
      0,
      0,
      0,
      false
    ]);
    invalidateSheetCache_(CONFIG.SHEETS.USERS);
  } catch (err) {
    Logger.log('Sheet user standby write failed: ' + (err.message || err));
  }

  return { email: email, displayName: displayName, token: token, mustChangePassword: false };
}

function loginWithPassword_(email, password, rememberMe) {
  email = (email || '').toLowerCase().trim();
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  var hash = hashPassword_(password);

  var fsUser = getFirestoreUserByEmail_(email);
  if (fsUser) {
    if (!fsUser.passwordHash || fsUser.passwordHash !== hash) {
      throw new Error('Invalid email or password');
    }
    var token = createSession_(email, rememberMe);
    return {
      email: fsUser.email,
      displayName: fsUser.displayName,
      token: token,
      mustChangePassword: fsUser.mustChangePassword === true
    };
  }

  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      if (data[i][1] !== hash) {
        throw new Error('Invalid email or password');
      }
      writeFirestoreUserProfile_({
        email: email,
        displayName: data[i][2],
        totalScore: Number(data[i][6]) || 0,
        totalQuizzes: Number(data[i][7]) || 0,
        perfectScores: Number(data[i][8]) || 0,
        streak: Number(data[i][9]) || 0,
        mustChangePassword: userMustChangePassword_(data[i]),
        passwordHash: data[i][1]
      });
      var sheetToken = createSession_(email, rememberMe);
      return {
        email: data[i][0],
        displayName: data[i][2],
        token: sheetToken,
        mustChangePassword: userMustChangePassword_(data[i])
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

  var userExists = !!getFirestoreUserByEmail_(email);
  if (!userExists) {
    var users = getSheetData_(CONFIG.SHEETS.USERS);
    for (var i = 1; i < users.length; i++) {
      if ((users[i][0] || '').toLowerCase() === email) {
        userExists = true;
        break;
      }
    }
  }
  if (!userExists) {
    throw new Error('No account found with this email. Please register first.');
  }

  var otp = String(Math.floor(100000 + Math.random() * 900000));
  var expires = new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60 * 1000);

  var otpSheet = getSheet_(CONFIG.SHEETS.OTP);
  var otpData = getSheetData_(CONFIG.SHEETS.OTP);

  for (var j = otpData.length - 1; j >= 1; j--) {
    if ((otpData[j][0] || '').toLowerCase() === email) {
      otpSheet.deleteRow(j + 1);
    }
  }
  invalidateSheetCache_(CONFIG.SHEETS.OTP);

  otpSheet.appendRow([email, otp, expires]);
  invalidateSheetCache_(CONFIG.SHEETS.OTP);

  sendQuizEmail_({
    to: email,
    subject: 'BBA Dublin Bible Quiz - Your Login Code',
    htmlBody: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">' +
      '<h2 style="color:#1a365d;">BBA Dublin Bible Quiz</h2>' +
      '<p>Your one-time login code is:</p>' +
      '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2b6cb0;">' + otp + '</p>' +
      '<p style="color:#718096;">This code expires in ' + CONFIG.OTP_EXPIRY_MINUTES + ' minutes.</p>' +
      '<p style="color:#a0aec0;font-size:12px;">If you did not request this code, contact ' +
      getQuizMasterEmail_() + '.</p>' +
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
  var otpData = getSheetData_(CONFIG.SHEETS.OTP);
  var validOtp = false;

  for (var i = otpData.length - 1; i >= 1; i--) {
    if ((otpData[i][0] || '').toLowerCase() === email) {
      if (String(otpData[i][1]) === otp && new Date(otpData[i][2]) > new Date()) {
        validOtp = true;
        otpSheet.deleteRow(i + 1);
        invalidateSheetCache_(CONFIG.SHEETS.OTP);
        break;
      }
    }
  }

  if (!validOtp) {
    throw new Error('Invalid or expired OTP');
  }

  var fsUser = getFirestoreUserByEmail_(email);
  if (fsUser) {
    var fsToken = createSession_(email, rememberMe);
    return {
      email: fsUser.email,
      displayName: fsUser.displayName,
      token: fsToken,
      mustChangePassword: fsUser.mustChangePassword === true
    };
  }

  var users = getSheetData_(CONFIG.SHEETS.USERS);

  for (var j = 1; j < users.length; j++) {
    if ((users[j][0] || '').toLowerCase() === email) {
      writeFirestoreUserProfile_({
        email: email,
        displayName: users[j][2],
        totalScore: Number(users[j][6]) || 0,
        totalQuizzes: Number(users[j][7]) || 0,
        perfectScores: Number(users[j][8]) || 0,
        streak: Number(users[j][9]) || 0,
        mustChangePassword: userMustChangePassword_(users[j]),
        passwordHash: users[j][1]
      });
      var token = createSession_(email, rememberMe);
      return {
        email: users[j][0],
        displayName: users[j][2],
        token: token,
        mustChangePassword: userMustChangePassword_(users[j])
      };
    }
  }
  throw new Error('User not found');
}

function userFromLoginResult_(loginResult) {
  return {
    email: loginResult.email,
    displayName: loginResult.displayName,
    totalScore: 0,
    totalQuizzes: 0,
    perfectScores: 0,
    streak: 0,
    mustChangePassword: loginResult.mustChangePassword === true
  };
}

function validateSession_(token) {
  if (!token) {
    throw new Error('Authentication required');
  }

  token = String(token).trim();
  var cache = CacheService.getScriptCache();
  var sessionCacheKey = 'sv:' + Utilities.base64EncodeWebSafe(token).substring(0, 80);
  var cachedEmail = cache.get(sessionCacheKey);
  if (cachedEmail) {
    return getUserProfileByEmail_(cachedEmail);
  }

  var fsSession = getFirestoreSessionByToken_(token);
  if (fsSession) {
    if (!fsSession.expiresAt || fsSession.expiresAt < new Date()) {
      deleteFirestoreSession_(token);
      throw new Error('Session expired. Please log in again.');
    }

    if (CONFIG.SESSION_EXTEND_ON_USE) {
      var extendKey = 'se:' + token.substring(0, 40);
      if (!cache.get(extendKey)) {
        var newExpiry = sessionExpiresAt_(new Date(), fsSession.rememberMe);
        writeFirestoreSession_({
          email: fsSession.email,
          token: token,
          expiresAt: newExpiry,
          createdAt: fsSession.createdAt || new Date(),
          rememberMe: fsSession.rememberMe
        });
        cache.put(extendKey, '1', 3600);
      }
    }

    try {
      cache.put(sessionCacheKey, fsSession.email, 180);
    } catch (e) {}
    return getUserProfileByEmail_(fsSession.email);
  }

  var sessionsSheet = getSessionsSheet_();
  var data = getSheetData_(CONFIG.SHEETS.SESSIONS);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][SESSION_COL.TOKEN]) === token) {
      var expires = new Date(data[i][SESSION_COL.EXPIRES]);
      if (expires < new Date()) {
        sessionsSheet.deleteRow(i + 1);
        invalidateSheetCache_(CONFIG.SHEETS.SESSIONS);
        throw new Error('Session expired. Please log in again.');
      }

      var remember = parseRememberMe_(data[i][SESSION_COL.REMEMBER]);
      var email = (data[i][SESSION_COL.EMAIL] || '').toLowerCase();

      writeFirestoreSession_({
        email: email,
        token: token,
        expiresAt: expires,
        createdAt: data[i][SESSION_COL.CREATED] || new Date(),
        rememberMe: remember
      });

      if (CONFIG.SESSION_EXTEND_ON_USE) {
        var sheetExtendKey = 'se:' + token.substring(0, 40);
        if (!cache.get(sheetExtendKey)) {
          sessionsSheet.getRange(i + 1, SESSION_COL.EXPIRES + 1)
            .setValue(sessionExpiresAt_(new Date(), remember));
          invalidateSheetCache_(CONFIG.SHEETS.SESSIONS);
          cache.put(sheetExtendKey, '1', 3600);
        }
      }

      try {
        cache.put(sessionCacheKey, email, 180);
      } catch (e) {}
      return getUserProfileByEmail_(email);
    }
  }

  return validateLegacySession_(token);
}

/** Backward compatibility for tokens stored on the Users sheet (single device). */
function validateLegacySession_(token) {
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);

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
      invalidateSheetCache_(CONFIG.SHEETS.SESSIONS);
      pruneSessionsForUser_(email);

      return getUserProfileByEmail_(email);
    }
  }

  throw new Error('Invalid session. Please log in again.');
}

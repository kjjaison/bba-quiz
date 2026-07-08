/**
 * Authentication: email+password and email+OTP
 */

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

function registerUser_(email, password, displayName) {
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

  var token = generateToken_();
  var now = new Date();
  var expires = new Date(now.getTime() + CONFIG.SESSION_HOURS * 60 * 60 * 1000);

  sheet.appendRow([
    email,
    hashPassword_(password),
    displayName,
    now,
    token,
    expires,
    0,  // total_score
    0,  // total_quizzes
    0,  // perfect_scores
    0   // current_streak
  ]);

  return { email: email, displayName: displayName, token: token };
}

function loginWithPassword_(email, password) {
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
      var token = generateToken_();
      var expires = new Date(Date.now() + CONFIG.SESSION_HOURS * 60 * 60 * 1000);
      sheet.getRange(i + 1, 5, 1, 2).setValues([[token, expires]]);
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

  // User must exist to request OTP
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

  // Remove existing OTP for this email
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

function loginWithOTP_(email, otp) {
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
      var token = generateToken_();
      var expires = new Date(Date.now() + CONFIG.SESSION_HOURS * 60 * 60 * 1000);
      usersSheet.getRange(j + 1, 5, 1, 2).setValues([[token, expires]]);
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

  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][4] === token) {
      if (new Date(data[i][5]) < new Date()) {
        throw new Error('Session expired. Please log in again.');
      }
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
  throw new Error('Invalid session. Please log in again.');
}

/**
 * Client-callable wrappers for google.script.run (when HTML is served from Apps Script)
 */
function apiRegister(email, password, displayName, rememberMe, language) {
  var response = authResponseWithQuiz_(
    registerUser_(email, password, displayName, rememberMe),
    language
  );
  response.success = true;
  return response;
}

function apiLogin(email, password, rememberMe, language) {
  var response = authResponseWithQuiz_(
    loginWithPassword_(email, password, rememberMe),
    language
  );
  response.success = true;
  return response;
}

function apiRequestOtp(email) {
  return { success: true, data: requestOTP_(email) };
}

function apiForgotPassword(email) {
  return { success: true, data: requestPasswordReset_(email) };
}

function apiLoginOtp(email, otp, rememberMe, language) {
  var response = authResponseWithQuiz_(
    loginWithOTP_(email, otp, rememberMe),
    language
  );
  response.success = true;
  return response;
}

function apiPing() {
  var appConfig = getAppPublicConfig_();
  return {
    success: true,
    version: appConfig.version,
    testDatePicker: appConfig.testDatePicker,
    time: new Date().toISOString()
  };
}

function apiGetQuiz(token, language, quizDate) {
  var user = validateSession_(token);
  return { success: true, quiz: getTodayQuiz_(user, language, quizDate) };
}

function apiSubmitQuiz(token, answers, language, quizDate) {
  var user = validateSession_(token);
  return { success: true, result: submitQuiz_(user, answers, language, quizDate) };
}

function apiLeaderboard(token, period) {
  validateSession_(token);
  return { success: true, leaderboard: getLeaderboard_(period) };
}

function apiChangePassword(token, currentPassword, newPassword) {
  var user = validateSession_(token);
  return { success: true, result: changePassword_(user, currentPassword, newPassword) };
}

function apiProfile(token) {
  var user = validateSession_(token);
  return { success: true, profile: getUserProfile_(user) };
}

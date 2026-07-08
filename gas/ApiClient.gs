/**
 * Client-callable wrappers for google.script.run (when HTML is served from Apps Script)
 */
function apiRegister(email, password, displayName, rememberMe) {
  return { success: true, user: registerUser_(email, password, displayName, rememberMe) };
}

function apiLogin(email, password, rememberMe) {
  return { success: true, user: loginWithPassword_(email, password, rememberMe) };
}

function apiRequestOtp(email) {
  return { success: true, data: requestOTP_(email) };
}

function apiLoginOtp(email, otp, rememberMe) {
  return { success: true, user: loginWithOTP_(email, otp, rememberMe) };
}

function apiGetQuiz(token) {
  var user = validateSession_(token);
  return { success: true, quiz: getTodayQuiz_(user) };
}

function apiSubmitQuiz(token, answers) {
  var user = validateSession_(token);
  return { success: true, result: submitQuiz_(user, answers) };
}

function apiLeaderboard(token, period) {
  validateSession_(token);
  return { success: true, leaderboard: getLeaderboard_(period) };
}

function apiProfile(token) {
  var user = validateSession_(token);
  return { success: true, profile: getUserProfile_(user) };
}

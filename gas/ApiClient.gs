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

function apiLoginOtp(email, otp, rememberMe, language) {
  var response = authResponseWithQuiz_(
    loginWithOTP_(email, otp, rememberMe),
    language
  );
  response.success = true;
  return response;
}

function apiGetQuiz(token, language) {
  var user = validateSession_(token);
  return { success: true, quiz: getTodayQuiz_(user, language) };
}

function apiSubmitQuiz(token, answers, language) {
  var user = validateSession_(token);
  return { success: true, result: submitQuiz_(user, answers, language) };
}

function apiLeaderboard(token, period) {
  validateSession_(token);
  return { success: true, leaderboard: getLeaderboard_(period) };
}

function apiProfile(token) {
  var user = validateSession_(token);
  return { success: true, profile: getUserProfile_(user) };
}

/**
 * Client-callable wrappers for google.script.run (when HTML is served from Apps Script)
 */
function apiRegister(email, password, displayName, rememberMe, language) {
  var response = authResponse_(registerUser_(email, password, displayName, rememberMe));
  response.success = true;
  return response;
}

function apiLogin(email, password, rememberMe, language) {
  var response = authResponse_(loginWithPassword_(email, password, rememberMe));
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
  var response = authResponse_(loginWithOTP_(email, otp, rememberMe));
  response.success = true;
  return response;
}

function apiPing() {
  var appConfig = getAppPublicConfig_();
  return {
    success: true,
    version: appConfig.version,
    testDatePicker: appConfig.testDatePicker,
    customQuizzesEnabled: appConfig.customQuizzesEnabled,
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
  period = String(period || 'daily').toLowerCase();
  var label = period;
  try {
    label = getLeaderboardPeriodLabel_(period);
  } catch (e) {}
  return {
    success: true,
    leaderboard: getLeaderboard_(period),
    period: period,
    label: label
  };
}

function apiChangePassword(token, currentPassword, newPassword) {
  var user = validateSession_(token);
  return { success: true, result: changePassword_(user, currentPassword, newPassword) };
}

function apiProfile(token) {
  var user = validateSession_(token);
  return { success: true, profile: getUserProfile_(user) };
}

function apiHistory(token) {
  var user = validateSession_(token);
  return { success: true, history: getUserQuizHistory_(user) };
}

function apiCustomCatalog(token, language) {
  var user = validateSession_(token);
  requireCustomQuizAdmin_(user);
  return { success: true, catalog: listChapterCatalog_(language), admin: true };
}

function apiCustomList(token) {
  var user = validateSession_(token);
  var data = listCustomQuizzesForUser_(user);
  data.success = true;
  return data;
}

function apiCustomCreate(token, title, scopes, questionCount, opensAt, closesAt, language) {
  var user = validateSession_(token);
  var data = createCustomQuizDraft_(user, {
    title: title,
    scopes: scopes,
    questionCount: questionCount,
    opensAt: opensAt,
    closesAt: closesAt,
    language: language
  });
  data.success = true;
  return data;
}

function apiCustomShuffle(token, customQuizId) {
  var user = validateSession_(token);
  var data = shuffleCustomQuizQuestions_(user, customQuizId);
  data.success = true;
  return data;
}

function apiCustomPublish(token, customQuizId) {
  var user = validateSession_(token);
  var data = publishCustomQuiz_(user, customQuizId);
  data.success = true;
  return data;
}

function apiCustomGet(token, customQuizId, language) {
  var user = validateSession_(token);
  return {
    success: true,
    quiz: getCustomQuizForUser_(user, customQuizId, language)
  };
}

function apiCustomSubmit(token, customQuizId, answers, language) {
  var user = validateSession_(token);
  return {
    success: true,
    result: submitCustomQuiz_(user, customQuizId, answers, language)
  };
}

function apiCustomResults(token, customQuizId) {
  var user = validateSession_(token);
  var data = getCustomQuizResults_(user, customQuizId);
  data.success = true;
  return data;
}

function apiCustomSendResults(token, customQuizId) {
  var user = validateSession_(token);
  requireCustomQuizAdmin_(user);
  var data = sendCustomQuizResultsEmails_(customQuizId);
  data.success = true;
  return data;
}

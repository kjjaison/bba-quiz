/**
 * HTTP entry points - deploy as Web App
 * Production URL must end with /exec (not /dev)
 */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  // API calls via GET (?action=quiz&token=...)
  if (action && action !== 'page') {
    return handleApi_(e);
  }

  return serveIndexHtml_();
}

/** Serve index HTML without Apps Script template tags (avoids <? parsing bugs). */
function serveIndexHtml_() {
  try {
    var html = HtmlService.createHtmlOutputFromFile('index')
      .evaluate()
      .getContent();
    html = html.replace(/__APP_VERSION__/g, CONFIG.APP_VERSION);
    return HtmlService.createHtmlOutput(html)
      .setTitle('BBA Dublin Bible Quiz')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:24px;">' +
      '<h1>BBA Dublin Bible Quiz — setup needed</h1>' +
      '<p><b>Error:</b> ' + (err.message || 'Could not load index HTML') + '</p>' +
      '<ol>' +
      '<li>In Apps Script: <b>+ → HTML</b></li>' +
      '<li>Name it exactly: <b>index</b> (not index.html)</li>' +
      '<li>Paste contents from <code>gas/index.html</code></li>' +
      '<li>Save, then <b>Deploy → Manage deployments → Edit → New version → Deploy</b></li>' +
      '</ol></div>'
    );
  }
}

function doPost(e) {
  return handleApi_(e);
}

function handleApi_(e) {
  try {
    var params = {};
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      params = e.parameter;
    }

    var action = params.action || (e.parameter && e.parameter.action);
    var token = params.token || (e.parameter && e.parameter.token);

    switch (action) {
      case 'register':
        return successResponse_({
          user: registerUser_(
            params.email,
            params.password,
            params.displayName,
            params.rememberMe
          )
        });

      case 'login':
        return successResponse_({
          user: loginWithPassword_(params.email, params.password, params.rememberMe)
        });

      case 'requestOtp':
        return successResponse_(requestOTP_(params.email));

      case 'loginOtp':
        return successResponse_({
          user: loginWithOTP_(params.email, params.otp, params.rememberMe)
        });

      case 'quiz':
        var quizUser = validateSession_(token);
        return successResponse_({
          quiz: getTodayQuiz_(quizUser)
        });

      case 'submit':
        var submitUser = validateSession_(token);
        return successResponse_({
          result: submitQuiz_(submitUser, params.answers || {})
        });

      case 'leaderboard':
        validateSession_(token);
        return successResponse_({
          leaderboard: getLeaderboard_(params.period || 'all')
        });

      case 'profile':
        var profileUser = validateSession_(token);
        return successResponse_({
          profile: getUserProfile_(profileUser)
        });

      case 'ping':
        return successResponse_({
          version: CONFIG.APP_VERSION,
          time: new Date().toISOString()
        });

      default:
        return errorResponse_('Unknown action: ' + action, 404);
    }
  } catch (err) {
    return errorResponse_(err.message || 'Server error', 400);
  }
}

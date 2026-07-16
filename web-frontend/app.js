const APP_VERSION = '2026-07-16.3';
    const VERSION_KEY = 'bba_quiz_app_version';

    (function enforceAppVersion() {
      if (!APP_VERSION) return;

      let storedVersion = null;
      try {
        storedVersion = localStorage.getItem(VERSION_KEY);
      } catch (e) { /* storage blocked in private mode or some iframes */ }

      if (storedVersion === APP_VERSION) return;

      try {
        localStorage.removeItem('bba_quiz_token');
        localStorage.removeItem('bba_quiz_user');
        localStorage.removeItem('bba_quiz_remember');
        sessionStorage.removeItem('bba_quiz_session_token');
        sessionStorage.removeItem('bba_quiz_session_user');
        localStorage.setItem(VERSION_KEY, APP_VERSION);
      } catch (e) { /* continue without storage */ }
      // Never auto-reload: reloads break Google Sites embeds and can serve cached error pages.
    })();

    function resetAppCache(reload) {
      try {
        localStorage.removeItem(VERSION_KEY);
        localStorage.removeItem('bba_quiz_token');
        localStorage.removeItem('bba_quiz_user');
        localStorage.removeItem('bba_quiz_remember');
        sessionStorage.removeItem('bba_quiz_session_token');
        sessionStorage.removeItem('bba_quiz_session_user');
      } catch (e) { /* ignore */ }
      if (reload) {
        const url = new URL(location.href);
        url.searchParams.set('nocache', String(Date.now()));
        url.searchParams.delete('_vreload');
        if (window.self !== window.top) {
          const link = document.createElement('a');
          link.href = url.toString();
          link.target = '_top';
          link.rel = 'noopener';
          document.body.appendChild(link);
          link.click();
          link.remove();
        } else {
          location.replace(url.toString());
        }
      }
    }

    (function showEmbeddedHelp() {
      if (window.self === window.top) return;
      const bar = document.getElementById('embed-help');
      if (!bar) return;
      bar.classList.remove('hidden');
      const link = document.getElementById('embed-open-link');
      if (link) link.href = location.href.split('#')[0];
    })();

    const TOKEN_KEY = 'bba_quiz_token';
    const USER_KEY = 'bba_quiz_user';
    const REMEMBER_PREF_KEY = 'bba_quiz_remember';
    const SESSION_TOKEN_KEY = 'bba_quiz_session_token';
    const SESSION_USER_KEY = 'bba_quiz_session_user';
    const LANG_KEY = 'bba_quiz_language';
    const TEST_DATE_KEY = 'bba_quiz_test_date';

    let testDatePickerEnabled = false;

    function getStoredTestDate() {
      try {
        return localStorage.getItem(TEST_DATE_KEY) || '';
      } catch (e) {
        return '';
      }
    }

    function setStoredTestDate(value) {
      try {
        if (value) localStorage.setItem(TEST_DATE_KEY, value);
        else localStorage.removeItem(TEST_DATE_KEY);
      } catch (e) { /* ignore */ }
    }

    function todayIsoDate() {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    function syncTestDatePickerUi(enabled) {
      testDatePickerEnabled = enabled === true;
      const row = document.getElementById('test-date-row');
      if (!row) return;
      row.classList.toggle('hidden', !testDatePickerEnabled);
      if (!testDatePickerEnabled) return;

      const input = document.getElementById('test-quiz-date');
      const stored = getStoredTestDate();
      if (input && stored) input.value = stored;
      else if (input && !input.value) input.value = todayIsoDate();
    }

    function getQuizDateParam() {
      if (!testDatePickerEnabled) return undefined;
      const input = document.getElementById('test-quiz-date');
      const value = (input && input.value) || getStoredTestDate();
      return value || undefined;
    }

    function buildQuizRequestParams(extra) {
      const params = Object.assign({}, extra || {});
      const quizDate = getQuizDateParam();
      if (quizDate) params.quizDate = quizDate;
      return params;
    }

    async function loadAppConfig() {
      try {
        const res = await API.call('ping', {});
        syncTestDatePickerUi(res.testDatePicker === true);
      } catch (err) {
        syncTestDatePickerUi(false);
      }
    }

    function applyQuizConfigFromResponse(payload) {
      if (payload && payload.testDatePicker === true) {
        syncTestDatePickerUi(true);
      }
      if (payload && payload.date && testDatePickerEnabled) {
        const input = document.getElementById('test-quiz-date');
        if (input) input.value = payload.date;
        setStoredTestDate(payload.date);
      }
    }

    function getLanguage() {
      try {
        return localStorage.getItem(LANG_KEY) || 'en';
      } catch (e) {
        return 'en';
      }
    }

    function setLanguage(lang) {
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch (e) { /* ignore */ }
    }

    function syncLanguageSelect() {
      const select = document.getElementById('lang-select');
      if (select) select.value = getLanguage();
    }

    function isRememberPrefEnabled() {
      return localStorage.getItem(REMEMBER_PREF_KEY) !== 'false';
    }

    function loadStoredSession() {
      try {
        const persistentToken = localStorage.getItem(TOKEN_KEY);
        if (persistentToken) {
          const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
          if (user && user.displayName) {
            return { token: persistentToken, user: user };
          }
        }

        const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
        if (sessionToken) {
          const user = JSON.parse(sessionStorage.getItem(SESSION_USER_KEY) || 'null');
          if (user && user.displayName) {
            return { token: sessionToken, user: user };
          }
        }
      } catch (e) {
        /* corrupt storage — treat as logged out */
      }

      return { token: null, user: null };
    }

    const storedSession = loadStoredSession();
    let currentToken = storedSession.token;
    let currentUser = storedSession.user;
    let currentQuiz = null;
    let selectedAnswers = {};
    let currentQuestionIndex = 0;

    // API layer: google.script.run on Apps Script; fetch elsewhere (Firebase, etc.)
    async function fetchApiResponse(url, action, params) {
      if (!url) {
        throw new Error('Missing BBA_API_URL. Add web-frontend/config.js before deploying to Firebase.');
      }

      const payload = { action, ...params };
      const isAppsScript = url.indexOf('script.google.com') >= 0;

      async function readJsonResponse(response) {
        const text = await response.text();
        if (text.trim().startsWith('<')) {
          throw new Error('__HTML_RESPONSE__');
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error('Server returned invalid JSON.');
        }
      }

      try {
        const postResponse = await fetch(url, {
          method: 'POST',
          redirect: 'follow',
          headers: {
            'Content-Type': isAppsScript
              ? 'text/plain;charset=utf-8'
              : 'application/json'
          },
          body: JSON.stringify(payload)
        });
        return await readJsonResponse(postResponse);
      } catch (postErr) {
        if (!isAppsScript || postErr.message !== '__HTML_RESPONSE__') {
          if (postErr.message === '__HTML_RESPONSE__') {
            throw new Error('Server returned HTML instead of JSON. Check config.js has your /exec URL and redeploy hosting.');
          }
          throw postErr;
        }
      }

      const getUrl = new URL(url);
      getUrl.searchParams.set('action', action);
      Object.keys(params).forEach((key) => {
        const val = params[key];
        if (val === undefined || val === null) return;
        getUrl.searchParams.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
      });
      const getResponse = await fetch(getUrl.toString(), { method: 'GET', redirect: 'follow' });
      try {
        return await readJsonResponse(getResponse);
      } catch (getErr) {
        if (getErr.message === '__HTML_RESPONSE__') {
          throw new Error('Server returned HTML instead of JSON. Redeploy Apps Script (Main.gs) and verify /exec URL in config.js.');
        }
        throw getErr;
      }
    }

    const API = {
      call(action, params = {}) {
        return new Promise((resolve, reject) => {
          if (typeof google !== 'undefined' && google.script && google.script.run) {
            const fnMap = {
              register: 'apiRegister',
              login: 'apiLogin',
              requestOtp: 'apiRequestOtp',
              forgotPassword: 'apiForgotPassword',
              loginOtp: 'apiLoginOtp',
              ping: 'apiPing',
              quiz: 'apiGetQuiz',
              submit: 'apiSubmitQuiz',
              leaderboard: 'apiLeaderboard',
              changePassword: 'apiChangePassword',
              profile: 'apiProfile'
            };
            const fn = fnMap[action];
            const args = action === 'register' ? [params.email, params.password, params.displayName, params.rememberMe, params.language]
              : action === 'login' ? [params.email, params.password, params.rememberMe, params.language]
              : action === 'requestOtp' ? [params.email]
              : action === 'forgotPassword' ? [params.email]
              : action === 'loginOtp' ? [params.email, params.otp, params.rememberMe, params.language]
              : action === 'ping' ? []
              : action === 'quiz' ? [params.token, params.language, params.quizDate]
              : action === 'submit' ? [params.token, params.answers, params.language, params.quizDate]
              : action === 'changePassword' ? [params.token, params.currentPassword, params.newPassword]
              : action === 'leaderboard' ? [params.token, params.period]
              : action === 'profile' ? [params.token]
              : [];

            google.script.run
              .withSuccessHandler(resolve)
              .withFailureHandler(reject)
              [fn](...args);
          } else {
            fetchApiResponse(window.BBA_API_URL, action, params)
              .then(data => data.success ? resolve(data) : reject(new Error(data.error)))
              .catch(reject);
          }
        });
      }
    };

    function showAlert(id, message, type) {
      const el = document.getElementById(id);
      el.textContent = message;
      el.className = 'alert alert-' + type;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 5000);
    }

    function setLoading(btn, loading) {
      if (!btn) return;
      btn.disabled = loading;
      btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
      btn.textContent = loading ? 'Please wait...' : btn.dataset.originalText;
    }

    function saveSession(user, rememberMe) {
      const remember = rememberMe !== false;
      localStorage.setItem(REMEMBER_PREF_KEY, remember ? 'true' : 'false');

      currentToken = user.token;
      currentUser = {
        email: user.email,
        displayName: user.displayName,
        mustChangePassword: user.mustChangePassword === true
      };

      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);

      if (remember) {
        localStorage.setItem(TOKEN_KEY, currentToken);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      } else {
        sessionStorage.setItem(SESSION_TOKEN_KEY, currentToken);
        sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser));
      }
    }

    function clearSession() {
      currentToken = null;
      currentUser = null;
      currentQuiz = null;
      selectedAnswers = {};
      currentQuestionIndex = 0;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
    }

    function syncRememberCheckboxes() {
      const checked = isRememberPrefEnabled();
      ['remember-login', 'remember-otp', 'remember-register'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
      });
    }

    function persistCurrentUser() {
      if (!currentUser || !currentToken) return;
      const payload = JSON.stringify(currentUser);
      if (localStorage.getItem(TOKEN_KEY) === currentToken) {
        localStorage.setItem(USER_KEY, payload);
      } else if (sessionStorage.getItem(SESSION_TOKEN_KEY) === currentToken) {
        sessionStorage.setItem(SESSION_USER_KEY, payload);
      }
    }

    function showChangePasswordOverlay(required) {
      const overlay = document.getElementById('change-password-overlay');
      document.getElementById('change-password-hint').textContent = required
        ? 'You signed in with a temporary password. Choose a new password to continue.'
        : 'Enter your current password and choose a new one.';
      overlay.classList.remove('hidden');
    }

    function hideChangePasswordOverlay() {
      document.getElementById('change-password-overlay').classList.add('hidden');
      document.getElementById('cp-current').value = '';
      document.getElementById('cp-new').value = '';
      document.getElementById('cp-confirm').value = '';
      document.getElementById('alert-change-password').classList.add('hidden');
    }

    async function submitPasswordChange(currentId, newId, confirmId, alertId, onSuccess) {
      const currentPassword = document.getElementById(currentId).value;
      const newPassword = document.getElementById(newId).value;
      const confirmPassword = document.getElementById(confirmId).value;

      if (!currentPassword || !newPassword || !confirmPassword) {
        showAlert(alertId, 'Please fill in all password fields.', 'error');
        return;
      }
      if (newPassword.length < 6) {
        showAlert(alertId, 'New password must be at least 6 characters.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showAlert(alertId, 'New passwords do not match.', 'error');
        return;
      }

      try {
        await API.call('changePassword', {
          token: currentToken,
          currentPassword,
          newPassword
        });
        currentUser.mustChangePassword = false;
        persistCurrentUser();
        if (onSuccess) onSuccess();
        else showAlert('alert-app', 'Password updated successfully.', 'success');
      } catch (err) {
        showAlert(alertId, err.message || 'Could not update password', 'error');
      }
    }

    async function checkMustChangePassword() {
      if (currentUser && currentUser.mustChangePassword === true) {
        showChangePasswordOverlay(true);
        return;
      }
      if (currentUser && currentUser.mustChangePassword === false) {
        return;
      }
      try {
        const res = await API.call('profile', { token: currentToken });
        if (res.profile && res.profile.mustChangePassword) {
          currentUser.mustChangePassword = true;
          persistCurrentUser();
          showChangePasswordOverlay(true);
        } else if (currentUser) {
          currentUser.mustChangePassword = false;
          persistCurrentUser();
        }
      } catch (err) {
        // ignore — quiz can still load
      }
    }

    function showApp(prefetchedQuiz) {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('app-screen').classList.remove('hidden');
      document.getElementById('user-name').textContent = currentUser.displayName;
      syncLanguageSelect();
      checkMustChangePassword();
      if (prefetchedQuiz) {
        applyQuizData(prefetchedQuiz);
      } else {
        loadQuiz();
      }
    }

    function showAuth() {
      hideChangePasswordOverlay();
      document.getElementById('auth-screen').classList.remove('hidden');
      document.getElementById('app-screen').classList.add('hidden');
      syncRememberCheckboxes();
    }

    // Tab switching
    document.getElementById('auth-tabs').addEventListener('click', e => {
      if (!e.target.classList.contains('tab')) return;
      document.querySelectorAll('#auth-tabs .tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      const tab = e.target.dataset.tab;
      document.getElementById('panel-login').classList.toggle('hidden', tab !== 'login');
      document.getElementById('panel-register').classList.toggle('hidden', tab !== 'register');
    });

    document.querySelector('#panel-login .tabs').addEventListener('click', e => {
      if (!e.target.classList.contains('tab')) return;
      e.target.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      const mode = e.target.dataset.loginMode;
      document.getElementById('forgot-password-form').classList.add('hidden');
      document.getElementById('login-password-form').classList.toggle('hidden', mode !== 'password');
      document.getElementById('login-otp-form').classList.toggle('hidden', mode !== 'otp');
      if (mode === 'password') {
        document.querySelector('#panel-login .tabs').classList.remove('hidden');
      }
    });

    document.getElementById('app-tabs').addEventListener('click', e => {
      if (!e.target.classList.contains('tab')) return;
      document.querySelectorAll('#app-tabs .tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      const view = e.target.dataset.view;
      ['quiz', 'leaderboard', 'profile'].forEach(v => {
        document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
      });
      if (view === 'leaderboard') loadLeaderboard('all');
      if (view === 'profile') loadProfile();
    });

    document.getElementById('lb-tabs').addEventListener('click', e => {
      if (!e.target.classList.contains('tab')) return;
      document.querySelectorAll('#lb-tabs .tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      loadLeaderboard(e.target.dataset.period);
    });

    function showLoginPasswordForm() {
      document.getElementById('login-password-form').classList.remove('hidden');
      document.getElementById('forgot-password-form').classList.add('hidden');
      document.querySelector('#panel-login .tabs').classList.remove('hidden');
    }

    function showForgotPasswordForm() {
      const loginEmail = document.getElementById('login-email').value.trim();
      if (loginEmail) {
        document.getElementById('forgot-email').value = loginEmail;
      }
      document.getElementById('login-password-form').classList.add('hidden');
      document.getElementById('forgot-password-form').classList.remove('hidden');
      document.querySelector('#panel-login .tabs').classList.add('hidden');
    }

    document.getElementById('link-forgot-password').addEventListener('click', e => {
      e.preventDefault();
      showForgotPasswordForm();
    });

    document.getElementById('link-back-to-login').addEventListener('click', e => {
      e.preventDefault();
      showLoginPasswordForm();
    });

    document.getElementById('btn-forgot-password').addEventListener('click', async () => {
      const btn = document.getElementById('btn-forgot-password');
      setLoading(btn, true);
      try {
        await API.call('forgotPassword', { email: document.getElementById('forgot-email').value });
        showAlert('alert-auth', 'A new password has been sent to your email.', 'success');
        showLoginPasswordForm();
      } catch (err) {
        showAlert('alert-auth', err.message || 'Could not reset password', 'error');
      }
      setLoading(btn, false);
    });

    // Auth actions
    document.getElementById('btn-login').addEventListener('click', async () => {
      const btn = document.getElementById('btn-login');
      setLoading(btn, true);
      try {
        const res = await API.call('login', {
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
          rememberMe: document.getElementById('remember-login').checked,
          language: getLanguage()
        });
        saveSession(res.user, document.getElementById('remember-login').checked);
        showApp(res.quiz);
      } catch (err) {
        showAlert('alert-auth', err.message || 'Login failed', 'error');
      }
      setLoading(btn, false);
    });

    document.getElementById('btn-register').addEventListener('click', async () => {
      const btn = document.getElementById('btn-register');
      setLoading(btn, true);
      try {
        const res = await API.call('register', {
          email: document.getElementById('reg-email').value,
          password: document.getElementById('reg-password').value,
          displayName: document.getElementById('reg-name').value,
          rememberMe: document.getElementById('remember-register').checked,
          language: getLanguage()
        });
        saveSession(res.user, document.getElementById('remember-register').checked);
        showApp(res.quiz);
      } catch (err) {
        showAlert('alert-auth', err.message || 'Registration failed', 'error');
      }
      setLoading(btn, false);
    });

    document.getElementById('btn-send-otp').addEventListener('click', async () => {
      const btn = document.getElementById('btn-send-otp');
      setLoading(btn, true);
      try {
        await API.call('requestOtp', { email: document.getElementById('otp-email').value });
        document.getElementById('otp-code-section').classList.remove('hidden');
        showAlert('alert-auth', 'Login code sent to your email!', 'success');
      } catch (err) {
        showAlert('alert-auth', err.message || 'Failed to send code', 'error');
      }
      setLoading(btn, false);
    });

    document.getElementById('btn-login-otp').addEventListener('click', async () => {
      const btn = document.getElementById('btn-login-otp');
      setLoading(btn, true);
      try {
        const res = await API.call('loginOtp', {
          email: document.getElementById('otp-email').value,
          otp: document.getElementById('otp-code').value,
          rememberMe: document.getElementById('remember-otp').checked,
          language: getLanguage()
        });
        saveSession(res.user, document.getElementById('remember-otp').checked);
        showApp(res.quiz);
      } catch (err) {
        showAlert('alert-auth', err.message || 'Invalid code', 'error');
      }
      setLoading(btn, false);
    });

    document.getElementById('btn-change-password').addEventListener('click', async () => {
      const btn = document.getElementById('btn-change-password');
      setLoading(btn, true);
      await submitPasswordChange('cp-current', 'cp-new', 'cp-confirm', 'alert-change-password', () => {
        hideChangePasswordOverlay();
        showAlert('alert-app', 'Password updated successfully.', 'success');
      });
      setLoading(btn, false);
    });

    document.getElementById('btn-profile-change-password').addEventListener('click', async () => {
      const btn = document.getElementById('btn-profile-change-password');
      setLoading(btn, true);
      await submitPasswordChange(
        'profile-cp-current',
        'profile-cp-new',
        'profile-cp-confirm',
        'alert-app',
        () => {
          document.getElementById('profile-cp-current').value = '';
          document.getElementById('profile-cp-new').value = '';
          document.getElementById('profile-cp-confirm').value = '';
          hideChangePasswordOverlay();
        }
      );
      setLoading(btn, false);
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      clearSession();
      showAuth();
    });

    document.getElementById('lang-select').addEventListener('change', e => {
      setLanguage(e.target.value);
      if (!document.getElementById('app-screen').classList.contains('hidden')) {
        loadQuiz();
      }
    });

    document.getElementById('btn-load-quiz-date').addEventListener('click', () => {
      const input = document.getElementById('test-quiz-date');
      if (input && input.value) setStoredTestDate(input.value);
      currentQuiz = null;
      selectedAnswers = {};
      currentQuestionIndex = 0;
      if (!document.getElementById('app-screen').classList.contains('hidden')) {
        loadQuiz();
      }
    });

    document.getElementById('test-quiz-date').addEventListener('change', e => {
      if (e.target.value) setStoredTestDate(e.target.value);
      currentQuiz = null;
      selectedAnswers = {};
      currentQuestionIndex = 0;
    });

    document.getElementById('btn-reset-cache').addEventListener('click', e => {
      e.preventDefault();
      clearSession();
      resetAppCache(true);
    });

    // Quiz
    function isQuizSubmitted(quiz) {
      return !!(quiz && (quiz.submitted === true || quiz.submitted === 'true'));
    }

    function mergeSubmittedQuizState(incoming, existing) {
      if (!incoming) return existing || null;
      if (!isQuizSubmitted(existing)) return incoming;
      if (isQuizSubmitted(incoming)) return incoming;
      // Do not carry "completed" state across different quiz days or quizzes.
      if (existing.date && incoming.date && existing.date !== incoming.date) return incoming;
      if (existing.quizId && incoming.quizId && existing.quizId !== incoming.quizId) return incoming;
      return Object.assign({}, incoming, {
        submitted: true,
        score: existing.score,
        answers: existing.answers || incoming.answers,
        totalQuestions: existing.totalQuestions || incoming.totalQuestions
      });
    }

    function applyQuizData(quiz) {
      applyQuizConfigFromResponse(quiz);
      currentQuestionIndex = 0;
      currentQuiz = quiz;
      selectedAnswers = isQuizSubmitted(quiz) && quiz.answers
        ? Object.assign({}, quiz.answers)
        : {};
      if (quiz.language && quiz.language !== getLanguage()) {
        setLanguage(quiz.language);
        syncLanguageSelect();
      }
      document.getElementById('quiz-loading').classList.add('hidden');
      document.getElementById('quiz-content').classList.remove('hidden');
      renderQuiz(quiz);
    }

    async function loadQuiz() {
      document.getElementById('quiz-loading').classList.remove('hidden');
      document.getElementById('quiz-content').classList.add('hidden');
      try {
        const res = await API.call('quiz', buildQuizRequestParams({ token: currentToken, language: getLanguage() }));
        applyQuizData(mergeSubmittedQuizState(res.quiz, currentQuiz));
      } catch (err) {
        if (err.message && err.message.includes('Session')) {
          clearSession();
          showAuth();
          showAlert('alert-auth', 'Session expired. Please log in again.', 'error');
        } else {
          document.getElementById('quiz-content').innerHTML =
            '<div class="card"><div class="alert alert-info">' + (err.message || 'Failed to load quiz') + '</div></div>';
          document.getElementById('quiz-content').classList.remove('hidden');
        }
      }
      document.getElementById('quiz-loading').classList.add('hidden');
    }

    function renderQuizHeader(quiz) {
      let html = '<div class="quiz-header">';
      html += '<div class="chapter">' + escapeHtml(quiz.title || quiz.book + ' ' + quiz.chapter) + '</div>';
      html += '<div class="date">' + quiz.date + '</div>';
      const qCount = quiz.questionCount || (quiz.questions || []).length;
      if (qCount > 0) {
        html += '<div class="question-count">' + qCount + ' questions today</div>';
      }
      html += '</div>';
      return html;
    }

    function bindQuestionOptions(container) {
      if (isQuizSubmitted(currentQuiz)) return;
      container.querySelectorAll('.option').forEach(opt => {
        opt.addEventListener('click', () => {
          if (isQuizSubmitted(currentQuiz)) return;
          const qId = opt.dataset.qid;
          const letter = opt.dataset.letter;
          selectedAnswers[qId] = letter;
          opt.closest('.options').querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          opt.querySelector('input').checked = true;
        });
      });
    }

    function renderActiveQuestion(quiz) {
      if (isQuizSubmitted(quiz)) {
        renderQuiz(quiz);
        return;
      }
      const container = document.getElementById('quiz-content');
      const questions = quiz.questions || [];
      const total = questions.length;

      if (total === 0) {
        container.innerHTML = '<div class="card"><div class="alert alert-info">No questions available.</div></div>';
        container.classList.remove('hidden');
        return;
      }

      if (currentQuestionIndex >= total) currentQuestionIndex = total - 1;
      if (currentQuestionIndex < 0) currentQuestionIndex = 0;

      const q = questions[currentQuestionIndex];
      const num = currentQuestionIndex + 1;
      const userAnswer = selectedAnswers[String(q.id)] || '';
      const navClass = currentQuestionIndex > 0 ? 'quiz-nav' : 'quiz-nav quiz-nav-end';

      let html = '<div class="card">';
      html += renderQuizHeader(quiz);
      html += '<div class="quiz-progress">Question ' + num + ' of ' + total + '</div>';
      html += renderQuestion(q, num, false, userAnswer);
      html += '<div class="' + navClass + '">';

      if (currentQuestionIndex > 0) {
        html += '<button type="button" class="btn btn-outline" id="btn-prev-quiz">Previous</button>';
      }
      if (currentQuestionIndex < total - 1) {
        html += '<button type="button" class="btn btn-primary" id="btn-next-quiz">Next</button>';
      } else {
        html += '<button type="button" class="btn btn-primary" id="btn-submit-quiz">Submit Answers</button>';
      }

      html += '</div></div>';
      container.innerHTML = html;
      container.classList.remove('hidden');

      bindQuestionOptions(container);

      const prevBtn = document.getElementById('btn-prev-quiz');
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          currentQuestionIndex--;
          renderActiveQuestion(quiz);
        });
      }

      const nextBtn = document.getElementById('btn-next-quiz');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (!selectedAnswers[String(q.id)]) {
            showAlert('alert-app', 'Please select an answer before continuing.', 'error');
            return;
          }
          currentQuestionIndex++;
          renderActiveQuestion(quiz);
        });
      }

      const submitBtn = document.getElementById('btn-submit-quiz');
      if (submitBtn) {
        submitBtn.addEventListener('click', submitQuiz);
      }
    }

    function renderQuiz(quiz) {
      const container = document.getElementById('quiz-content');

      if (!quiz.available) {
        container.innerHTML = '<div class="card"><div class="alert alert-info">' + quiz.message + '</div></div>';
        container.classList.remove('hidden');
        return;
      }

      if (isQuizSubmitted(quiz)) {
        let html = '<div class="card">';
        html += renderQuizHeader(quiz);
        html += '<div class="score-result">';
        html += '<div class="score-circle"><div class="points">' + quiz.score + '</div><div class="label">points</div></div>';
        html += '<p style="color:var(--text-muted);">Quiz completed — answers are locked</p>';
        html += '</div>';

        (quiz.questions || []).forEach((q, idx) => {
          const userAns = getUserAnswerForQuestion(quiz.answers, q);
          html += renderQuestion(q, idx + 1, true, userAns);
        });

        html += '</div>';
        container.innerHTML = html;
        container.classList.remove('hidden');
        return;
      }

      renderActiveQuestion(quiz);
    }

    function normalizeQuestionOptions(options) {
      const result = { A: '', B: '', C: '', D: '' };
      if (!options) return result;
      if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch (e) { return result; }
      }
      if (Array.isArray(options)) {
        result.A = String(options[0] ?? '');
        result.B = String(options[1] ?? '');
        result.C = String(options[2] ?? '');
        result.D = String(options[3] ?? '');
        return result;
      }
      const keyMap = {
        A: ['A', 'a', 'option_a', 'optionA', '0'],
        B: ['B', 'b', 'option_b', 'optionB', '1'],
        C: ['C', 'c', 'option_c', 'optionC', '2'],
        D: ['D', 'd', 'option_d', 'optionD', '3']
      };
      ['A', 'B', 'C', 'D'].forEach(letter => {
        for (const key of keyMap[letter]) {
          const val = options[key];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            result[letter] = String(val);
            break;
          }
        }
      });
      return result;
    }

    function normalizeAnswerLetter(value) {
      const s = String(value || '').trim().toLowerCase();
      if (!s) return '';
      if (s === 'option_a' || s === 'a') return 'A';
      if (s === 'option_b' || s === 'b') return 'B';
      if (s === 'option_c' || s === 'c') return 'C';
      if (s === 'option_d' || s === 'd') return 'D';
      return String(value).trim().toUpperCase().charAt(0);
    }

    function getUserAnswerForQuestion(answers, question) {
      const map = answers || {};
      const id = question.id;
      return normalizeAnswerLetter(map[String(id)] || map[id] || '');
    }

    function quizHasReviewAnswers(quiz) {
      return ((quiz && quiz.questions) || []).some(q => normalizeAnswerLetter(q.correctAnswer));
    }

    function renderQuestion(q, num, locked, userAnswer) {
      let html = '<div class="question-card">';
      html += '<div class="question-num">Question ' + num + '</div>';
      html += '<div class="question-text">' + escapeHtml(q.question) + '</div>';
      html += '<div class="options">';
      const opts = normalizeQuestionOptions(q.options);
      const correctLetter = normalizeAnswerLetter(q.correctAnswer);
      const selectedLetter = normalizeAnswerLetter(userAnswer);
      ['A', 'B', 'C', 'D'].forEach(letter => {
        const text = opts[letter];
        if (!text) return;
        let cls = 'option' + (locked ? ' locked' : '');
        if (locked) {
          if (correctLetter && letter === correctLetter) cls += ' correct';
          else if (selectedLetter && letter === selectedLetter && letter !== correctLetter) cls += ' incorrect';
        }
        if (!locked && selectedLetter === letter) cls += ' selected';
        html += '<label class="' + cls + '" data-qid="' + q.id + '" data-letter="' + letter + '">';
        html += '<input type="radio" name="q' + q.id + '" value="' + letter + '"' +
          (selectedLetter === letter ? ' checked' : '') + (locked ? ' disabled' : '') + '>';
        html += '<span class="option-label">' + letter + '</span>';
        html += '<span>' + escapeHtml(text) + '</span>';
        html += '</label>';
      });
      html += '</div></div>';
      return html;
    }

    async function submitQuiz() {
      const questions = currentQuiz.questions || [];
      const currentQ = questions[currentQuestionIndex];
      if (currentQ && !selectedAnswers[String(currentQ.id)]) {
        showAlert('alert-app', 'Please select an answer before submitting.', 'error');
        return;
      }

      const unanswered = questions.filter(q => !selectedAnswers[String(q.id)]);
      if (unanswered.length > 0) {
        showAlert('alert-app', 'Please answer all ' + questions.length + ' questions before submitting.', 'error');
        return;
      }

      const btn = document.getElementById('btn-submit-quiz');
      setLoading(btn, true);
      try {
        const res = await API.call('submit', buildQuizRequestParams({
          token: currentToken,
          answers: selectedAnswers,
          language: getLanguage()
        }));
        const submittedAnswers = Object.assign({}, selectedAnswers);
        const correctAnswers = (res.result && res.result.correctAnswers) ||
          (res.result && res.result.quiz && res.result.quiz.correctAnswers) ||
          {};
        const mergedQuestions = (currentQuiz.questions || []).map(q => Object.assign({}, q, {
          correctAnswer: normalizeAnswerLetter(
            correctAnswers[String(q.id)] || q.correctAnswer || ''
          )
        }));
        const lockedQuiz = Object.assign({}, currentQuiz, res.result.quiz || {}, {
          submitted: true,
          score: res.result.score,
          totalQuestions: res.result.totalQuestions,
          answers: res.result.answers || submittedAnswers,
          correctAnswers: correctAnswers,
          questions: mergedQuestions.length ? mergedQuestions : (res.result.quiz && res.result.quiz.questions)
        });
        applyQuizData(lockedQuiz);
        showAlert('alert-app',
          'Quiz submitted! You scored ' + res.result.score + ' points (' + res.result.percentage + '%)' +
          (res.result.isPerfect ? ' — Perfect score! ⭐' : ''), 'success');
        if (!quizHasReviewAnswers(lockedQuiz)) {
          loadQuiz();
        }
      } catch (err) {
        showAlert('alert-app', err.message || 'Submission failed', 'error');
      }
      setLoading(btn, false);
    }

    // Leaderboard
    async function loadLeaderboard(period) {
      const container = document.getElementById('leaderboard-content');
      container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
      try {
        const res = await API.call('leaderboard', { token: currentToken, period });
        const rows = res.leaderboard || [];
        if (rows.length === 0) {
          container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:1rem;">No scores yet. Be the first!</p>';
          return;
        }
        let html = '<table class="leaderboard-table"><thead><tr><th>Rank</th><th>Name</th><th>Score</th><th>Quizzes</th></tr></thead><tbody>';
        rows.forEach(row => {
          const rankCls = row.rank <= 3 ? 'rank-' + row.rank : 'rank-other';
          html += '<tr>';
          html += '<td><span class="rank-badge ' + rankCls + '">' + row.rank + '</span></td>';
          html += '<td>' + escapeHtml(row.displayName) + '</td>';
          html += '<td><strong>' + row.score + '</strong></td>';
          html += '<td>' + row.quizzes + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = '<div class="alert alert-error">' + (err.message || 'Failed to load') + '</div>';
      }
    }

    // Profile
    async function loadProfile() {
      try {
        const res = await API.call('profile', { token: currentToken });
        const p = res.profile;
        const stats = p.stats || {};

        document.getElementById('profile-stats').innerHTML =
          '<div class="stat-box"><div class="stat-value">' + stats.totalScore + '</div><div class="stat-label">Total Points</div></div>' +
          '<div class="stat-box"><div class="stat-value">' + stats.streak + '</div><div class="stat-label">Day Streak</div></div>' +
          '<div class="stat-box"><div class="stat-value">' + stats.totalQuizzes + '</div><div class="stat-label">Quizzes Done</div></div>';

        const badges = p.badges || [];
        const earnedCount = badges.filter(b => b.earned).length;
        document.getElementById('badge-count').textContent =
          earnedCount + ' of ' + badges.length + ' earned';

        if (badges.length === 0) {
          document.getElementById('badges-grid').innerHTML =
            '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;">Complete quizzes to earn badges!</p>';
        } else {
          const sorted = badges.slice().sort((a, b) => Number(b.earned) - Number(a.earned));
          document.getElementById('badges-grid').innerHTML = sorted.map(b =>
            '<div class="badge-card' + (b.earned ? '' : ' badge-locked') + '">' +
            '<div class="badge-icon">' + b.icon + '</div>' +
            '<div class="badge-name">' + escapeHtml(b.name) + '</div>' +
            '<div class="badge-desc">' + escapeHtml(b.description) + '</div></div>'
          ).join('');
        }
      } catch (err) {
        showAlert('alert-app', err.message || 'Failed to load profile', 'error');
      }
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    // Init
    function initApp() {
      try {
        syncRememberCheckboxes();
        if (currentToken && currentUser) {
          showApp();
        } else {
          showAuth();
        }
        loadAppConfig();
      } catch (err) {
        showAuth();
        showAlert('alert-auth', err.message || 'Could not start app', 'error');
      }
    }

    initApp();
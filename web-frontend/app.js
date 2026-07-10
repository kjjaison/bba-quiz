const APP_VERSION = '2026-07-08.4';
    const VERSION_KEY = 'bba_quiz_app_version';

    (function enforceAppVersion() {
      if (!APP_VERSION || APP_VERSION === '__APP_VERSION__') return;

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
              loginOtp: 'apiLoginOtp',
              quiz: 'apiGetQuiz',
              submit: 'apiSubmitQuiz',
              leaderboard: 'apiLeaderboard',
              profile: 'apiProfile'
            };
            const fn = fnMap[action];
            const args = action === 'register' ? [params.email, params.password, params.displayName, params.rememberMe]
              : action === 'login' ? [params.email, params.password, params.rememberMe]
              : action === 'requestOtp' ? [params.email]
              : action === 'loginOtp' ? [params.email, params.otp, params.rememberMe]
              : action === 'quiz' ? [params.token]
              : action === 'submit' ? [params.token, params.answers]
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
      currentUser = { email: user.email, displayName: user.displayName };

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

    function showApp() {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('app-screen').classList.remove('hidden');
      document.getElementById('user-name').textContent = currentUser.displayName;
      loadQuiz();
    }

    function showAuth() {
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
      document.getElementById('login-password-form').classList.toggle('hidden', mode !== 'password');
      document.getElementById('login-otp-form').classList.toggle('hidden', mode !== 'otp');
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

    // Auth actions
    document.getElementById('btn-login').addEventListener('click', async () => {
      const btn = document.getElementById('btn-login');
      setLoading(btn, true);
      try {
        const res = await API.call('login', {
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
          rememberMe: document.getElementById('remember-login').checked
        });
        saveSession(res.user, document.getElementById('remember-login').checked);
        showApp();
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
          rememberMe: document.getElementById('remember-register').checked
        });
        saveSession(res.user, document.getElementById('remember-register').checked);
        showApp();
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
          rememberMe: document.getElementById('remember-otp').checked
        });
        saveSession(res.user, document.getElementById('remember-otp').checked);
        showApp();
      } catch (err) {
        showAlert('alert-auth', err.message || 'Invalid code', 'error');
      }
      setLoading(btn, false);
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      clearSession();
      showAuth();
    });

    document.getElementById('btn-reset-cache').addEventListener('click', e => {
      e.preventDefault();
      clearSession();
      resetAppCache(true);
    });

    // Quiz
    async function loadQuiz() {
      document.getElementById('quiz-loading').classList.remove('hidden');
      document.getElementById('quiz-content').classList.add('hidden');
      try {
        const res = await API.call('quiz', { token: currentToken });
        currentQuiz = res.quiz;
        renderQuiz(currentQuiz);
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

    function renderQuiz(quiz) {
      const container = document.getElementById('quiz-content');
      selectedAnswers = {};

      if (!quiz.available) {
        container.innerHTML = '<div class="card"><div class="alert alert-info">' + quiz.message + '</div></div>';
        container.classList.remove('hidden');
        return;
      }

      let html = '<div class="card">';
      html += '<div class="quiz-header">';
      html += '<div class="chapter">' + escapeHtml(quiz.title || quiz.book + ' ' + quiz.chapter) + '</div>';
      html += '<div class="date">' + quiz.date + '</div>';
      const qCount = quiz.questionCount || (quiz.questions || []).length;
      if (qCount > 0) {
        html += '<div class="question-count">' + qCount + ' questions today</div>';
      }
      html += '</div>';

      if (quiz.submitted) {
        html += '<div class="score-result">';
        html += '<div class="score-circle"><div class="points">' + quiz.score + '</div><div class="label">points</div></div>';
        html += '<p style="color:var(--text-muted);">Quiz completed — answers are locked</p>';
        html += '</div>';

        (quiz.questions || []).forEach((q, idx) => {
          const userAns = (quiz.answers || {})[String(q.id)] || '';
          html += renderQuestion(q, idx + 1, true, userAns);
        });
      } else {
        (quiz.questions || []).forEach((q, idx) => {
          html += renderQuestion(q, idx + 1, false);
        });
        html += '<button class="btn btn-primary" id="btn-submit-quiz" style="margin-top:1rem;">Submit Answers</button>';
      }

      html += '</div>';
      container.innerHTML = html;
      container.classList.remove('hidden');

      if (!quiz.submitted) {
        container.querySelectorAll('.option').forEach(opt => {
          opt.addEventListener('click', () => {
            const qId = opt.dataset.qid;
            const letter = opt.dataset.letter;
            selectedAnswers[qId] = letter;
            opt.closest('.options').querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            opt.querySelector('input').checked = true;
          });
        });

        document.getElementById('btn-submit-quiz').addEventListener('click', submitQuiz);
      }
    }

    function renderQuestion(q, num, locked, userAnswer) {
      let html = '<div class="question-card">';
      html += '<div class="question-num">Question ' + num + '</div>';
      html += '<div class="question-text">' + escapeHtml(q.question) + '</div>';
      html += '<div class="options">';
      ['A', 'B', 'C', 'D'].forEach(letter => {
        const text = q.options[letter];
        if (!text) return;
        let cls = 'option' + (locked ? ' locked' : '');
        if (locked) {
          if (letter === q.correctAnswer) cls += ' correct';
          else if (letter === userAnswer && userAnswer !== q.correctAnswer) cls += ' incorrect';
        }
        if (!locked && userAnswer === letter) cls += ' selected';
        html += '<label class="' + cls + '" data-qid="' + q.id + '" data-letter="' + letter + '">';
        html += '<input type="radio" name="q' + q.id + '" value="' + letter + '"' +
          (userAnswer === letter ? ' checked' : '') + (locked ? ' disabled' : '') + '>';
        html += '<span class="option-label">' + letter + '</span>';
        html += '<span>' + escapeHtml(text) + '</span>';
        html += '</label>';
      });
      html += '</div></div>';
      return html;
    }

    async function submitQuiz() {
      const questions = currentQuiz.questions || [];
      const unanswered = questions.filter(q => !selectedAnswers[String(q.id)]);
      if (unanswered.length > 0) {
        showAlert('alert-app', 'Please answer all ' + questions.length + ' questions before submitting.', 'error');
        return;
      }

      const btn = document.getElementById('btn-submit-quiz');
      setLoading(btn, true);
      try {
        const res = await API.call('submit', { token: currentToken, answers: selectedAnswers });
        showAlert('alert-app',
          'Quiz submitted! You scored ' + res.result.score + ' points (' + res.result.percentage + '%)' +
          (res.result.isPerfect ? ' — Perfect score! ⭐' : ''), 'success');
        loadQuiz();
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
        if (badges.length === 0) {
          document.getElementById('badges-grid').innerHTML =
            '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;">Complete quizzes to earn badges!</p>';
        } else {
          document.getElementById('badges-grid').innerHTML = badges.map(b =>
            '<div class="badge-card"><div class="badge-icon">' + b.icon + '</div>' +
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
      } catch (err) {
        showAuth();
        showAlert('alert-auth', err.message || 'Could not start app', 'error');
      }
    }

    initApp();
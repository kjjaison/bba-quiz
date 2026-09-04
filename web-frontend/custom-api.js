/**
 * Shared API helper for custom quiz pages (admin-custom.html, custom.html).
 * Expects window.BBA_API_URL from config.js.
 */
(function (global) {
  async function fetchApiResponse(url, action, params) {
    if (!url) {
      throw new Error('Missing BBA_API_URL. Add web-frontend/config.js before deploying.');
    }

    const payload = { action, ...params };
    const isAppsScript = url.indexOf('script.google.com') >= 0;

    function buildRequestUrl() {
      const requestUrl = new URL(url);
      requestUrl.searchParams.set('action', action);
      Object.keys(params).forEach((key) => {
        const val = params[key];
        if (val === undefined || val === null) return;
        if (typeof val === 'object') return;
        requestUrl.searchParams.set(key, String(val));
      });
      return requestUrl.toString();
    }

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

    const requestUrl = buildRequestUrl();

    try {
      const postResponse = await fetch(requestUrl, {
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
          throw new Error('Server returned HTML instead of JSON. Check config.js /exec URL.');
        }
        throw postErr;
      }
    }

    const getResponse = await fetch(requestUrl, { method: 'GET', redirect: 'follow' });
    try {
      return await readJsonResponse(getResponse);
    } catch (getErr) {
      if (getErr.message === '__HTML_RESPONSE__') {
        throw new Error('Server returned HTML instead of JSON. Redeploy Apps Script.');
      }
      throw getErr;
    }
  }

  const CustomAPI = {
    call(action, params) {
      params = params || {};
      return fetchApiResponse(global.BBA_API_URL, action, params).then((data) => {
        if (data && data.success === false) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      });
    }
  };

  function loadSession() {
    try {
      const remember = localStorage.getItem('bba_quiz_remember') === '1';
      const store = remember ? localStorage : sessionStorage;
      const token = store.getItem(remember ? 'bba_quiz_token' : 'bba_quiz_session_token')
        || localStorage.getItem('bba_quiz_token')
        || sessionStorage.getItem('bba_quiz_session_token');
      const raw = store.getItem(remember ? 'bba_quiz_user' : 'bba_quiz_session_user')
        || localStorage.getItem('bba_quiz_user')
        || sessionStorage.getItem('bba_quiz_session_user');
      const user = raw ? JSON.parse(raw) : null;
      return { token: token || null, user: user };
    } catch (e) {
      return { token: null, user: null };
    }
  }

  function saveSession(token, user, remember) {
    try {
      if (remember) {
        localStorage.setItem('bba_quiz_remember', '1');
        localStorage.setItem('bba_quiz_token', token);
        localStorage.setItem('bba_quiz_user', JSON.stringify(user));
        sessionStorage.removeItem('bba_quiz_session_token');
        sessionStorage.removeItem('bba_quiz_session_user');
      } else {
        localStorage.removeItem('bba_quiz_remember');
        sessionStorage.setItem('bba_quiz_session_token', token);
        sessionStorage.setItem('bba_quiz_session_user', JSON.stringify(user));
        localStorage.removeItem('bba_quiz_token');
        localStorage.removeItem('bba_quiz_user');
      }
    } catch (e) { /* ignore */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem('bba_quiz_token');
      localStorage.removeItem('bba_quiz_user');
      localStorage.removeItem('bba_quiz_remember');
      sessionStorage.removeItem('bba_quiz_session_token');
      sessionStorage.removeItem('bba_quiz_session_user');
    } catch (e) { /* ignore */ }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  global.BbaCustom = {
    API: CustomAPI,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
    escapeHtml: escapeHtml
  };
})(window);

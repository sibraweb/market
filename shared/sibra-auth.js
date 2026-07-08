// ═══════════════════════════════════════════════════════════════
//  sibra-auth.js — sesión de Google compartida entre módulos de
//  Market Suite. OAuth implícito por popup, mismo CLIENT_ID que ya
//  usaban actual/propuestas/rotaciones/chicas/homebroker.
//  Token guardado en localStorage bajo 'sibra_token'/'sibra_token_exp'
//  (mismas claves que ya usaban actual y chicas) para que cualquier
//  módulo bajo sibraweb.github.io/market/ reutilice la sesión.
// ═══════════════════════════════════════════════════════════════
const SibraAuth = (() => {
  const CLIENT_ID = '891275909999-25to444ggoo9k1inji4lqbaq1h99ij41.apps.googleusercontent.com';
  // Unión de lo que ya pedía cada módulo por separado: drive.readonly/drive.file
  // (actual, propuestas) + spreadsheets completo -no solo readonly- porque
  // chicas y rotaciones ESCRIBEN en Sheets (sheetsAppend/sheetsClear/_crearSheet).
  const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
  ].join(' ');
  const TOKEN_KEY = 'sibra_token';
  const EXP_KEY = 'sibra_token_exp';

  function getToken() {
    const tok = localStorage.getItem(TOKEN_KEY);
    const exp = localStorage.getItem(EXP_KEY);
    if (!tok || !exp) return null;
    if (new Date(exp) <= new Date()) { logout(); return null; }
    return tok;
  }

  function setToken(token, expiresIn) {
    const expiry = new Date(Date.now() + expiresIn * 1000);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXP_KEY, expiry.toISOString());
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXP_KEY);
  }

  function connect(loginHint = 'web.sibra@gmail.com') {
    return new Promise((resolve, reject) => {
      const redirectUri = location.href.split('?')[0].split('#')[0];
      const state = Math.random().toString(36).slice(2);
      sessionStorage.setItem('sibra_oauth_state', state);
      const params = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: 'token',
        scope: SCOPES, state, prompt: 'select_account', login_hint: loginHint,
      });
      const popup = window.open('https://accounts.google.com/o/oauth2/v2/auth?' + params, 'googleOAuth', 'width=520,height=640,left=200,top=100');
      if (!popup) { reject(new Error('El navegador bloqueó el popup de login.')); return; }
      const timer = setInterval(() => {
        try {
          const url = popup.location.href;
          if (url.includes('access_token') || url.includes('error')) {
            clearInterval(timer); popup.close();
            const hash = new URLSearchParams(new URL(url).hash.slice(1));
            const err = hash.get('error');
            if (err) { reject(new Error(err)); return; }
            const token = hash.get('access_token');
            setToken(token, parseInt(hash.get('expires_in') || '3600'));
            resolve(token);
          }
        } catch (e) { /* cross-origin mientras el popup sigue en accounts.google.com */ }
        if (popup.closed) { clearInterval(timer); reject(new Error('Se cerró la ventana de login.')); }
      }, 500);
    });
  }

  return { CLIENT_ID, SCOPES, getToken, setToken, logout, connect };
})();

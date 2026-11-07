/**
 * Habesha / Ethio Bingo - Universal Client Authentication Helper
 * Ensures all player HTTP requests carry Telegram WebApp initData
 * and/or signed player token for cryptographic verification.
 */
(function() {
    function getTelegramInitData() {
        try {
            return window.Telegram?.WebApp?.initData || '';
        } catch (e) {
            return '';
        }
    }

    function getBingoUserId() {
        try {
            const params = new URLSearchParams(window.location.search);
            let uid = params.get('userId');
            if (!uid || uid === '0') {
                if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
                    uid = String(window.Telegram.WebApp.initDataUnsafe.user.id);
                } else {
                    uid = sessionStorage.getItem('bingo_userId') || localStorage.getItem('bingo_userId') || '0';
                }
            }
            if (uid && uid !== '0') {
                try { sessionStorage.setItem('bingo_userId', uid); } catch(e){}
                try { localStorage.setItem('bingo_userId', uid); } catch(e){}
            }
            return uid || '0';
        } catch (e) {
            return '0';
        }
    }

    function getBingoToken() {
        try {
            const params = new URLSearchParams(window.location.search);
            let tok = params.get('token') || params.get('playerToken');
            if (!tok) {
                tok = sessionStorage.getItem('bingo_token') || localStorage.getItem('bingo_token') || '';
            }
            if (tok) {
                try { sessionStorage.setItem('bingo_token', tok); } catch(e){}
                try { localStorage.setItem('bingo_token', tok); } catch(e){}
            }
            return tok || '';
        } catch (e) {
            return '';
        }
    }

    function getAuthHeaders(customHeaders) {
        const headers = {};
        if (customHeaders instanceof Headers) {
            customHeaders.forEach((val, key) => { headers[key] = val; });
        } else if (Array.isArray(customHeaders)) {
            customHeaders.forEach(([key, val]) => { headers[key] = val; });
        } else if (customHeaders && typeof customHeaders === 'object') {
            Object.assign(headers, customHeaders);
        }

        const initData = getTelegramInitData();
        const token = getBingoToken();

        if (initData && !headers['x-telegram-init-data']) {
            headers['x-telegram-init-data'] = initData;
        }
        if (token && !headers['x-player-token']) {
            headers['x-player-token'] = token;
        }
        return headers;
    }

    function getAuthUrl(url) {
        try {
            const parsed = new URL(url, window.location.origin);
            const token = getBingoToken();
            const initData = getTelegramInitData();
            if (token && !parsed.searchParams.has('token') && !parsed.searchParams.has('playerToken')) {
                parsed.searchParams.set('token', token);
            }
            if (initData && !parsed.searchParams.has('initData')) {
                parsed.searchParams.set('initData', initData);
            }
            return parsed.toString();
        } catch (e) {
            return url;
        }
    }

    async function authFetch(url, options) {
        options = options || {};
        const headers = getAuthHeaders(options.headers);
        return fetch(url, {
            ...options,
            headers
        });
    }

    // Auto-patch window.fetch so every /api/ request automatically includes auth headers
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = function(resource, init) {
            try {
                let urlStr = '';
                if (typeof resource === 'string') {
                    urlStr = resource;
                } else if (resource && resource.url) {
                    urlStr = resource.url;
                }

                // If calling an API route, inject Telegram & player authentication headers
                if (urlStr && (urlStr.includes('/api/') || urlStr.startsWith('/api/'))) {
                    init = init || {};
                    init.headers = getAuthHeaders(init.headers);
                }
            } catch (err) {
                console.warn('[auth-client] header injection warning:', err);
            }
            return originalFetch.call(this, resource, init);
        };
    }

    // Expose helpers globally
    window.getTelegramInitData = getTelegramInitData;
    window.getBingoUserId = getBingoUserId;
    window.getBingoToken = getBingoToken;
    window.getAuthHeaders = getAuthHeaders;
    window.getAuthUrl = getAuthUrl;
    window.authFetch = authFetch;
})();

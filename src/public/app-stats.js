// Admin Dashboard Stats & Broadcast Controller (app-stats.js) with Authentication

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initRefreshButton();
    initBroadcastButton();

    // Check if authenticated
    const token = getAdminToken();
    if (!token) {
        showLoginOverlay();
        return;
    }

    // Initial load
    loadAdminStats();
    loadVoiceSetting();

    // Auto-refresh every 15 seconds
    setInterval(() => {
        if (getAdminToken()) loadAdminStats();
    }, 15000);
});

// ----------------------------------------------------
// 0. Authentication, Sliding Session & Inactivity Management
// ----------------------------------------------------

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
let inactivityTimer = null;
let twoFaPollInterval = null;

function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    const token = localStorage.getItem('adminToken');
    if (!token) return;

    inactivityTimer = setTimeout(() => {
        handleInactivityTimeout();
    }, INACTIVITY_TIMEOUT_MS);
}

function handleInactivityTimeout() {
    console.warn('[Admin Auth] Stats session locked due to 15m inactivity.');
    const token = localStorage.getItem('adminToken');
    if (token) {
        fetch('/api/admin/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
    }
    localStorage.removeItem('adminToken');
    showLoginOverlay('⏱️ Session locked due to 15 minutes of inactivity. Please enter password to unlock.');
}

function initInactivityListeners() {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    let throttled = false;
    events.forEach(evName => {
        window.addEventListener(evName, () => {
            if (!throttled) {
                throttled = true;
                resetInactivityTimer();
                setTimeout(() => { throttled = false; }, 3000);
            }
        }, { passive: true });
    });
    resetInactivityTimer();
}

function getAdminToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        const clean = urlToken.trim();
        localStorage.setItem('adminToken', clean);
        // Strip sensitive token from browser address bar
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        resetInactivityTimer();
        return clean;
    }
    return localStorage.getItem('adminToken');
}

function initAuth() {
    const loginForm = document.getElementById('admin-login-form');
    const logoutBtn = document.getElementById('btn-logout-stats');

    initInactivityListeners();

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const passInput = document.getElementById('admin-password-input');
            const submitBtn = document.getElementById('btn-login-submit');
            const errEl = document.getElementById('login-error-msg');
            const password = passInput ? passInput.value.trim() : '';

            if (!password) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Verifying...';
            }
            if (errEl) errEl.style.display = 'none';

            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    if (data.pending2fa && data.loginId) {
                        if (submitBtn) submitBtn.textContent = '⏳ Waiting for Telegram tap...';
                        showLoginOverlay('🔐 2FA approval sent to your Telegram (@BetysNewGamebot)! Tap Approve to unlock.');
                        
                        if (twoFaPollInterval) clearInterval(twoFaPollInterval);
                        twoFaPollInterval = setInterval(async () => {
                            try {
                                const pollRes = await fetch(`/api/admin/login-status/${data.loginId}`);
                                const pollData = await pollRes.json();
                                if (pollData.success && pollData.status === 'APPROVED' && pollData.token) {
                                    clearInterval(twoFaPollInterval);
                                    localStorage.setItem('adminToken', pollData.token);
                                    hideLoginOverlay();
                                    resetInactivityTimer();
                                    if (passInput) passInput.value = '';
                                    await loadAdminStats();
                                    await loadVoiceSetting();
                                } else if (pollData.status === 'REJECTED') {
                                    clearInterval(twoFaPollInterval);
                                    showLoginOverlay('❌ Login request was rejected in Telegram.');
                                    if (submitBtn) {
                                        submitBtn.disabled = false;
                                        submitBtn.textContent = '🚀 Unlock Dashboard';
                                    }
                                }
                            } catch (e) {}
                        }, 1500);
                        return;
                    }

                    if (data.token) {
                        localStorage.setItem('adminToken', data.token);
                        hideLoginOverlay();
                        resetInactivityTimer();
                        if (passInput) passInput.value = '';
                        await loadAdminStats();
                        await loadVoiceSetting();
                    }
                } else {
                    const errMsg = data.error || data.msg || (data.reason ? `Access restricted: ${data.reason}` : 'Incorrect admin password.');
                    showLoginOverlay(errMsg);
                }
            } catch (err) {
                showLoginOverlay('Network error verifying password.');
            } finally {
                if (submitBtn && (!data || !data.pending2fa)) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '🚀 Unlock Dashboard';
                }
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const token = getAdminToken();
            if (token) {
                try {
                    await fetch('/api/admin/logout', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                } catch (e) {}
            }
            if (inactivityTimer) clearTimeout(inactivityTimer);
            localStorage.removeItem('adminToken');
            showLoginOverlay();
        });
    }
}

function showLoginOverlay(errorMsg = '') {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'flex';
    const errEl = document.getElementById('login-error-msg');
    if (errEl) {
        if (errorMsg) {
            errEl.textContent = errorMsg;
            errEl.style.display = 'block';
        } else {
            errEl.style.display = 'none';
        }
    }
}

function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function authFetch(url, options = {}) {
    const token = getAdminToken();
    if (!token) {
        showLoginOverlay();
        throw new Error('Unauthorized');
    }

    const headers = {
        ...(options.headers || {}),
        'Authorization': `Bearer ${token}`
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        localStorage.removeItem('adminToken');
        if (inactivityTimer) clearTimeout(inactivityTimer);
        showLoginOverlay('Session expired or server was restarted. Please log in again.');
        throw new Error('Unauthorized');
    }
    if (res.status === 403) {
        localStorage.removeItem('adminToken');
        if (inactivityTimer) clearTimeout(inactivityTimer);
        let errorMsg = '🚫 Access Denied: Your IP address has been temporarily banned by the administrator.';
        try {
            const data = await res.clone().json();
            if (data.error || data.reason) {
                errorMsg = `🚫 ${data.error || 'Access Denied'}: ${data.reason || 'IP restricted'}`;
            }
        } catch (e) {}
        showLoginOverlay(errorMsg);
        throw new Error('Forbidden');
    }

    resetInactivityTimer();
    return res;
}

// ----------------------------------------------------
// 1. Fetch & Render Admin Stats
// ----------------------------------------------------
async function loadAdminStats() {
    if (!getAdminToken()) return;
    const refreshSpan = document.getElementById('refreshing');
    const updatedAtEl = document.getElementById('updated-at');

    if (refreshSpan) refreshSpan.style.display = 'inline';

    try {
        const res = await authFetch('/api/admin/stats');
        if (!res.ok) throw new Error('Failed to fetch admin stats');
        const data = await res.json();

        // Cards
        setText('s-users', (data.users ?? 0).toLocaleString());

        const growthEl = document.getElementById('s-growth');
        if (growthEl) {
            const rate = data.growthRate ?? 0;
            const sign = rate > 0 ? '+' : '';
            growthEl.textContent = `${sign}${rate}%`;
            growthEl.className = 'stat-value ' + (rate >= 0 ? 'growth-up' : 'growth-down');
        }

        const growthDetailEl = document.getElementById('s-growth-detail');
        if (growthDetailEl) {
            growthDetailEl.textContent = `+${data.newUsers ?? 0} this week (vs ${data.prevUsers ?? 0} last week)`;
        }

        setText('s-deposits', (data.totalDeposits ?? 0).toLocaleString());
        setText('s-withdrawals', (data.totalWithdrawals ?? 0).toLocaleString());
        setText('s-net', (data.net ?? 0).toLocaleString());

        const cardNet = document.getElementById('card-net');
        if (cardNet) {
            if ((data.net ?? 0) >= 0) {
                cardNet.classList.add('good');
                cardNet.classList.remove('bad');
            } else {
                cardNet.classList.add('bad');
                cardNet.classList.remove('good');
            }
        }

        setText('s-balance', (data.totalBalance ?? 0).toLocaleString());
        setText('s-pending', (data.pendingCount ?? 0).toLocaleString());

        // Fetch House Profit and Game Stats
        try {
            const fRes = await authFetch('/api/admin/financial-summary?period=all');
            if (fRes.ok) {
                const fData = await fRes.json();
                setText('s-profit', (fData.totalHouseProfit ?? 0).toLocaleString());
                setText('s-pot', (fData.totalPot ?? 0).toLocaleString());
                setText('s-payout', (fData.totalWinnerPayout ?? 0).toLocaleString());
                setText('s-games', (fData.totalGames ?? 0).toLocaleString());
            }
        } catch (e) {}

        const approvedCount = (data.statusCounts && data.statusCounts.APPROVED) 
            ?? ((data.depStatus?.APPROVED ?? 0) + (data.wdrStatus?.APPROVED ?? 0));
        setText('s-approved', approvedCount.toLocaleString());

        // Breakdown Table
        setText('b-dep-pending', (data.depStatus?.PENDING ?? 0).toLocaleString());
        setText('b-dep-approved', (data.depStatus?.APPROVED ?? 0).toLocaleString());
        setText('b-dep-rejected', (data.depStatus?.REJECTED ?? 0).toLocaleString());

        setText('b-wdr-pending', (data.wdrStatus?.PENDING ?? 0).toLocaleString());
        setText('b-wdr-approved', (data.wdrStatus?.APPROVED ?? 0).toLocaleString());
        setText('b-wdr-rejected', (data.wdrStatus?.REJECTED ?? 0).toLocaleString());

        if (updatedAtEl) {
            updatedAtEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
            updatedAtEl.style.color = 'rgba(255,255,255,0.5)';
        }
    } catch (err) {
        console.error('Error loading admin stats:', err);
        if (updatedAtEl) {
            updatedAtEl.textContent = 'Connection error';
            updatedAtEl.style.color = '#ff5555';
        }
    } finally {
        if (refreshSpan) refreshSpan.style.display = 'none';
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ----------------------------------------------------
// 2. Refresh Button
// ----------------------------------------------------
function initRefreshButton() {
    const btn = document.getElementById('btn-refresh');
    if (btn) {
        btn.addEventListener('click', () => {
            loadAdminStats();
            loadVoiceSetting();
        });
    }
}

// ----------------------------------------------------
// 3. Caller Voice Control
// ----------------------------------------------------
async function loadVoiceSetting() {
    if (!getAdminToken()) return;
    try {
        const res = await authFetch('/api/admin/voice');
        if (!res.ok) return;
        const data = await res.json();
        const badge = document.getElementById('voice-current-badge');
        if (badge) {
            if (data.voice === 'female') {
                badge.textContent = 'Active: 👩 Female (ሴት)';
                badge.style.color = '#ff80ab';
            } else {
                badge.textContent = 'Active: 👨 Male (ወንድ)';
                badge.style.color = '#90caf9';
            }
        }
    } catch (e) {}
}

window.setVoice = async function(voice) {
    const statusEl = document.getElementById('voice-status');
    if (statusEl) {
        statusEl.textContent = 'Updating caller voice...';
        statusEl.style.color = '#ffcc00';
    }
    try {
        const res = await authFetch('/api/admin/voice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice })
        });
        const data = await res.json();
        if (data.success && statusEl) {
            statusEl.textContent = `✅ Successfully switched to ${voice === 'female' ? '👩 Female' : '👨 Male'} voice! All players are updated.`;
            statusEl.style.color = '#22ff88';
            loadVoiceSetting();
        } else if (statusEl) {
            statusEl.textContent = '❌ Failed to update voice: ' + (data.msg || 'Unknown error');
            statusEl.style.color = '#ff5555';
        }
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = '❌ Network error updating voice.';
            statusEl.style.color = '#ff5555';
        }
    }
};

// ----------------------------------------------------
// 4. Broadcast to Players
// ----------------------------------------------------
function initBroadcastButton() {
    const btn = document.getElementById('btn-broadcast');
    const imgInput = document.getElementById('bc-image');
    const textInput = document.getElementById('bc-text');
    const statusEl = document.getElementById('bc-status');

    if (!btn) return;

    btn.addEventListener('click', async () => {
        const imageUrl = imgInput ? imgInput.value.trim() : '';
        const caption = textInput ? textInput.value.trim() : '';

        if (!imageUrl && !caption) {
            if (statusEl) {
                statusEl.textContent = '⚠️ Please enter a caption or an image URL.';
                statusEl.style.color = '#ffcc00';
            }
            return;
        }

        const ok = confirm('Are you sure you want to send this broadcast to all registered players on Telegram?');
        if (!ok) return;

        btn.disabled = true;
        btn.textContent = '⏳ Sending broadcast...';
        if (statusEl) {
            statusEl.textContent = 'Sending broadcast to all players... Please wait.';
            statusEl.style.color = '#ffcc00';
        }

        try {
            const res = await authFetch('/api/admin/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl: imageUrl || undefined,
                    caption: caption || undefined,
                    text: caption || undefined
                })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                if (statusEl) {
                    statusEl.textContent = `✅ Broadcast delivered to ${data.sent} players (${data.failed} failed) out of ${data.totalUsers} total.`;
                    statusEl.style.color = '#22ff88';
                }
                if (textInput) textInput.value = '';
                if (imgInput) imgInput.value = '';
            } else {
                if (statusEl) {
                    statusEl.textContent = '❌ Broadcast failed: ' + (data.msg || data.error || 'Server error');
                    statusEl.style.color = '#ff5555';
                }
            }
        } catch (err) {
            console.error('Broadcast error:', err);
            if (statusEl) {
                statusEl.textContent = '❌ Network error sending broadcast.';
                statusEl.style.color = '#ff5555';
            }
        } finally {
            btn.disabled = false;
            btn.textContent = '🚀 Send Broadcast to All Players';
        }
    });
}

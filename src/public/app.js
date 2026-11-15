// Bingo Admin Dashboard Controller (app.js) with Authentication

let allRequests = [];
let allUsers = [];
let pendingDeleteUserId = null;
let currentFilter = 'ALL';
let currentPeriod = 'today';
let selectedRequestIds = new Set();
let isActionRunning = false;

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initPeriodFilters();
    initRequestFilters();
    initForceStart();
    initBatchActions();
    initEditModal();
    initUserModals();
    initAuditPeriodFilters();
    
    // Check if authenticated
    const token = getAdminToken();
    if (!token) {
        showLoginOverlay();
        return;
    }

    // Initial fetch
    refreshAllData();

    // Auto-refresh every 10 seconds for real-time live monitoring
    setInterval(() => {
        if (getAdminToken()) refreshAllData();
    }, 10000);
});

// ----------------------------------------------------
// Tab Navigation Controller
// ----------------------------------------------------
function switchAdminTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
    if (tabId === 'tab-admins') {
        fetchAdmins();
        fetchAdminBanks();
        fetchDutyWithdrawalAdmin();
        fetchWithdrawalBanks();
    } else if (tabId === 'tab-admin-audit') {
        fetchAdminAuditStats();
    } else if (tabId === 'tab-controls') {
        loadSecurityStats();
    }
}
window.switchAdminTab = switchAdminTab;

// ----------------------------------------------------
// 0. Authentication, Sliding Session & Inactivity Management
// ----------------------------------------------------

// 15-minute inactivity timeout (sliding window: never logs out while active)
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
    console.warn('[Admin Auth] Session locked due to 15m inactivity.');
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
    const logoutBtn = document.getElementById('btn-logout');

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
                        // 2FA Flow: Wait for Telegram approval
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
                                    await refreshAllData();
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
                        await refreshAllData();
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

    // Refresh sliding session activity on every successful authenticated API call
    resetInactivityTimer();
    return res;
}

async function refreshAllData() {
    if (!getAdminToken()) return;
    const searchInput = document.getElementById('user-search-input');
    const searchQuery = searchInput ? searchInput.value.trim() : '';
    await Promise.allSettled([
        fetchFinancialSummary(),
        fetchHouseIncome(),
        fetchStats(),
        fetchUsers(searchQuery),
        fetchRequests(),
        fetchCallerVoice(),
        fetchBonusSettings(),
        fetchWinCallThreshold(),
        fetchBotSettings(),
        fetchAdmins(),
        fetchAdminBanks(),
        fetchWithdrawalBanks(),
        fetchAdminAuditStats(),
        loadSecurityStats()
    ]);
}

async function loadSecurityStats() {
    const container = document.getElementById('sec-jailed-container');
    if (!container) return;
    try {
        const res = await authFetch('/api/admin/security/stats');
        const data = await res.json();
        if (data.success && data.stats) {
            const list = data.stats.jailedList || [];
            if (list.length === 0) {
                container.innerHTML = '<div style="color:#4ade80; font-size:13px; font-weight:600;">🟢 No IPs currently banned. All systems quiet.</div>';
            } else {
                let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
                list.forEach(j => {
                    html += `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); padding:8px 12px; border-radius:6px; font-size:12px;">
                            <div>
                                <strong style="color:#f87171; font-family:monospace; font-size:13px;">${j.ip}</strong>
                                <span style="color:#cbd5e1; margin-left:8px;">${j.reason}</span>
                                <span style="color:#94a3b8; margin-left:6px;">(${j.expiresInMinutes}m remaining)</span>
                            </div>
                            <button onclick="unbanIpWeb('${j.ip}')" class="action-btn-sm" style="background:#22c55e; border:none; color:#fff; padding:4px 10px; border-radius:4px; font-weight:700; cursor:pointer; font-size:11px;">🔓 Unban</button>
                        </div>
                    `;
                });
                html += '</div>';
                container.innerHTML = html;
            }
        }
    } catch (e) {
        container.innerHTML = '<div style="color:#94a3b8; font-size:12px;">Unable to load security stats.</div>';
    }
}
window.loadSecurityStats = loadSecurityStats;

async function unbanIpWeb(ip) {
    if (!confirm(`Unban IP ${ip}?`)) return;
    try {
        const res = await authFetch('/api/admin/security/unban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ IP ${ip} has been unbanned!`);
            loadSecurityStats();
        }
    } catch (e) {
        alert('Failed to unban IP');
    }
}
window.unbanIpWeb = unbanIpWeb;

// ----------------------------------------------------
// 1. Global Period Filter (Default: Today / ዛሬ)
// ----------------------------------------------------
function initPeriodFilters() {
    const periodButtons = document.querySelectorAll('.btn-period');
    const indicator = document.getElementById('period-indicator');

    const labels = {
        'today': 'Today (ዛሬ)',
        'yesterday': 'Yesterday (ትናንት)',
        '7d': 'Last 7 Days (ያለፉት 7 ቀናት)',
        '30d': 'This Month (ይህ ወር)',
        'all': 'All Time (ሁሉንም)'
    };

    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const p = btn.getAttribute('data-period') || 'today';
            currentPeriod = p;

            if (indicator) {
                indicator.textContent = `Showing: ${labels[p] || p}`;
            }

            // Immediately refresh data for the new period
            selectedRequestIds.clear();
            updateBatchToolbar();
            refreshAllData();
        });
    });
}

// ----------------------------------------------------
// 2. Period Financial Summary
// ----------------------------------------------------
async function fetchFinancialSummary() {
    try {
        const res = await authFetch(`/api/admin/financial-summary?period=${currentPeriod}`);
        if (!res.ok) throw new Error('Financial summary fetch failed');
        const data = await res.json();

        setText('stat-house-profit', (data.totalHouseProfit ?? 0).toLocaleString());
        setText('stat-games-played', (data.totalGames ?? 0).toLocaleString());
        setText('stat-total-pot', (data.totalPot ?? 0).toLocaleString());
        setText('stat-winner-payout', (data.totalWinnerPayout ?? 0).toLocaleString());
        setText('stat-net-cash', (data.netCashFlow ?? 0).toLocaleString());
        setText('stat-period-dep', (data.totalDeposits ?? 0).toLocaleString());
        setText('stat-dep-count', (data.depositsCount ?? 0).toLocaleString());
        setText('stat-period-wdr', (data.totalWithdrawals ?? 0).toLocaleString());
        setText('stat-wdr-count', (data.withdrawalsCount ?? 0).toLocaleString());

        if (data.pendingCount !== undefined) {
            setText('tab-badge-pending', String(data.pendingCount));
        }

        const netCashEl = document.getElementById('stat-net-cash');
        if (netCashEl) {
            netCashEl.style.color = (data.netCashFlow ?? 0) >= 0 ? '#4ade80' : '#f87171';
        }
    } catch (err) {
        console.error('Error fetching financial summary:', err);
    }
}

let currentIncomeLobbyFilter = localStorage.getItem('bingo_admin_income_lobby') || 'all';

function setIncomeLobbyFilter(filter) {
    currentIncomeLobbyFilter = filter;
    try {
        localStorage.setItem('bingo_admin_income_lobby', filter);
    } catch {}
    updateIncomeLobbyFilterUI();
    fetchHouseIncome();
}

function updateIncomeLobbyFilterUI() {
    const btnAll = document.getElementById('income-filter-btn-all');
    const btn10 = document.getElementById('income-filter-btn-10');
    const btn20 = document.getElementById('income-filter-btn-20');

    if (btnAll) {
        if (currentIncomeLobbyFilter === 'all') {
            btnAll.style.background = '#8b5cf6';
            btnAll.style.color = '#fff';
            btnAll.style.border = 'none';
        } else {
            btnAll.style.background = 'rgba(139, 92, 246, 0.15)';
            btnAll.style.color = '#c4b5fd';
            btnAll.style.border = '1px solid rgba(139, 92, 246, 0.35)';
        }
    }

    if (btn10) {
        if (currentIncomeLobbyFilter === '10') {
            btn10.style.background = '#facc15';
            btn10.style.color = '#000';
            btn10.style.border = 'none';
        } else {
            btn10.style.background = 'rgba(250, 204, 21, 0.15)';
            btn10.style.color = '#facc15';
            btn10.style.border = '1px solid rgba(250, 204, 21, 0.35)';
        }
    }

    if (btn20) {
        if (currentIncomeLobbyFilter === '20') {
            btn20.style.background = '#c084fc';
            btn20.style.color = '#000';
            btn20.style.border = 'none';
        } else {
            btn20.style.background = 'rgba(192, 132, 252, 0.15)';
            btn20.style.color = '#c084fc';
            btn20.style.border = '1px solid rgba(192, 132, 252, 0.35)';
        }
    }
}

// ----------------------------------------------------
// 3. House Income & Game Payouts Table
// ----------------------------------------------------
async function fetchHouseIncome() {
    try {
        const feeQuery = (currentIncomeLobbyFilter && currentIncomeLobbyFilter !== 'all') ? `&fee=${encodeURIComponent(currentIncomeLobbyFilter)}` : '';
        const res = await authFetch(`/api/admin/income?period=${currentPeriod}${feeQuery}`);
        if (!res.ok) throw new Error('House income fetch failed');
        const data = await res.json();

        updateIncomeLobbyFilterUI();

        // Populate Top KPI Cards
        const byLobby = data.byLobby || {};
        const l10 = byLobby['10'] || { totalGames: 0, totalPot: 0, totalHouseProfit: 0 };
        const l20 = byLobby['20'] || { totalGames: 0, totalPot: 0, totalHouseProfit: 0 };
        const summary = data.summary || {};

        setText('income-kpi-total-profit', (summary.totalHouseProfit ?? 0).toLocaleString());
        setText('income-kpi-total-games', `${(summary.totalGames ?? 0).toLocaleString()} games`);
        setText('income-kpi-total-pot', (summary.totalPot ?? 0).toLocaleString());

        setText('income-kpi-10-profit', (l10.totalHouseProfit ?? 0).toLocaleString());
        setText('income-kpi-10-games', `${(l10.totalGames ?? 0).toLocaleString()} games`);
        setText('income-kpi-10-pot', (l10.totalPot ?? 0).toLocaleString());

        setText('income-kpi-20-profit', (l20.totalHouseProfit ?? 0).toLocaleString());
        setText('income-kpi-20-games', `${(l20.totalGames ?? 0).toLocaleString()} games`);
        setText('income-kpi-20-pot', (l20.totalPot ?? 0).toLocaleString());

        const tbody = document.querySelector('#income-table tbody');
        if (!tbody) return;

        const incomes = data.incomes || [];

        if (incomes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:24px;">No games recorded for this filter in this period.</td></tr>`;
        } else {
            tbody.innerHTML = incomes.map(i => {
                const dateStr = i.createdAt
                    ? new Date(i.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : '—';

                function formatUserBadge(name, username, id, isBot) {
                    if (isBot || id === 'bot' || (id && Number(id) < 0)) {
                        return `<span style="background:rgba(139,92,246,0.22); border:1px solid rgba(139,92,246,0.45); color:#c4b5fd; padding:3px 8px; border-radius:6px; font-size:12px; font-weight:700; display:inline-flex; align-items:center; gap:4px;">🤖 ${escapeHtml(name || 'Bot Player')} <span style="font-size:10px; opacity:0.85;">(Bot)</span></span>`;
                    }
                    if (username) {
                        return `<strong>${escapeHtml(name || 'Winner')}</strong><br><a href="https://t.me/${username}" target="_blank" style="color:#38bdf8; font-size:12px; text-decoration:none;">@${escapeHtml(username)}</a>`;
                    }
                    if (name) {
                        return `<strong>${escapeHtml(name)}</strong>`;
                    }
                    return `<span style="color:#64748b;">ID: ${escapeHtml(String(id || '—'))}</span>`;
                }

                function formatLobbyBadge(fee, room) {
                    const rNum = room || 1;
                    if (fee === 10) {
                        return `<span style="background:rgba(250,204,21,0.18); border:1px solid rgba(250,204,21,0.4); color:#facc15; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px; white-space:nowrap;">🟡 10 Birr #${rNum}</span>`;
                    }
                    if (fee === 20) {
                        return `<span style="background:rgba(192,132,252,0.18); border:1px solid rgba(192,132,252,0.4); color:#c084fc; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px; white-space:nowrap;">🟣 20 Birr #${rNum}</span>`;
                    }
                    return `<span style="background:rgba(148,163,184,0.18); border:1px solid rgba(148,163,184,0.4); color:#cbd5e1; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px; white-space:nowrap;">${fee || 10} Birr #${rNum}</span>`;
                }

                let winnerDisplay = '—';
                const isAllBlocked = Boolean(i.winnerCount === 0);
                const hasTwoWinners = Boolean(!isAllBlocked && ((i.winnerCount && i.winnerCount > 1) || i.winner2Id));

                if (isAllBlocked) {
                    winnerDisplay = `<span style="color:#ef4444; font-weight:700;">⛔ All Blocked (No Winner)</span>`;
                } else if (hasTwoWinners) {
                    const w1 = formatUserBadge(i.winnerName, i.winnerUsername, i.winnerId, i.isBot);
                    const w2 = formatUserBadge(i.winner2Name, i.winner2Username, i.winner2Id, i.isBot2);
                    winnerDisplay = `<div style="display:flex; flex-direction:column; gap:4px;">
                        <div>${w1}</div>
                        <div style="color:#f59e0b; font-size:11px; font-weight:700;">🤝 Shared Jackpot</div>
                        <div>${w2}</div>
                    </div>`;
                } else if (i.winnerId || i.isBot || i.winnerName) {
                    winnerDisplay = formatUserBadge(i.winnerName, i.winnerUsername, i.winnerId, i.isBot);
                }

                const isAllBots = Boolean(
                    !isAllBlocked && (
                        (!hasTwoWinners && (i.isBot || i.winnerId === 'bot' || (i.winnerId && Number(i.winnerId) < 0))) ||
                        (hasTwoWinners && i.isBot && i.isBot2)
                    )
                );

                const perWinner = (i.splitPayout !== undefined && i.splitPayout !== null && i.splitPayout > 0)
                    ? i.splitPayout
                    : Math.floor(((i.pot || 0) * 0.8) / (i.winnerCount || 2));

                const payoutDisplay = isAllBlocked
                    ? `<strong style="color:#94a3b8;">0</strong> <span class="currency">Birr</span>`
                    : (isAllBots
                        ? `<strong style="color:#94a3b8;">0</strong> <span class="currency">Birr</span> <span style="color:#a78bfa; font-size:11px; font-weight:600;">(Bot Win)</span>`
                        : (hasTwoWinners
                            ? `<strong style="color:#38bdf8;">${(i.winnerPayout ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span><br><span style="color:#94a3b8; font-size:11px; font-weight:600;">(${perWinner.toLocaleString()} Birr each)</span>`
                            : `<strong style="color:#38bdf8;">${(i.winnerPayout ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span>`));

                return `
                    <tr>
                        <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(i.id))}</td>
                        <td>${formatLobbyBadge(i.fee, i.room)}</td>
                        <td style="color:#94a3b8; font-size:12px; white-space:nowrap;">${dateStr}</td>
                        <td><strong style="color:#f8fafc;">${i.playerCount}</strong></td>
                        <td><strong>${(i.pot ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                        <td>${payoutDisplay}</td>
                        <td><strong style="color:#4ade80;">${(i.houseProfit ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                        <td>${winnerDisplay}</td>
                    </tr>
                `;
            }).join('');
        }

        // Totals Footer
        setText('tot-players', (summary.totalPlayers ?? 0).toLocaleString());
        setText('tot-pot', `${(summary.totalPot ?? 0).toLocaleString()} Birr`);
        setText('tot-payout', `${(summary.totalWinnerPayout ?? 0).toLocaleString()} Birr`);
        setText('tot-profit', `${(summary.totalHouseProfit ?? 0).toLocaleString()} Birr`);
    } catch (err) {
        console.error('Error fetching house income:', err);
    }
}

// ----------------------------------------------------
// 4. Live Stats (Users, Balances, Game State)
// ----------------------------------------------------
async function fetchStats() {
    try {
        const res = await authFetch('/api/stats');
        if (!res.ok) throw new Error('Stats fetch failed');
        const data = await res.json();

        setText('stat-users', (data.users ?? 0).toLocaleString());
        setText('stat-balance', (data.balance ?? 0).toLocaleString());
        setText('stat-players', (data.activePlayers ?? 0).toLocaleString());

        const statState = document.getElementById('stat-state');
        if (statState) {
            statState.textContent = data.gameState || 'WAITING';
            statState.style.color = data.gameState === 'PLAYING' ? '#4ade80' : '#facc15';
        }

        const btnStart = document.getElementById('btn-start');
        if (btnStart) {
            if (data.gameState === 'PLAYING') {
                btnStart.textContent = 'Game In Progress...';
                btnStart.style.opacity = '0.6';
                btnStart.disabled = true;
            } else {
                btnStart.textContent = 'Force Start Game';
                btnStart.style.opacity = '1';
                btnStart.disabled = false;
            }
        }

        // Live Room Lobbies Breakdown (10 Birr & 20 Birr Rooms)
        const rooms = Array.isArray(data.rooms) ? data.rooms : [];
        const r10 = rooms.find(r => r.fee === 10 && r.room === 1);
        const r20 = rooms.find(r => r.fee === 20 && r.room === 1);

        // Update 10 Birr Room Card
        if (r10) {
            const bTaken10 = r10.boardsTaken ?? r10.playersCount ?? 0;
            setText('room-10-players', (r10.playersCount ?? 0).toLocaleString());
            setText('room-10-pot', (r10.pot ?? 0).toLocaleString());
            setText('room-10-boards', bTaken10.toLocaleString());
            const badge10 = document.getElementById('room-10-badge');
            const details10 = document.getElementById('room-10-details');
            const btnStart10 = document.getElementById('btn-start-10');
            const isPlaying10 = r10.state === 'PLAYING';
            if (badge10) {
                badge10.textContent = isPlaying10 ? `🟢 PLAYING (${r10.drawnCount} calls)` : `🟡 LOBBY (${r10.lobbyCountdown}s)`;
                badge10.style.background = isPlaying10 ? 'rgba(74, 222, 128, 0.2)' : 'rgba(250, 204, 21, 0.2)';
                badge10.style.color = isPlaying10 ? '#4ade80' : '#facc15';
            }
            if (details10) {
                details10.innerHTML = `Pot: <strong style="color:#fff;">${(r10.pot ?? 0).toLocaleString()} Birr</strong> • Boards: <strong style="color:#facc15;">${bTaken10}/500</strong> • ${isPlaying10 ? `In Progress (${r10.drawnCount} calls)` : `Lobby (${r10.lobbyCountdown}s)`}`;
            }
            if (btnStart10) {
                if (isPlaying10) {
                    btnStart10.textContent = 'In Game...';
                    btnStart10.disabled = true;
                    btnStart10.style.opacity = '0.5';
                } else {
                    btnStart10.textContent = '▶ Force Start';
                    btnStart10.disabled = false;
                    btnStart10.style.opacity = '1';
                }
            }
        }

        // Update 20 Birr Room Card
        if (r20) {
            const bTaken20 = r20.boardsTaken ?? r20.playersCount ?? 0;
            setText('room-20-players', (r20.playersCount ?? 0).toLocaleString());
            setText('room-20-pot', (r20.pot ?? 0).toLocaleString());
            setText('room-20-boards', bTaken20.toLocaleString());
            const badge20 = document.getElementById('room-20-badge');
            const details20 = document.getElementById('room-20-details');
            const btnStart20 = document.getElementById('btn-start-20');
            const isPlaying20 = r20.state === 'PLAYING';
            if (badge20) {
                badge20.textContent = isPlaying20 ? `🟢 PLAYING (${r20.drawnCount} calls)` : `🟡 LOBBY (${r20.lobbyCountdown}s)`;
                badge20.style.background = isPlaying20 ? 'rgba(74, 222, 128, 0.2)' : 'rgba(192, 132, 252, 0.2)';
                badge20.style.color = isPlaying20 ? '#4ade80' : '#c084fc';
            }
            if (details20) {
                details20.innerHTML = `Pot: <strong style="color:#fff;">${(r20.pot ?? 0).toLocaleString()} Birr</strong> • Boards: <strong style="color:#c084fc;">${bTaken20}/500</strong> • ${isPlaying20 ? `In Progress (${r20.drawnCount} calls)` : `Lobby (${r20.lobbyCountdown}s)`}`;
            }
            if (btnStart20) {
                if (isPlaying20) {
                    btnStart20.textContent = 'In Game...';
                    btnStart20.disabled = true;
                    btnStart20.style.opacity = '0.5';
                } else {
                    btnStart20.textContent = '▶ Force Start';
                    btnStart20.disabled = false;
                    btnStart20.style.opacity = '1';
                }
            }
        }

        // Update Breakdown Subtitle on All Rooms Card
        const breakdownEl = document.getElementById('stat-players-breakdown');
        if (breakdownEl) {
            const count10 = r10 ? (r10.playersCount ?? 0) : 0;
            const count20 = r20 ? (r20.playersCount ?? 0) : 0;
            const b10 = r10 ? (r10.boardsTaken ?? count10) : 0;
            const b20 = r20 ? (r20.boardsTaken ?? count20) : 0;
            breakdownEl.innerHTML = `📍 10 Birr: <strong>${count10}</strong> (${b10} bds) | 20 Birr: <strong>${count20}</strong> (${b20} bds) • <em>Click to inspect</em>`;
        }
    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

// ----------------------------------------------------
// 5. Users Management Table
// ----------------------------------------------------
async function fetchUsers(searchQuery = '') {
    try {
        const url = searchQuery 
            ? `/api/admin/users?search=${encodeURIComponent(searchQuery)}`
            : '/api/users';
        const res = await authFetch(url);
        if (!res.ok) throw new Error('Users fetch failed');
        const users = await res.json();
        allUsers = Array.isArray(users) ? users : [];

        setText('tab-badge-users', String(allUsers.length));

        const tbody = document.querySelector('#users-table tbody');
        if (!tbody) return;

        if (allUsers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#94a3b8; padding:24px;">No users found.</td></tr>`;
            return;
        }

        tbody.innerHTML = allUsers.map(u => {
            const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Player';
            const usernameHtml = u.username 
                ? `<strong>${escapeHtml(fullName)}</strong><br><a href="https://t.me/${u.username}" target="_blank" style="color:#38bdf8; text-decoration:none; font-size:12px; font-weight:600;">@${escapeHtml(u.username)}</a>`
                : `<strong>${escapeHtml(fullName)}</strong>`;
            
            const statusHtml = u.banned
                ? `<span class="badge-banned">Banned</span>`
                : `<span class="badge-active">Active</span>`;

            return `
                <tr>
                    <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(u.id))}</td>
                    <td>${usernameHtml}</td>
                    <td style="color:#e2e8f0; font-size:13px;">${escapeHtml(u.phone || '—')}</td>
                    <td><strong style="color:#4ade80;">${(u.balance ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                    <td><strong style="color:#38bdf8;">${(u.withdrawableBalance ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                    <td><strong style="color:#fbbf24;">${(u.bonus ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                    <td><span style="color:#94a3b8;">${u.gamesPlayed ?? 0}</span> / <strong style="color:#38bdf8;">${u.wins ?? 0}</strong></td>
                    <td>${statusHtml}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button onclick="promoteUserToAdmin('${u.id}')" class="action-btn-sm" style="background:#8b5cf6; color:#fff;" title="Make Administrator">👑 Admin</button>
                            <button onclick="openEditUserModal('${u.id}')" class="action-btn-sm" style="background:#3b82f6; color:#fff;" title="Edit user">✏️ Edit</button>
                            <button onclick="openDeleteUserModal('${u.id}')" class="action-btn-sm" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);" title="Delete user">🗑</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error fetching users:', err);
    }
}

// ----------------------------------------------------
// 6. Deposit & Withdraw Requests
// ----------------------------------------------------
async function fetchRequests() {
    try {
        const res = await authFetch(`/api/requests?period=${currentPeriod}`);
        if (!res.ok) throw new Error('Requests fetch failed');
        allRequests = await res.json();

        const pendingCount = allRequests.filter(r => r.status === 'PENDING').length;
        setText('tab-badge-pending', String(pendingCount));

        renderRequests();
    } catch (err) {
        console.error('Error fetching requests:', err);
    }
}

function initRequestFilters() {
    const filters = [
        { id: 'filter-pending', key: 'PENDING' },
        { id: 'filter-approved', key: 'APPROVED' },
        { id: 'filter-rejected', key: 'REJECTED' },
        { id: 'filter-all', key: 'ALL' }
    ];

    filters.forEach(f => {
        const btn = document.getElementById(f.id);
        if (btn) {
            btn.addEventListener('click', () => {
                currentFilter = f.key;
                renderRequests();
            });
        }
    });

    const checkAll = document.getElementById('check-all-req');
    if (checkAll) {
        checkAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            let filtered = allRequests;
            if (currentFilter !== 'ALL') {
                filtered = allRequests.filter(r => r.status === currentFilter);
            }
            const selectable = filtered.filter(r => r.status !== 'APPROVED');

            if (isChecked) {
                selectable.forEach(r => selectedRequestIds.add(r.id));
            } else {
                selectedRequestIds.clear();
            }
            renderRequests();
        });
    }
}

function updateFilterButtonStyles() {
    const pendingCount = allRequests.filter(r => r.status === 'PENDING').length;
    const approvedCount = allRequests.filter(r => r.status === 'APPROVED').length;
    const rejectedCount = allRequests.filter(r => r.status === 'REJECTED').length;
    const totalCount = allRequests.length;

    const btnPending = document.getElementById('filter-pending');
    const btnApproved = document.getElementById('filter-approved');
    const btnRejected = document.getElementById('filter-rejected');
    const btnAll = document.getElementById('filter-all');

    if (btnPending) btnPending.textContent = `Pending (${pendingCount})`;
    if (btnApproved) btnApproved.textContent = `Approved (${approvedCount})`;
    if (btnRejected) btnRejected.textContent = `Rejected (${rejectedCount})`;
    if (btnAll) btnAll.textContent = `All (${totalCount})`;

    const map = [
        { btn: btnPending, key: 'PENDING' },
        { btn: btnApproved, key: 'APPROVED' },
        { btn: btnRejected, key: 'REJECTED' },
        { btn: btnAll, key: 'ALL' }
    ];

    map.forEach(item => {
        if (!item.btn) return;
        if (item.key === currentFilter) {
            item.btn.style.background = 'linear-gradient(135deg, #8b5cf6, #3b82f6)';
            item.btn.style.color = '#fff';
            item.btn.style.border = '1px solid rgba(255,255,255,0.4)';
            item.btn.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.4)';
        } else {
            item.btn.style.background = 'rgba(255, 255, 255, 0.08)';
            item.btn.style.color = '#94a3b8';
            item.btn.style.border = '1px solid rgba(255,255,255,0.1)';
            item.btn.style.boxShadow = 'none';
        }
    });
}

function updateBatchToolbar() {
    const toolbar = document.getElementById('batch-toolbar');
    const countSpan = document.getElementById('batch-count');
    const checkAll = document.getElementById('check-all-req');

    const count = selectedRequestIds.size;
    if (toolbar) {
        toolbar.style.display = count > 0 ? 'flex' : 'none';
    }
    if (countSpan) {
        countSpan.textContent = `${count} selected`;
    }
    if (checkAll) {
        let filtered = allRequests;
        if (currentFilter !== 'ALL') {
            filtered = allRequests.filter(r => r.status === currentFilter);
        }
        const selectable = filtered.filter(r => r.status !== 'APPROVED');
        checkAll.checked = selectable.length > 0 && selectable.every(r => selectedRequestIds.has(r.id));
    }
}

function renderRequests() {
    updateFilterButtonStyles();
    updateBatchToolbar();

    const tbody = document.querySelector('#req-table tbody');
    if (!tbody) return;

    let filtered = allRequests;
    if (currentFilter !== 'ALL') {
        filtered = allRequests.filter(r => r.status === currentFilter);
    }

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#94a3b8; padding:24px;">No requests found in this category.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const isChecked = selectedRequestIds.has(r.id);
        const userDisplay = r.username
            ? `<strong>${escapeHtml(r.name || 'Player')}</strong><br><a href="https://t.me/${r.username}" target="_blank" style="color:#38bdf8; font-size:12px; text-decoration:none;">@${escapeHtml(r.username)}</a>`
            : `<strong>${escapeHtml(r.name || 'Player')}</strong><br><span style="color:#64748b; font-size:12px;">ID: ${escapeHtml(String(r.userId || ''))}</span>`;

        const typeBadge = r.type === 'deposit'
            ? `<span style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid rgba(34,197,94,0.4); padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px; letter-spacing:0.5px;">DEPOSIT</span>`
            : `<span style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4); padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px; letter-spacing:0.5px;">WITHDRAW</span>`;

        const statusBadge = r.status === 'PENDING'
            ? `<span style="background:rgba(234,179,8,0.2); color:#facc15; border:1px solid rgba(234,179,8,0.4); padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px;">PENDING</span>`
            : r.status === 'APPROVED'
                ? `<span style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid rgba(34,197,94,0.4); padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px;">APPROVED</span>`
                : `<span style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4); padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px;">REJECTED</span>`;

        // Lineage / Handling attribution column
        let adminAttributionHtml = '—';
        if (r.status === 'PENDING') {
            const assignedName = r.assignedAdmin ? escapeHtml(r.assignedAdmin.name) : 'Super Admin';
            const assignedUname = (r.assignedAdmin && r.assignedAdmin.username) ? `<br><small style="color:#a78bfa;">@${escapeHtml(r.assignedAdmin.username)}</small>` : '';
            adminAttributionHtml = `
                <div style="line-height:1.3;">
                    <span style="display:inline-block; background:rgba(234,179,8,0.15); color:#facc15; border:1px solid rgba(234,179,8,0.35); padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">
                        ⏳ Assigned: ${assignedName}
                    </span>${assignedUname}
                </div>
            `;
        } else if (r.status === 'APPROVED') {
            const handledBy = escapeHtml(r.processedByName || 'Super Admin');
            const timeInfo = r.actionAt ? `<br><small style="color:#94a3b8; font-size:11px;">${new Date(r.actionAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</small>` : '';
            adminAttributionHtml = `
                <div style="line-height:1.3;">
                    <span style="display:inline-block; background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.35); padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">
                        ✅ By: ${handledBy}
                    </span>${timeInfo}
                </div>
            `;
        } else if (r.status === 'REJECTED') {
            const handledBy = escapeHtml(r.processedByName || 'Super Admin');
            const timeInfo = r.actionAt ? `<br><small style="color:#94a3b8; font-size:11px;">${new Date(r.actionAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</small>` : '';
            adminAttributionHtml = `
                <div style="line-height:1.3;">
                    <span style="display:inline-block; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.35); padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">
                        ❌ By: ${handledBy}
                    </span>${timeInfo}
                </div>
            `;
        }

        let phoneAndProof = escapeHtml(r.phone || '—');
        if (r.bankName) {
            phoneAndProof += `<br><span style="font-size:11px; color:#94a3b8;">🏦 ${escapeHtml(r.bankName)}</span>`;
        }
        if (r.proofUrl) {
            phoneAndProof += `<br><a href="${r.proofUrl}" target="_blank" style="display:inline-block; margin-top:5px; padding:3px 8px; background:rgba(139,92,246,0.25); color:#c4b5fd; border:1px solid rgba(139,92,246,0.5); border-radius:4px; font-size:11px; text-decoration:none; font-weight:600;">🖼 View Proof</a>`;
        }

        const dateStr = r.createdAt
            ? new Date(r.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })
            : '—';

        let actionButtons = `
            <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
        `;

        if (r.status === 'PENDING') {
            actionButtons += `
                <button onclick="handleRequestAction(${r.id}, 'approve', '${r.type}', ${r.amount})" class="action-btn-sm" style="background:#16a34a; color:#fff;" title="Approve">✓</button>
                <button onclick="handleRequestAction(${r.id}, 'reject', '${r.type}', ${r.amount})" class="action-btn-sm" style="background:#dc2626; color:#fff;" title="Reject">✗</button>
            `;
        }

        if (r.status === 'PENDING' || r.status === 'REJECTED') {
            actionButtons += `
                <button onclick="openEditModal(${r.id})" class="action-btn-sm" style="background:#3b82f6; color:#fff;" title="Edit request">✏️ Edit</button>
                <button onclick="deleteSingleRequest(${r.id}, '${r.type}', ${r.amount})" class="action-btn-sm" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);" title="Delete request">🗑</button>
            `;
        } else {
            actionButtons += `
                <span style="color:#64748b; font-size:12px; font-weight:600; padding:2px 4px;">🔒 Settled</span>
            `;
        }

        actionButtons += `
            </div>
        `;

        const isApproved = r.status === 'APPROVED';
        const checkboxHtml = isApproved
            ? `<input type="checkbox" disabled style="opacity:0.25; cursor:not-allowed;" title="Approved requests are settled and locked">`
            : `<input type="checkbox" class="req-check" data-id="${r.id}" ${isChecked ? 'checked' : ''} onchange="toggleSelectRequest(${r.id}, this.checked)">`;

        return `
            <tr>
                <td style="text-align:center;">
                    ${checkboxHtml}
                </td>
                <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(r.id))}</td>
                <td>${userDisplay}</td>
                <td>${typeBadge}</td>
                <td><strong style="font-size:15px; color:#f8fafc;">${(r.amount ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                <td>${phoneAndProof}</td>
                <td>${statusBadge}</td>
                <td>${adminAttributionHtml}</td>
                <td><strong style="color:#94a3b8;">${(r.balance ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                <td style="color:#94a3b8; font-size:12px; white-space:nowrap;">${dateStr}</td>
                <td>${actionButtons}</td>
            </tr>
        `;
    }).join('');
}

function toggleSelectRequest(id, checked) {
    const req = allRequests.find(r => r.id === id);
    if (req && req.status === 'APPROVED') return;

    if (checked) {
        selectedRequestIds.add(id);
    } else {
        selectedRequestIds.delete(id);
    }
    updateBatchToolbar();
}

// ----------------------------------------------------
// 7. Request Action Handlers (Approve / Reject)
// ----------------------------------------------------
async function handleRequestAction(id, action, type, amount) {
    if (isActionRunning) return;

    const actionUpper = action.toUpperCase();
    const typeUpper = type.toUpperCase();
    const ok = confirm(`Are you sure you want to ${actionUpper} this ${typeUpper} request #${id} of ${amount} Birr?`);
    if (!ok) return;

    isActionRunning = true;
    try {
        const res = await authFetch(`/api/request/${id}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            await refreshAllData();
        } else {
            alert('Action failed: ' + (data.msg || data.error || 'Server error'));
        }
    } catch (err) {
        alert('Network error while processing request.');
        console.error('Request action error:', err);
    } finally {
        isActionRunning = false;
    }
}

// ----------------------------------------------------
// 8. Delete Single Request
// ----------------------------------------------------
async function deleteSingleRequest(id, type, amount) {
    if (isActionRunning) return;

    const req = allRequests.find(r => r.id === id);
    if (req && req.status === 'APPROVED') {
        alert('Approved requests are settled and cannot be deleted.');
        return;
    }

    const ok = confirm(`⚠️ Are you sure you want to permanently DELETE ${type.toUpperCase()} request #${id} of ${amount} Birr?`);
    if (!ok) return;

    isActionRunning = true;
    try {
        const res = await authFetch(`/api/request/${id}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (res.ok && data.success) {
            selectedRequestIds.delete(id);
            await refreshAllData();
        } else {
            alert('Delete failed: ' + (data.msg || data.error || 'Server error'));
        }
    } catch (err) {
        alert('Network error deleting request.');
        console.error('Delete error:', err);
    } finally {
        isActionRunning = false;
    }
}

// ----------------------------------------------------
// 9. Batch Actions (Approve, Reject, Delete Selected)
// ----------------------------------------------------
function initBatchActions() {
    const btnApprove = document.getElementById('btn-batch-approve');
    const btnReject = document.getElementById('btn-batch-reject');
    const btnDelete = document.getElementById('btn-batch-delete');

    if (btnApprove) {
        btnApprove.addEventListener('click', async () => {
            const ids = Array.from(selectedRequestIds);
            if (ids.length === 0) return;

            const ok = confirm(`Are you sure you want to APPROVE all ${ids.length} selected pending requests?`);
            if (!ok) return;

            try {
                const res = await authFetch('/api/requests/batch-approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    selectedRequestIds.clear();
                    await refreshAllData();
                } else {
                    alert('Batch approve failed: ' + (data.msg || 'Error'));
                }
            } catch (err) {
                alert('Network error in batch approve.');
            }
        });
    }

    if (btnReject) {
        btnReject.addEventListener('click', async () => {
            const ids = Array.from(selectedRequestIds);
            if (ids.length === 0) return;

            const ok = confirm(`Are you sure you want to REJECT all ${ids.length} selected pending requests?`);
            if (!ok) return;

            try {
                const res = await authFetch('/api/requests/batch-reject', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    selectedRequestIds.clear();
                    await refreshAllData();
                } else {
                    alert('Batch reject failed: ' + (data.msg || 'Error'));
                }
            } catch (err) {
                alert('Network error in batch reject.');
            }
        });
    }

    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
            const ids = Array.from(selectedRequestIds);
            if (ids.length === 0) return;

            const ok = confirm(`⚠️ Are you sure you want to permanently DELETE all ${ids.length} selected requests?`);
            if (!ok) return;

            try {
                const res = await authFetch('/api/requests/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    selectedRequestIds.clear();
                    await refreshAllData();
                } else {
                    alert('Batch delete failed: ' + (data.msg || 'Error'));
                }
            } catch (err) {
                alert('Network error in batch delete.');
            }
        });
    }
}

// ----------------------------------------------------
// 10. Edit Request Modal
// ----------------------------------------------------
function initEditModal() {
    const modal = document.getElementById('edit-modal');
    const form = document.getElementById('edit-request-form');
    const closeBtn = document.getElementById('edit-modal-close');
    const cancelBtn = document.getElementById('edit-modal-cancel');

    if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeEditModal();
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-req-id').value;
            const amount = parseFloat(document.getElementById('edit-req-amount').value);
            const status = document.getElementById('edit-req-status').value;
            const phone = document.getElementById('edit-req-phone').value;
            const bankName = document.getElementById('edit-req-bank').value;

            try {
                const res = await authFetch(`/api/request/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount, status, phone, bankName })
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    closeEditModal();
                    await refreshAllData();
                } else {
                    alert('Update failed: ' + (data.msg || data.error || 'Server error'));
                }
            } catch (err) {
                alert('Network error updating request.');
                console.error('Update error:', err);
            }
        });
    }
}

function openEditModal(id) {
    const req = allRequests.find(r => r.id === id);
    if (!req) return;
    if (req.status === 'APPROVED') {
        alert('Approved requests are settled and cannot be edited.');
        return;
    }

    document.getElementById('edit-req-id').value = req.id;
    document.getElementById('edit-req-id-text').textContent = req.id;
    document.getElementById('edit-req-amount').value = req.amount;
    document.getElementById('edit-req-status').value = req.status;
    document.getElementById('edit-req-phone').value = req.phone || '';
    document.getElementById('edit-req-bank').value = req.bankName || '';

    const proofBox = document.getElementById('edit-req-proof-box');
    const proofLink = document.getElementById('edit-req-proof-link');
    if (req.proofUrl) {
        proofBox.style.display = 'block';
        proofLink.href = req.proofUrl;
    } else {
        proofBox.style.display = 'none';
    }

    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display = 'flex';
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display = 'none';
}

// ----------------------------------------------------
// 11. Force Start Game
// ----------------------------------------------------
function initForceStart() {
    const btn = document.getElementById('btn-start');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const ok = confirm('Are you sure you want to force start the Bingo game now?');
        if (!ok) return;

        btn.disabled = true;
        btn.textContent = 'Starting...';

        try {
            const res = await authFetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bet: 10, room: 1 })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                alert('✅ Game force-started successfully!');
                await refreshAllData();
            } else {
                alert('⚠️ Could not start game: ' + (data.error || data.msg || 'Unknown error'));
            }
        } catch (err) {
            alert('❌ Network error starting game.');
            console.error('Force start game error:', err);
        } finally {
            fetchStats();
        }
    });
}

// ----------------------------------------------------
// 12. User Management Modals & Handlers
// ----------------------------------------------------
function initUserModals() {
    const editModal = document.getElementById('edit-user-modal');
    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) closeEditUserModal();
        });
    }

    const deleteModal = document.getElementById('delete-user-modal');
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteUserModal();
        });
    }

    const confirmDeleteBtn = document.getElementById('btn-confirm-delete-user');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', confirmDeleteUser);
    }

    const searchBtn = document.getElementById('btn-user-search');
    const searchInput = document.getElementById('user-search-input');
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            fetchUsers(searchInput.value.trim());
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                fetchUsers(searchInput.value.trim());
            }
        });
    }
}

function openEditUserModal(userId) {
    const user = allUsers.find(u => String(u.id) === String(userId));
    if (!user) return;

    document.getElementById('edit-user-id').value = user.id;
    const idEl = document.getElementById('edit-user-id-display');
    if (idEl) idEl.textContent = `#${user.id}`;
    
    const fnEl = document.getElementById('edit-user-firstname');
    if (fnEl) fnEl.value = user.firstName || '';

    const unEl = document.getElementById('edit-user-username');
    if (unEl) unEl.value = user.username || '';

    document.getElementById('edit-user-balance').value = user.balance ?? 0;
    const withEl = document.getElementById('edit-user-withdrawable');
    if (withEl) withEl.value = user.withdrawableBalance ?? 0;
    document.getElementById('edit-user-bonus').value = user.bonus ?? 0;
    document.getElementById('edit-user-phone').value = user.phone || '';
    document.getElementById('edit-user-banned').value = user.banned ? 'true' : 'false';

    const modal = document.getElementById('edit-user-modal');
    if (modal) modal.style.display = 'flex';
}

function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    if (modal) modal.style.display = 'none';
}

async function saveUserEdit(e) {
    if (e) e.preventDefault();
    const userId = document.getElementById('edit-user-id').value;
    if (!userId) return;

    const firstNameInput = document.getElementById('edit-user-firstname');
    const usernameInput = document.getElementById('edit-user-username');
    const firstName = firstNameInput ? firstNameInput.value.trim() : null;
    const rawUsername = usernameInput ? usernameInput.value.trim().replace(/^@+/, '') : null;
    const username = rawUsername || null;

    const balance = parseFloat(document.getElementById('edit-user-balance').value);
    const withEl = document.getElementById('edit-user-withdrawable');
    const withdrawableBalance = withEl ? parseFloat(withEl.value) : 0;
    const bonus = parseFloat(document.getElementById('edit-user-bonus').value);
    const phone = document.getElementById('edit-user-phone').value.trim();
    const banned = document.getElementById('edit-user-banned').value === 'true';

    try {
        const res = await authFetch(`/api/admin/user/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ balance, bonus, withdrawableBalance, phone, username, firstName, banned })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            closeEditUserModal();
            await refreshAllData();
        } else {
            alert('Failed to update user: ' + (data.msg || data.error || 'Server error'));
        }
    } catch (err) {
        alert('Network error updating user.');
        console.error('Update user error:', err);
    }
}

function openDeleteUserModal(userId) {
    const user = allUsers.find(u => String(u.id) === String(userId));
    pendingDeleteUserId = userId;
    const fullName = user ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : 'Player')) : 'Player';
    const nameEl = document.getElementById('delete-user-name');
    const idEl = document.getElementById('delete-user-id-text');
    if (nameEl) nameEl.textContent = fullName;
    if (idEl) idEl.textContent = `#${userId}`;

    const modal = document.getElementById('delete-user-modal');
    if (modal) modal.style.display = 'flex';
}

function closeDeleteUserModal() {
    pendingDeleteUserId = null;
    const modal = document.getElementById('delete-user-modal');
    if (modal) modal.style.display = 'none';
}

async function confirmDeleteUser() {
    if (!pendingDeleteUserId) return;
    const userId = pendingDeleteUserId;

    try {
        const res = await authFetch(`/api/admin/user/${userId}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (res.ok && data.success) {
            closeDeleteUserModal();
            await refreshAllData();
        } else {
            alert('Delete failed: ' + (data.msg || data.error || 'Server error'));
        }
    } catch (err) {
        alert('Network error deleting user.');
        console.error('Delete user error:', err);
    }
}

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ----------------------------------------------------
// Promotional Bonus Settings Controller
// ----------------------------------------------------
let bonusInputsDirty = false;

async function fetchBonusSettings() {
    try {
        const res = await authFetch('/api/admin/bonus');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.success) {
            const inputNewUser = document.getElementById('input-new-user-bonus');
            const inputReferral = document.getElementById('input-referral-bonus');
            if (inputNewUser && !inputNewUser.dataset.listenerAttached) {
                inputNewUser.dataset.listenerAttached = '1';
                inputNewUser.addEventListener('input', () => { bonusInputsDirty = true; });
            }
            if (inputReferral && !inputReferral.dataset.listenerAttached) {
                inputReferral.dataset.listenerAttached = '1';
                inputReferral.addEventListener('input', () => { bonusInputsDirty = true; });
            }
            if (!bonusInputsDirty) {
                if (inputNewUser && data.newUserBonus !== undefined) {
                    inputNewUser.value = data.newUserBonus;
                }
                if (inputReferral && data.referralBonus !== undefined) {
                    inputReferral.value = data.referralBonus;
                }
            }
        }
    } catch (err) {
        console.error('Error fetching bonus settings:', err);
    }
}

async function saveBonusSettings() {
    const inputNewUser = document.getElementById('input-new-user-bonus');
    const inputReferral = document.getElementById('input-referral-bonus');
    const statusEl = document.getElementById('bonus-save-status');

    if (!inputNewUser || !inputReferral) return;

    const newUserBonus = parseInt(inputNewUser.value, 10);
    const referralBonus = parseInt(inputReferral.value, 10);

    if (isNaN(newUserBonus) || newUserBonus < 0 || isNaN(referralBonus) || referralBonus < 0) {
        if (statusEl) {
            statusEl.textContent = '❌ Enter valid non-negative numbers';
            statusEl.style.color = '#ef4444';
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = '⏳ Saving...';
        statusEl.style.color = '#38bdf8';
    }

    try {
        const res = await authFetch('/api/admin/bonus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newUserBonus, referralBonus })
        });
        const data = await res.json();
        if (data.success) {
            bonusInputsDirty = false;
            if (statusEl) {
                statusEl.textContent = `✅ Saved! Welcome: ${data.newUserBonus} Birr | Referral: ${data.referralBonus} Birr`;
                statusEl.style.color = '#10b981';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
            }
        } else {
            if (statusEl) {
                statusEl.textContent = `❌ ${data.msg || 'Save failed'}`;
                statusEl.style.color = '#ef4444';
            }
        }
    } catch (err) {
        console.error('Error saving bonus settings:', err);
        if (statusEl) {
            statusEl.textContent = '❌ Failed to save bonus settings.';
            statusEl.style.color = '#ef4444';
        }
    }
}

// ----------------------------------------------------
// Caller Voice Controller
// ----------------------------------------------------
function updateVoiceUI(voice) {
    const el = document.getElementById('stat-voice');
    if (el) {
        el.textContent = voice === 'female' ? '👩 Female (ሴት)' : '👨 Male (ወንድ)';
        el.style.color = voice === 'female' ? '#ff80ab' : '#90caf9';
    }
    const btnMale = document.getElementById('btn-voice-male');
    const btnFemale = document.getElementById('btn-voice-female');
    if (btnMale) {
        btnMale.style.opacity = voice === 'male' ? '1' : '0.6';
        btnMale.style.boxShadow = voice === 'male' ? '0 0 10px rgba(25,118,210,0.8)' : 'none';
        btnMale.style.outline = voice === 'male' ? '2px solid #60a5fa' : 'none';
    }
    if (btnFemale) {
        btnFemale.style.opacity = voice === 'female' ? '1' : '0.6';
        btnFemale.style.boxShadow = voice === 'female' ? '0 0 10px rgba(233,30,99,0.8)' : 'none';
        btnFemale.style.outline = voice === 'female' ? '2px solid #f472b6' : 'none';
    }
}

async function fetchCallerVoice() {
    try {
        const res = await authFetch('/api/admin/voice');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.success && data.voice) {
            updateVoiceUI(data.voice);
        }
    } catch (err) {
        console.error('Error fetching caller voice:', err);
    }
}

async function setAdminVoice(voice) {
    if (voice !== 'male' && voice !== 'female') return;
    const el = document.getElementById('stat-voice');
    const oldText = el ? el.textContent : '';
    if (el) el.textContent = '⏳ Updating...';

    try {
        const res = await authFetch('/api/admin/voice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice })
        });
        const data = await res.json();
        if (data && data.success && data.voice) {
            updateVoiceUI(data.voice);
        } else {
            if (el) el.textContent = oldText;
            alert(data?.msg || 'Failed to update caller voice.');
        }
    } catch (err) {
        console.error('Error setting caller voice:', err);
        if (el) el.textContent = oldText;
        alert('Network error while updating caller voice.');
    }
}

// ----------------------------------------------------
// Minimum Calls to Win Controller
// ----------------------------------------------------
function updateWinCallPreview() {
    const input = document.getElementById('input-win-call-threshold');
    const preview = document.getElementById('win-call-preview-text');
    if (!input || !preview) return;
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val >= 4) {
        const seconds = val * 4;
        preview.textContent = `≈ ${seconds}s game`;
    } else {
        preview.textContent = 'Min: 4 calls';
    }
}

function applyWinCallPreset(preset) {
    const input = document.getElementById('input-win-call-threshold');
    if (input) {
        input.value = preset;
        updateWinCallPreview();
    }
}

async function fetchWinCallThreshold() {
    try {
        const res = await authFetch('/api/admin/win-call-threshold');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.success) {
            const input = document.getElementById('input-win-call-threshold');
            const badge = document.getElementById('win-call-badge');
            const threshold = data.minCallToWin || 15;
            if (input && document.activeElement !== input) {
                input.value = threshold;
                updateWinCallPreview();
            }
            if (badge) {
                badge.textContent = `${threshold} Calls (~${threshold * 4}s)`;
            }
        }
    } catch (err) {
        console.error('Error fetching win call threshold:', err);
    }
}

async function saveWinCallThreshold() {
    const input = document.getElementById('input-win-call-threshold');
    const statusEl = document.getElementById('win-call-save-status');
    const badge = document.getElementById('win-call-badge');
    if (!input) return;

    const minCallToWin = parseInt(input.value, 10);
    if (isNaN(minCallToWin) || minCallToWin < 4 || minCallToWin > 50) {
        if (statusEl) {
            statusEl.textContent = '❌ Must be between 4 and 50 calls';
            statusEl.style.color = '#ef4444';
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = '⏳ Saving...';
        statusEl.style.color = '#38bdf8';
    }

    try {
        const res = await authFetch('/api/admin/win-call-threshold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minCallToWin })
        });
        const data = await res.json();
        if (data.success) {
            botInputsDirty = false;
            if (statusEl) {
                statusEl.textContent = `✅ Saved! Minimum ${data.minCallToWin} calls (~${data.minCallToWin * 4}s)`;
                statusEl.style.color = '#10b981';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
            }
            if (badge) {
                badge.textContent = `${data.minCallToWin} Calls (~${data.minCallToWin * 4}s)`;
            }
        } else {
            if (statusEl) {
                statusEl.textContent = `❌ ${data.msg || 'Save failed'}`;
                statusEl.style.color = '#ef4444';
            }
        }
    } catch (err) {
        console.error('Error saving win call threshold:', err);
        if (statusEl) {
            statusEl.textContent = '❌ Failed to save threshold.';
            statusEl.style.color = '#ef4444';
        }
    }
}

// ----------------------------------------------------
// 8.1 Virtual Players (Bot Control) Handlers
// ----------------------------------------------------
function updateStakeBadges() {
    const s10EnabledSelect = document.getElementById('bot-stake10-enabled');
    const s10Badge = document.getElementById('bot-stake10-badge');
    if (s10EnabledSelect && s10Badge) {
        const on = s10EnabledSelect.value === 'true';
        s10Badge.textContent = on ? '🟢 ON' : '🔴 OFF';
        s10Badge.style.background = on ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
        s10Badge.style.color = on ? '#4ade80' : '#f87171';
    }

    const s20EnabledSelect = document.getElementById('bot-stake20-enabled');
    const s20Badge = document.getElementById('bot-stake20-badge');
    if (s20EnabledSelect && s20Badge) {
        const on = s20EnabledSelect.value === 'true';
        s20Badge.textContent = on ? '🟢 ON' : '🔴 OFF';
        s20Badge.style.background = on ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
        s20Badge.style.color = on ? '#4ade80' : '#f87171';
    }
}

let botInputsDirty = false;

function attachBotInputListeners() {
    const ids = ['bot-input-enabled', 'bot-stake10-enabled', 'bot-stake10-target', 'bot-stake20-enabled', 'bot-stake20-target', 'bot-input-join-pacing', 'bot-input-speed'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.dirtyAttached) {
            el.dataset.dirtyAttached = '1';
            el.addEventListener('input', () => { botInputsDirty = true; });
            el.addEventListener('change', () => { botInputsDirty = true; });
        }
    });
}

async function fetchBotSettings() {
    try {
        attachBotInputListeners();
        const res = await authFetch('/api/admin/bots');
        if (!res.ok) return;
        const data = await res.json();
        const s = data.settings || {};

        const enabledSelect = document.getElementById('bot-input-enabled');
        const speedSelect = document.getElementById('bot-input-speed');
        const statusBadge = document.getElementById('bot-status-badge');

        const s10EnabledSelect = document.getElementById('bot-stake10-enabled');
        const s10TargetInput = document.getElementById('bot-stake10-target');
        const s20EnabledSelect = document.getElementById('bot-stake20-enabled');
        const s20TargetInput = document.getElementById('bot-stake20-target');

        if (!botInputsDirty) {
            if (enabledSelect) enabledSelect.value = s.enabled ? 'true' : 'false';
            if (s10EnabledSelect) s10EnabledSelect.value = s.stake10Enabled !== false ? 'true' : 'false';
            if (s10TargetInput) s10TargetInput.value = s.stake10Target !== undefined ? s.stake10Target : (s.targetPlayers || 20);
            if (s20EnabledSelect) s20EnabledSelect.value = s.stake20Enabled ? 'true' : 'false';
            if (s20TargetInput) s20TargetInput.value = s.stake20Target !== undefined ? s.stake20Target : 0;

            const joinPacingSelect = document.getElementById('bot-input-join-pacing');
            if (joinPacingSelect) {
                joinPacingSelect.value = s.joinPacing || 'dynamic';
            }

            if (speedSelect) {
                if (s.botReactionMinMs <= 1600) speedSelect.value = 'fast';
                else if (s.botReactionMinMs >= 2500) speedSelect.value = 'relaxed';
                else speedSelect.value = 'normal';
            }
        }

        if (statusBadge) {
            if (s.enabled) {
                statusBadge.textContent = '🟢 ACTIVE';
                statusBadge.style.background = 'rgba(34,197,94,0.2)';
                statusBadge.style.color = '#4ade80';
            } else {
                statusBadge.textContent = '🔴 OFF';
                statusBadge.style.background = 'rgba(239,68,68,0.2)';
                statusBadge.style.color = '#f87171';
            }
        }

        updateStakeBadges();

        const byFee = data.byFee || {};
        setText('bot-count-10', (byFee['10'] || 0).toLocaleString());
        setText('bot-count-20', (byFee['20'] || 0).toLocaleString());
    } catch (e) {
        console.error('Failed to load bot settings:', e);
    }
}

async function saveBotSettings() {
    const enabled = document.getElementById('bot-input-enabled').value === 'true';
    const s10El = document.getElementById('bot-stake10-enabled');
    const s10TgtEl = document.getElementById('bot-stake10-target');
    const s20El = document.getElementById('bot-stake20-enabled');
    const s20TgtEl = document.getElementById('bot-stake20-target');

    const stake10Enabled = s10El ? s10El.value === 'true' : true;
    const stake10Target = s10TgtEl ? Math.max(0, parseInt(s10TgtEl.value, 10) || 0) : 20;
    const stake20Enabled = s20El ? s20El.value === 'true' : false;
    const stake20Target = s20TgtEl ? Math.max(0, parseInt(s20TgtEl.value, 10) || 0) : 0;

    const joinPacing = document.getElementById('bot-input-join-pacing') ? document.getElementById('bot-input-join-pacing').value : 'dynamic';
    const speed = document.getElementById('bot-input-speed').value;

    let botReactionMinMs = 1800;
    let botReactionMaxMs = 3200;
    if (speed === 'fast') {
        botReactionMinMs = 1500;
        botReactionMaxMs = 2500;
    } else if (speed === 'relaxed') {
        botReactionMinMs = 2800;
        botReactionMaxMs = 4500;
    }

    const statusEl = document.getElementById('bot-save-status');
    if (statusEl) {
        statusEl.textContent = 'Saving...';
        statusEl.style.color = '#38bdf8';
    }

    try {
        const res = await authFetch('/api/admin/bots/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled,
                stake10Enabled,
                stake10Target,
                stake20Enabled,
                stake20Target,
                targetPlayers: stake10Target,
                botReactionMinMs,
                botReactionMaxMs,
                joinPacing
            })
        });
        const data = await res.json();
        if (data.success) {
            botInputsDirty = false;
            if (statusEl) {
                statusEl.textContent = '✅ Saved successfully!';
                statusEl.style.color = '#4ade80';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
            }
            fetchBotSettings();
        } else {
            alert(data.msg || 'Failed to save bot settings.');
        }
    } catch (err) {
        alert('Network error saving bot settings.');
    }
}

async function injectBots(count = 5, fee = 10) {
    try {
        const res = await authFetch('/api/admin/bots/inject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fee, room: 1, count })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.msg);
            fetchStats();
            fetchBotSettings();
        } else {
            alert(data.msg || 'Could not add bots.');
        }
    } catch (err) {
        alert('Network error adding bots.');
    }
}

async function clearBots(fee = 10) {
    if (!confirm(`Are you sure you want to remove all fake players from the ${fee} Birr lobby?`)) return;
    try {
        const res = await authFetch('/api/admin/bots/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fee, room: 1 })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.msg);
            fetchStats();
            fetchBotSettings();
        } else {
            alert(data.msg || 'Could not clear bots.');
        }
    } catch (err) {
        alert('Network error clearing bots.');
    }
}

// ----------------------------------------------------
// 9. Active Players Inspector Modal & Room Separation
// ----------------------------------------------------
let activePlayersPollInterval = null;
let currentActivePlayersFilter = 'ALL';
let cachedActivePlayers = [];

async function openActivePlayersModal(initialFilter = 'ALL') {
    currentActivePlayersFilter = initialFilter || 'ALL';
    const modal = document.getElementById('active-players-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    await fetchActivePlayers();
    if (activePlayersPollInterval) clearInterval(activePlayersPollInterval);
    activePlayersPollInterval = setInterval(fetchActivePlayers, 3000);
}

function closeActivePlayersModal() {
    const modal = document.getElementById('active-players-modal');
    if (modal) modal.style.display = 'none';
    if (activePlayersPollInterval) {
        clearInterval(activePlayersPollInterval);
        activePlayersPollInterval = null;
    }
}

function setActivePlayersFilter(filterKey) {
    currentActivePlayersFilter = filterKey;
    renderActivePlayersContent(cachedActivePlayers);
}

async function forceStartRoom(fee, room = 1) {
    const roomLabel = `${fee} Birr Room #${room}`;
    if (!confirm(`Are you sure you want to force start the ${roomLabel} game now?`)) return;

    try {
        const res = await authFetch('/api/start-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bet: fee, room: room })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            alert(`✅ ${roomLabel} force-started successfully!`);
            await fetchStats();
            if (document.getElementById('active-players-modal')?.style.display === 'flex') {
                await fetchActivePlayers();
            }
        } else {
            alert(`❌ ${data.error || data.msg || 'Failed to start game'}`);
        }
    } catch (err) {
        console.error('Error starting game room:', err);
        alert('Network error while starting game room.');
    }
}

function renderPlayerRow(item) {
    const p = item.player;
    const boardsHtml = (p.boards && p.boards.length > 0)
        ? p.boards.map(b => `<span style="background:rgba(56,189,248,0.2); color:#38bdf8; padding:2px 8px; border-radius:6px; font-weight:700; margin-right:4px;">#${b}</span>`).join('')
        : '<span style="color:#64748b;">None</span>';

    const isPlaying = item.gameState === 'PLAYING';
    const stateBadge = isPlaying
        ? `<span style="background:rgba(74,222,128,0.15); color:#4ade80; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px;">🟢 PLAYING (Called: ${item.drawnCount})</span>`
        : `<span style="background:rgba(250,204,21,0.15); color:#facc15; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11px;">🟡 LOBBY (${item.lobbyCountdown}s)</span>`;

    const isIdle = p.idleSeconds > 10;
    const lastSeenHtml = isIdle
        ? `<span style="color:#f87171; font-size:12px;">🔴 Inactive ${p.idleSeconds}s ago</span>`
        : `<span style="color:#4ade80; font-size:12px;">🟢 Active ${p.idleSeconds}s ago</span>`;

    const kickBtn = (!isPlaying)
        ? `<button onclick="kickActivePlayer('${p.userId}', ${item.fee}, ${item.room})" style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); color:#f87171; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Kick player and release board">👢 Kick & Free</button>`
        : `<span style="color:#64748b; font-size:11px;">In Game</span>`;

    const botBadge = p.isBot
        ? `<span style="display:inline-block; margin-left:6px; background:rgba(192,132,252,0.22); color:#c084fc; border:1px solid rgba(192,132,252,0.45); border-radius:10px; font-size:10px; padding:1px 6px; font-weight:700;">🤖 BOT</span>`
        : (p.autoPlay ? `<span style="display:inline-block; margin-left:6px; background:rgba(34,197,94,0.22); color:#4ade80; border:1px solid rgba(34,197,94,0.45); border-radius:10px; font-size:10px; padding:1px 6px; font-weight:700;">⚡ AUTO</span>` : '');

    return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
            <td style="padding:10px 8px;">
                <div style="font-weight:700; color:#f8fafc; display:flex; align-items:center;">${escapeHtml(p.firstName || 'Player')}${botBadge}</div>
                <div style="font-size:11px; color:#94a3b8;">${p.username ? '@' + escapeHtml(p.username) + ' • ' : ''}ID: <code>${p.userId}</code></div>
                ${p.phone ? `<div style="font-size:11px; color:#38bdf8;">📱 ${escapeHtml(p.phone)}</div>` : ''}
            </td>
            <td style="padding:10px 8px;">${boardsHtml}</td>
            <td style="padding:10px 8px;">${stateBadge}</td>
            <td style="padding:10px 8px;">${lastSeenHtml}</td>
            <td style="padding:10px 8px; text-align:right;">${kickBtn}</td>
        </tr>
    `;
}

function renderActivePlayersContent(players) {
    const filtersEl = document.getElementById('active-players-room-filters');
    const contentEl = document.getElementById('active-players-content');
    const emptyEl = document.getElementById('active-players-empty');
    const countBadge = document.getElementById('active-players-count-badge');

    if (countBadge) countBadge.textContent = players.length;

    // Calculate room counts
    const count10 = players.filter(p => p.fee === 10 && p.room === 1).length;
    const count20 = players.filter(p => p.fee === 20 && p.room === 1).length;

    // Find any other rooms with active players
    const extraRoomKeys = new Set();
    players.forEach(p => {
        const k = `${p.fee}-${p.room}`;
        if (k !== '10-1' && k !== '20-1') extraRoomKeys.add(k);
    });

    const pills = [
        { id: 'ALL', label: `🌐 All Rooms (${players.length})` },
        { id: '10-1', label: `🟡 10 Birr Room #1 (${count10})` },
        { id: '20-1', label: `🟣 20 Birr Room #1 (${count20})` }
    ];

    extraRoomKeys.forEach(k => {
        const [fee, room] = k.split('-');
        const c = players.filter(p => `${p.fee}-${p.room}` === k).length;
        pills.push({ id: k, label: `🎲 ${fee} Birr Room #${room} (${c})` });
    });

    // Render filter buttons
    if (filtersEl) {
        filtersEl.innerHTML = pills.map(p => {
            const isActive = currentActivePlayersFilter === p.id;
            const btnStyle = isActive
                ? 'background:#0284c7; color:#fff; font-weight:700; border:1px solid #38bdf8; box-shadow:0 0 10px rgba(56,189,248,0.4);'
                : 'background:rgba(255,255,255,0.08); color:#cbd5e1; border:1px solid rgba(255,255,255,0.15);';
            return `<button type="button" onclick="setActivePlayersFilter('${p.id}')" class="btn-primary" style="margin:0; padding:6px 12px; font-size:12px; border-radius:8px; cursor:pointer; ${btnStyle}">${p.label}</button>`;
        }).join('');
    }

    if (players.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (contentEl) contentEl.innerHTML = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // Grouping helper
    const renderRoomSection = (fee, room, roomPlayers, roomLabel, colorHex) => {
        const isPlaying = roomPlayers.length > 0 && roomPlayers[0].gameState === 'PLAYING';
        const countdown = roomPlayers.length > 0 ? roomPlayers[0].lobbyCountdown : 0;
        const drawnCount = roomPlayers.length > 0 ? roomPlayers[0].drawnCount : 0;

        const stateBadge = isPlaying
            ? `<span style="background:rgba(74,222,128,0.2); color:#4ade80; padding:3px 10px; border-radius:8px; font-weight:700; font-size:11px;">🟢 PLAYING (Called: ${drawnCount})</span>`
            : `<span style="background:rgba(250,204,21,0.2); color:#facc15; padding:3px 10px; border-radius:8px; font-weight:700; font-size:11px;">🟡 LOBBY (${countdown}s)</span>`;

        if (roomPlayers.length === 0) {
            return `
                <div style="margin-bottom:18px; background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:18px; text-align:center; color:#94a3b8;">
                    <div style="font-weight:700; color:${colorHex}; font-size:14px; margin-bottom:4px;">${roomLabel}</div>
                    <div style="font-size:12px;">No players currently seated in this room lobby.</div>
                </div>
            `;
        }

        const rowsHtml = roomPlayers.map(renderPlayerRow).join('');

        return `
            <div style="margin-bottom:20px; background:rgba(30,41,59,0.6); border:1px solid rgba(255,255,255,0.12); border-radius:12px; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.3);">
                <!-- Room Header -->
                <div style="background:rgba(255,255,255,0.04); border-bottom:1px solid rgba(255,255,255,0.08); padding:10px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:15px; font-weight:700; color:${colorHex};">${roomLabel}</span>
                        <span style="background:rgba(56,189,248,0.2); color:#38bdf8; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px;">${roomPlayers.length} Active Players</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${stateBadge}
                        ${!isPlaying ? `<button type="button" onclick="forceStartRoom(${fee}, ${room})" class="btn-primary" style="margin:0; padding:4px 10px; font-size:11px; background:rgba(34,197,94,0.2); border:1px solid rgba(34,197,94,0.4); color:#4ade80; border-radius:6px; cursor:pointer;">▶ Start Room</button>` : ''}
                    </div>
                </div>
                <!-- Room Players Table -->
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
                        <thead>
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.08); color:#94a3b8; font-size:11px; text-transform:uppercase;">
                                <th style="padding:10px 8px;">Player</th>
                                <th style="padding:10px 8px;">Board(s)</th>
                                <th style="padding:10px 8px;">Game State</th>
                                <th style="padding:10px 8px;">Last Seen</th>
                                <th style="padding:10px 8px; text-align:right;">Action</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    };

    if (!contentEl) return;

    if (currentActivePlayersFilter === 'ALL') {
        const p10 = players.filter(p => p.fee === 10 && p.room === 1);
        const p20 = players.filter(p => p.fee === 20 && p.room === 1);

        let html = '';
        html += renderRoomSection(10, 1, p10, '🟡 10 Birr Room (№1)', '#facc15');
        html += renderRoomSection(20, 1, p20, '🟣 20 Birr Room (№1)', '#c084fc');

        extraRoomKeys.forEach(k => {
            const [fStr, rStr] = k.split('-');
            const f = parseInt(fStr, 10);
            const r = parseInt(rStr, 10);
            const extraPlayers = players.filter(p => p.fee === f && p.room === r);
            html += renderRoomSection(f, r, extraPlayers, `🎲 ${f} Birr Room #${r}`, '#38bdf8');
        });

        contentEl.innerHTML = html;
    } else {
        const [fStr, rStr] = currentActivePlayersFilter.split('-');
        const fee = parseInt(fStr, 10);
        const room = parseInt(rStr, 10);
        const filtered = players.filter(p => p.fee === fee && p.room === room);
        const label = fee === 10 ? '🟡 10 Birr Room (№1)' : (fee === 20 ? '🟣 20 Birr Room (№1)' : `🎲 ${fee} Birr Room #${room}`);
        const color = fee === 10 ? '#facc15' : (fee === 20 ? '#c084fc' : '#38bdf8');
        contentEl.innerHTML = renderRoomSection(fee, room, filtered, label, color);
    }
}

async function fetchActivePlayers() {
    const loadingEl = document.getElementById('active-players-loading');

    try {
        const res = await authFetch('/api/admin/active-players');
        if (!res.ok) throw new Error('Failed to load active players');
        const data = await res.json();
        cachedActivePlayers = data.players || [];

        if (loadingEl) loadingEl.style.display = 'none';
        renderActivePlayersContent(cachedActivePlayers);
    } catch (err) {
        console.error('Error fetching active players:', err);
        if (loadingEl) {
            loadingEl.style.display = 'block';
            loadingEl.innerHTML = `<span style="color:#f87171;">Failed to load active players.</span>`;
        }
    }
}

async function kickActivePlayer(userId, fee, room) {
    if (!confirm(`Are you sure you want to kick player #${userId} from this room? Their entry fee will be refunded and their board released.`)) return;

    try {
        const res = await authFetch('/api/admin/kick-player', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, fee, room })
        });
        const data = await res.json();
        if (data.success) {
            await fetchActivePlayers();
            fetchStats();
        } else {
            alert(data.msg || 'Failed to kick player.');
        }
    } catch (err) {
        alert('Network error while kicking player.');
    }
}

// ----------------------------------------------------
// 12. Administrator Affiliates & Bank Accounts Controller
// ----------------------------------------------------
let allAdmins = [];
let allBanks = [];

async function fetchAdmins() {
    try {
        const res = await authFetch('/api/admin/admins');
        if (!res.ok) throw new Error('Admins fetch failed');
        const data = await res.json();
        allAdmins = Array.isArray(data.admins) ? data.admins : [];

        setText('tab-badge-admins', String(allAdmins.length));

        const tbody = document.querySelector('#admins-table tbody');
        if (!tbody) return;

        if (allAdmins.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#94a3b8; padding:24px;">No administrator affiliates created yet. Click <strong>➕ Add Administrator</strong> above to promote a user!</td></tr>`;
            return;
        }

        tbody.innerHTML = allAdmins.map(a => {
            const displayName = a.customName 
                ? `<strong>${escapeHtml(a.customName)}</strong><br><small style="color:#94a3b8;">${escapeHtml(a.user?.firstName || 'User')}</small>`
                : `<strong>${escapeHtml(a.user?.firstName || 'Admin')}</strong>`;

            const usernameHtml = a.user?.username
                ? `<a href="https://t.me/${a.user.username}" target="_blank" style="color:#38bdf8; text-decoration:none; font-size:12px; font-weight:600;">@${escapeHtml(a.user.username)}</a>`
                : `<span style="color:#94a3b8; font-size:12px;">No username</span>`;

            const linkHtml = `
                <div style="display:flex; align-items:center; gap:6px;">
                    <code style="color:#a78bfa; font-weight:700; font-size:12px; background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px;">start=${escapeHtml(a.code)}</code>
                    <button onclick="copyBotLink('${a.code}')" class="action-btn-sm" style="background:#6366f1; color:#fff; padding:3px 8px; font-size:11px;" title="Copy Telegram Bot Link">📋 Link</button>
                </div>
            `;

            const banksHtml = (Array.isArray(a.paymentAccounts) && a.paymentAccounts.length > 0)
                ? a.paymentAccounts.map(b => `<span style="display:inline-block; margin:2px; padding:2px 8px; border-radius:10px; background:rgba(14,165,233,0.18); border:1px solid rgba(14,165,233,0.3); color:#38bdf8; font-size:11px; font-weight:600;">🏦 ${escapeHtml(b.bankName)}: ${escapeHtml(b.accountNumber)}</span>`).join('')
                : `<span style="color:#94a3b8; font-size:12px;">⚠️ No banks linked</span>`;

            const collected = a.collectedDeposits !== undefined ? Number(a.collectedDeposits) : 0;
            const limit = a.depositLimit !== undefined ? Number(a.depositLimit) : 3000;
            const percent = limit > 0 ? Math.min(100, Math.round((collected / limit) * 100)) : 0;
            const isLimitReached = limit > 0 && collected >= limit;

            const limitBarColor = isLimitReached ? '#ef4444' : (percent > 75 ? '#eab308' : '#22c55e');
            const limitBadge = isLimitReached 
                ? `<span class="badge" style="background:rgba(239,68,68,0.25); color:#f87171; border:1px solid rgba(239,68,68,0.5); font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px;">🔴 Limit Reached</span>`
                : `<span style="font-size:11px; color:#94a3b8;">${(limit - collected).toLocaleString()} Birr left</span>`;

            const safeAdminLabel = (a.customName || a.user?.firstName || a.code).replace(/'/g, "\\'");
            const limitHtml = `
                <div style="min-width:140px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:3px;">
                        <span style="font-weight:700; color:#fff;">${collected.toLocaleString()} / ${limit.toLocaleString()} Birr</span>
                        <span style="font-size:10px; color:${limitBarColor}; font-weight:700;">${percent}%</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.1); border-radius:4px; height:5px; width:100%; overflow:hidden; margin-bottom:5px;">
                        <div style="background:${limitBarColor}; height:100%; width:${percent}%;"></div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
                        ${limitBadge}
                        <button onclick="refreshAdminDepositLimit(${a.id}, '${safeAdminLabel}', ${collected})" class="action-btn-sm" style="background:rgba(139,92,246,0.25); color:#c4b5fd; border:1px solid rgba(139,92,246,0.5); font-size:10px; padding:2px 6px; font-weight:700;" title="Reset collected count to 0 after receiving physical cash">🔄 Refresh</button>
                    </div>
                </div>
            `;

            const dutyBadge = a.isWithdrawalAdmin
                ? `<div style="margin-top:4px;"><span class="badge" style="background:rgba(245,158,11,0.25); color:#fbbf24; border:1px solid rgba(245,158,11,0.5); font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; box-shadow:0 0 8px rgba(245,158,11,0.4);">💸 Withdrawal Duty</span></div>`
                : '';

            const statusHtml = (a.isActive
                ? `<span class="badge-active">Active</span>`
                : `<span class="badge-banned">Inactive</span>`) + dutyBadge;

            const dutyBtn = (!a.isWithdrawalAdmin && a.isActive)
                ? `<button onclick="setDutyWithdrawalAdmin(${a.id})" class="action-btn-sm" style="background:rgba(14,165,233,0.18); color:#38bdf8; border:1px solid rgba(14,165,233,0.4);" title="Assign as Duty Withdrawal Admin">💸 Payouts</button>`
                : '';

            return `
                <tr>
                    <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${a.id}</td>
                    <td>${displayName}</td>
                    <td><code style="color:#38bdf8; font-size:12px;">#${escapeHtml(a.userId)}</code><br>${usernameHtml}</td>
                    <td>${linkHtml}</td>
                    <td>${banksHtml}</td>
                    <td><strong style="color:#4ade80;">${a.assignedUsersCount ?? 0}</strong> <span style="font-size:11px; color:#94a3b8;">players</span></td>
                    <td>${limitHtml}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${dutyBtn}
                            <button onclick="openAdminHandoverModal(${a.id})" class="action-btn-sm" style="background:#8b5cf6; color:#fff;" title="Handover / Replace Admin">🔄 Handover</button>
                            <button onclick="openEditAdminProfileModal(${a.id})" class="action-btn-sm" style="background:#3b82f6; color:#fff;" title="Edit Administrator">✏️ Edit</button>
                            <button onclick="deleteAdminProfile(${a.id})" class="action-btn-sm" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);" title="Remove Administrator">🗑</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        fetchDutyWithdrawalAdmin();
    } catch (err) {
        console.error('Error fetching admins:', err);
    }
}

async function fetchAdminBanks() {
    try {
        const res = await authFetch('/api/admin/banks');
        if (!res.ok) throw new Error('Banks fetch failed');
        allBanks = await res.json();
        if (!Array.isArray(allBanks)) allBanks = [];

        const tbody = document.querySelector('#banks-table tbody');
        if (!tbody) return;

        if (allBanks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:20px;">No bank accounts configured. Click <strong>🏦 + Add Bank Account</strong> to add Telebirr, CBE, etc.</td></tr>`;
            return;
        }

        tbody.innerHTML = allBanks.map(b => {
            const adminHtml = b.admin
                ? `<span style="color:#c084fc; font-weight:600;">👑 ${escapeHtml(b.admin.name)}</span> ${b.admin.username ? `<small style="color:#94a3b8;">(@${escapeHtml(b.admin.username)})</small>` : ''}`
                : `<span style="color:#94a3b8; font-size:12px;">🌐 Platform Pool (Fallback)</span>`;

            const statusHtml = b.isActive
                ? `<span class="badge-active">Active</span>`
                : `<span class="badge-banned">Inactive</span>`;

            return `
                <tr>
                    <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${b.id}</td>
                    <td><strong>${escapeHtml(b.bankName)}</strong></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <code style="color:#fff; font-size:13px; font-weight:700;">${escapeHtml(b.accountNumber)}</code>
                            <button onclick="navigator.clipboard && navigator.clipboard.writeText('${b.accountNumber}').then(() => alert('Account copied!'))" class="action-btn-sm" style="background:rgba(255,255,255,0.1); color:#94a3b8; padding:2px 6px; font-size:10px;">Copy</button>
                        </div>
                    </td>
                    <td style="color:#cbd5e1; font-size:13px;">${escapeHtml(b.accountName || '—')}</td>
                    <td>${adminHtml}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button onclick="openEditBankModal(${b.id})" class="action-btn-sm" style="background:#0ea5e9; color:#fff;" title="Edit Bank">✏️ Edit</button>
                            <button onclick="toggleBankActive(${b.id})" class="action-btn-sm" style="background:${b.isActive ? '#eab308' : '#22c55e'}; color:#fff;">${b.isActive ? 'Deactivate' : 'Activate'}</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error fetching admin banks:', err);
    }
}

function showAdminProfileStatus(msg, isSuccess = false) {
    const el = document.getElementById('admin-profile-status');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = isSuccess ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
    el.style.border = isSuccess ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(239,68,68,0.4)';
    el.style.color = isSuccess ? '#4ade80' : '#f87171';
}

function clearAdminProfileStatus() {
    const el = document.getElementById('admin-profile-status');
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
}

function openAddAdminProfileModal(preselectedUserId = null) {
    const modal = document.getElementById('admin-profile-modal');
    if (!modal) return;

    clearAdminProfileStatus();
    document.getElementById('admin-modal-title').textContent = '👑 Add Administrator from Users';
    document.getElementById('admin-profile-id').value = '';
    document.getElementById('admin-user-select-group').style.display = 'block';
    document.getElementById('admin-user-preview-card').style.display = 'none';
    document.getElementById('admin-code').value = '';
    document.getElementById('admin-custom-name').value = '';
    const limitInput = document.getElementById('admin-deposit-limit');
    if (limitInput) limitInput.value = '3000';
    updateBotLinkPreview('');

    // Populate user select dropdown
    const select = document.getElementById('admin-user-select');
    if (select) {
        select.required = true;
        select.innerHTML = '<option value="">-- Choose a user to promote --</option>' +
            allUsers.map(u => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'User';
                const uname = u.username ? `@${u.username}` : `ID: ${u.id}`;
                return `<option value="${u.id}">${escapeHtml(name)} (${escapeHtml(uname)}) — #${u.id}</option>`;
            }).join('');
    }

    // Populate bank checklist
    renderAdminBanksChecklist([]);

    if (preselectedUserId && select) {
        select.value = String(preselectedUserId);
        onAdminUserSelected(String(preselectedUserId));
    }

    modal.style.display = 'flex';
}

function promoteUserToAdmin(userId) {
    switchAdminTab('tab-admins');
    openAddAdminProfileModal(userId);
}

function onAdminUserSelected(userId) {
    const preview = document.getElementById('admin-user-preview-card');
    const codeInput = document.getElementById('admin-code');
    if (!userId) {
        if (preview) preview.style.display = 'none';
        if (codeInput) codeInput.value = '';
        updateBotLinkPreview('');
        return;
    }

    const u = allUsers.find(x => String(x.id) === String(userId));
    if (!u) return;

    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Player';
    setText('preview-user-name', name);
    setText('preview-user-id', '#' + u.id);
    setText('preview-user-username', u.username ? '@' + u.username : 'None');
    setText('preview-user-phone', u.phone || 'None');
    if (preview) preview.style.display = 'block';

    // Auto-suggest adm_username or adm_id
    const baseCode = u.username 
        ? 'adm_' + u.username.toLowerCase().replace(/[^a-z0-9_]/g, '')
        : 'adm_' + u.id;
    if (codeInput) {
        codeInput.value = baseCode;
        updateBotLinkPreview(baseCode);
    }
}

function updateBotLinkPreview(code) {
    const clean = String(code || '').trim().toLowerCase();
    setText('preview-bot-link', `https://t.me/PlayMyBingoBot?start=${clean || 'adm_...'}`);
}

function renderAdminBanksChecklist(selectedBankIds = []) {
    const list = document.getElementById('admin-banks-checklist');
    if (!list) return;

    if (allBanks.length === 0) {
        list.innerHTML = `<span style="font-size:12px; color:#94a3b8;">No bank accounts added yet. You can save the admin now and attach banks later.</span>`;
        return;
    }

    const selectedSet = new Set(selectedBankIds.map(Number));
    list.innerHTML = allBanks.map(b => {
        const checked = selectedSet.has(b.id) ? 'checked' : '';
        const ownerNote = b.admin ? ` <small style="color:#c084fc;">(Currently: ${escapeHtml(b.admin.name)})</small>` : '';
        return `
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#f1f5f9; cursor:pointer;">
                <input type="checkbox" name="admin-bank-check" value="${b.id}" ${checked} style="accent-color:#8b5cf6; width:16px; height:16px;">
                <span><strong>${escapeHtml(b.bankName)}:</strong> <code>${escapeHtml(b.accountNumber)}</code> ${b.accountName ? `(${escapeHtml(b.accountName)})` : ''}${ownerNote}</span>
            </label>
        `;
    }).join('');
}

function openEditAdminProfileModal(adminId) {
    const admin = allAdmins.find(a => a.id === adminId);
    if (!admin) return;

    const modal = document.getElementById('admin-profile-modal');
    if (!modal) return;

    clearAdminProfileStatus();
    document.getElementById('admin-modal-title').textContent = `✏️ Edit Administrator (${admin.user?.firstName || admin.code})`;
    document.getElementById('admin-profile-id').value = admin.id;
    document.getElementById('admin-user-select-group').style.display = 'none';

    // Disable required on hidden user select and sync its value
    const select = document.getElementById('admin-user-select');
    if (select) {
        select.required = false;
        select.value = String(admin.userId);
    }

    const preview = document.getElementById('admin-user-preview-card');
    if (preview) {
        preview.style.display = 'block';
        setText('preview-user-name', admin.user?.firstName || 'Admin');
        setText('preview-user-id', '#' + admin.userId);
        setText('preview-user-username', admin.user?.username ? '@' + admin.user.username : 'None');
        setText('preview-user-phone', admin.user?.phone || 'None');
    }

    document.getElementById('admin-code').value = admin.code;
    document.getElementById('admin-custom-name').value = admin.customName || '';
    const limitInput = document.getElementById('admin-deposit-limit');
    if (limitInput) limitInput.value = admin.depositLimit !== undefined ? admin.depositLimit : '3000';
    updateBotLinkPreview(admin.code);

    const linkedIds = Array.isArray(admin.paymentAccounts) ? admin.paymentAccounts.map(b => b.id) : [];
    renderAdminBanksChecklist(linkedIds);

    modal.style.display = 'flex';
}

function closeAdminProfileModal() {
    clearAdminProfileStatus();
    const modal = document.getElementById('admin-profile-modal');
    if (modal) modal.style.display = 'none';
}

async function saveAdminProfile(event) {
    if (event && event.preventDefault) event.preventDefault();
    clearAdminProfileStatus();

    const id = document.getElementById('admin-profile-id').value;
    const select = document.getElementById('admin-user-select');
    const userId = select ? select.value : '';
    const code = document.getElementById('admin-code').value.trim();
    const customName = document.getElementById('admin-custom-name').value.trim();
    const limitInput = document.getElementById('admin-deposit-limit');
    const depositLimit = limitInput && limitInput.value ? parseFloat(limitInput.value) : 3000;

    const checkBoxes = document.querySelectorAll('input[name="admin-bank-check"]:checked');
    const bankAccountIds = Array.from(checkBoxes).map(cb => parseInt(cb.value, 10));

    if (!id && !userId) {
        showAdminProfileStatus('⚠️ Please select a registered user to promote.');
        return;
    }
    if (!code) {
        showAdminProfileStatus('⚠️ Please specify an affiliate code.');
        return;
    }

    const submitBtn = document.getElementById('btn-save-admin-profile') || (event && event.target && event.target.querySelector('button[type="submit"]'));
    const originalBtnText = submitBtn ? submitBtn.innerHTML : '💾 Save & Link Banks';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Saving...';
    }

    try {
        const url = id ? `/api/admin/admins/${id}` : '/api/admin/admins';
        const method = id ? 'PUT' : 'POST';
        const body = id 
            ? { code, customName: customName || null, bankAccountIds, depositLimit }
            : { userId, code, customName: customName || null, bankAccountIds, depositLimit };

        const res = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) {
            showAdminProfileStatus('✅ Administrator saved successfully!', true);
            setTimeout(() => {
                closeAdminProfileModal();
            }, 600);
            await fetchAdmins();
            await fetchAdminBanks();
        } else {
            showAdminProfileStatus(`❌ ${data.msg || 'Failed to save administrator profile.'}`);
        }
    } catch (err) {
        console.error('Error saving admin:', err);
        showAdminProfileStatus('❌ Network error while saving administrator.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    }
}

async function refreshAdminDepositLimit(adminId, adminName, collected) {
    if (!confirm(`Confirm that you have received the collected ${Number(collected).toLocaleString()} Birr from ${adminName || 'Admin'} to reset their approval limit counter back to 0?`)) {
        return;
    }
    try {
        const res = await authFetch(`/api/admin/admins/${adminId}/refresh-limit`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(data.msg || 'Deposit limit refreshed successfully.');
            await fetchAdmins();
        } else {
            alert(data.msg || 'Failed to refresh limit.');
        }
    } catch (e) {
        alert('Network error refreshing limit.');
    }
}

function openAdminHandoverModal(adminId) {
    const admin = allAdmins.find(a => a.id === adminId);
    if (!admin) return;

    const modal = document.getElementById('admin-handover-modal');
    if (!modal) return;

    const sourceName = admin.customName || admin.user?.firstName || admin.code;
    const playersCount = admin.assignedUsersCount ?? 0;
    const requestsCount = admin.pendingRequestsCount ?? 0;

    document.getElementById('handover-source-id').value = admin.id;
    document.getElementById('handover-source-name').textContent = `${sourceName} (#${admin.userId})`;
    document.getElementById('handover-source-players').textContent = playersCount;
    document.getElementById('handover-source-requests').textContent = requestsCount;

    const targetSelect = document.getElementById('handover-target-admin');
    if (targetSelect) {
        // Other active admins first
        const otherAdmins = allAdmins.filter(a => a.id !== admin.id && a.isActive);
        let optionsHtml = '';
        if (otherAdmins.length > 0) {
            optionsHtml += '<optgroup label="Active Administrators">';
            optionsHtml += otherAdmins.map(a => {
                const name = a.customName || a.user?.firstName || a.code;
                const count = a.assignedUsersCount ?? 0;
                return `<option value="${a.id}">👑 ${escapeHtml(name)} (@${escapeHtml(a.user?.username || a.code)}) — has ${count} players</option>`;
            }).join('');
            optionsHtml += '</optgroup>';
        }
        optionsHtml += '<optgroup label="Platform Direct">';
        optionsHtml += '<option value="null">🏛️ Platform General Pool (Super Admin House)</option>';
        optionsHtml += '</optgroup>';
        targetSelect.innerHTML = optionsHtml;
    }

    modal.style.display = 'flex';
}

function closeAdminHandoverModal() {
    const modal = document.getElementById('admin-handover-modal');
    if (modal) modal.style.display = 'none';
}

async function submitAdminHandover(event) {
    if (event) event.preventDefault();
    const sourceId = parseInt(document.getElementById('handover-source-id').value, 10);
    const targetVal = document.getElementById('handover-target-admin').value;
    const targetAdminId = (targetVal && targetVal !== 'null') ? parseInt(targetVal, 10) : null;

    const reassignPlayers = document.getElementById('handover-opt-players').checked;
    const transferPendingRequests = document.getElementById('handover-opt-requests').checked;
    const deactivateSourceBanks = document.getElementById('handover-opt-banks').checked;
    const deactivateSourceAdmin = document.getElementById('handover-opt-deactivate').checked;

    const targetText = document.getElementById('handover-target-admin').selectedOptions[0]?.text || 'selected destination';

    if (!confirm(`Are you sure you want to transfer players and responsibilities to ${targetText}?`)) {
        return;
    }

    const btn = document.getElementById('btn-submit-handover');
    const origText = btn ? btn.innerHTML : '🔄 Execute Handover';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Processing Handover...';
    }

    try {
        const res = await authFetch(`/api/admin/admins/${sourceId}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetAdminId,
                deactivateSourceAdmin,
                deactivateSourceBanks,
                transferPendingRequests
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.msg || 'Handover completed successfully.');
            closeAdminHandoverModal();
            await fetchAdmins();
            await fetchAdminBanks();
        } else {
            alert(data.msg || 'Failed to complete handover.');
        }
    } catch (e) {
        alert('Network error while completing handover.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origText;
        }
    }
}

async function deleteAdminProfile(adminId) {
    if (!confirm('Are you sure you want to remove this administrator profile? All attached bank accounts will return to the platform pool, and downline players will be unassigned.')) return;

    try {
        const res = await authFetch(`/api/admin/admins/${adminId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            await fetchAdmins();
            await fetchAdminBanks();
        } else {
            alert(data.msg || 'Failed to delete administrator.');
        }
    } catch (err) {
        alert('Network error while deleting administrator.');
    }
}

function copyBotLink(code) {
    const link = `https://t.me/PlayMyBingoBot?start=${code}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            alert(`Copied bot invite link:\n${link}`);
        }).catch(() => prompt('Copy bot invite link:', link));
    } else {
        prompt('Copy bot invite link:', link);
    }
}

function openAddBankModal() {
    const modal = document.getElementById('bank-modal');
    if (!modal) return;
    document.getElementById('bank-modal-title').textContent = '🏦 Add Bank Account';
    document.getElementById('bank-id').value = '';
    document.getElementById('bank-name-input').value = '';
    document.getElementById('bank-number-input').value = '';
    document.getElementById('bank-holder-input').value = '';

    const select = document.getElementById('bank-admin-select');
    select.innerHTML = '<option value="">-- General Platform Pool (Unassigned) --</option>' +
        allAdmins.map(a => `<option value="${a.id}">👑 ${escapeHtml(a.customName || a.user?.firstName || a.code)} (@${a.user?.username || a.code})</option>`).join('');

    modal.style.display = 'flex';
}

function openEditBankModal(bankId) {
    const bank = allBanks.find(b => b.id === bankId);
    if (!bank) return;
    const modal = document.getElementById('bank-modal');
    if (!modal) return;

    document.getElementById('bank-modal-title').textContent = `✏️ Edit Bank Account #${bank.id}`;
    document.getElementById('bank-id').value = bank.id;
    document.getElementById('bank-name-input').value = bank.bankName;
    document.getElementById('bank-number-input').value = bank.accountNumber;
    document.getElementById('bank-holder-input').value = bank.accountName || '';

    const select = document.getElementById('bank-admin-select');
    select.innerHTML = '<option value="">-- General Platform Pool (Unassigned) --</option>' +
        allAdmins.map(a => `<option value="${a.id}" ${bank.adminId === a.id ? 'selected' : ''}>👑 ${escapeHtml(a.customName || a.user?.firstName || a.code)} (@${a.user?.username || a.code})</option>`).join('');

    modal.style.display = 'flex';
}

function closeBankModal() {
    const modal = document.getElementById('bank-modal');
    if (modal) modal.style.display = 'none';
}

async function saveBankAccount(event) {
    event.preventDefault();
    const id = document.getElementById('bank-id').value;
    const bankName = document.getElementById('bank-name-input').value.trim();
    const accountNumber = document.getElementById('bank-number-input').value.trim();
    const accountName = document.getElementById('bank-holder-input').value.trim();
    const adminIdVal = document.getElementById('bank-admin-select').value;
    const adminId = adminIdVal ? parseInt(adminIdVal, 10) : null;

    if (!bankName || !accountNumber) {
        alert('Bank name and account number are required.');
        return;
    }

    try {
        const url = id ? `/api/admin/banks/${id}` : '/api/admin/banks';
        const method = id ? 'PUT' : 'POST';
        const res = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bankName, accountNumber, accountName: accountName || null, adminId })
        });
        const data = await res.json();
        if (data.success) {
            closeBankModal();
            await fetchAdminBanks();
            await fetchAdmins();
        } else {
            alert(data.msg || 'Failed to save bank account.');
        }
    } catch (err) {
        alert('Network error while saving bank account.');
    }
}

async function toggleBankActive(bankId) {
    try {
        const res = await authFetch(`/api/admin/banks/${bankId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            await fetchAdminBanks();
            await fetchAdmins();
        } else {
            alert(data.msg || 'Failed to update bank state.');
        }
    } catch (err) {
        alert('Network error while toggling bank state.');
    }
}

// -------------------- WITHDRAWAL PAYOUT BANKS MANAGEMENT --------------------
let allWithdrawalBanks = [];

async function fetchWithdrawalBanks() {
    try {
        const res = await authFetch('/api/admin/withdrawal-banks');
        if (!res.ok) throw new Error('Withdrawal banks fetch failed');
        allWithdrawalBanks = await res.json();
        if (!Array.isArray(allWithdrawalBanks)) allWithdrawalBanks = [];

        const tbody = document.querySelector('#withdrawal-banks-table tbody');
        if (!tbody) return;

        if (allWithdrawalBanks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">No withdrawal banks configured yet. Click <strong>➕ Add Payout Bank</strong> above to add banks (Telebirr, CBE, Awash, etc.) for players to withdraw to.</td></tr>`;
            return;
        }

        tbody.innerHTML = allWithdrawalBanks.map(b => {
            const badgeHtml = b.isFast
                ? `<span class="badge" style="background:rgba(234,179,8,0.2); color:#facc15; border:1px solid rgba(234,179,8,0.4); font-size:11px; padding:2px 8px; border-radius:6px; font-weight:700;">⚡ FAST</span>`
                : `<span style="color:#94a3b8; font-size:12px;">Standard Bank</span>`;

            const statusHtml = b.isActive
                ? `<span class="badge-active" style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid rgba(34,197,94,0.4); padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">Active</span>`
                : `<span class="badge-banned" style="background:rgba(148,163,184,0.2); color:#94a3b8; border:1px solid rgba(148,163,184,0.4); padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">Disabled</span>`;

            return `
                <tr>
                    <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${b.id}</td>
                    <td><strong style="color:#f8fafc; font-size:14px;">${escapeHtml(b.name)}</strong></td>
                    <td>${badgeHtml}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button onclick="toggleWithdrawalBank(${b.id})" class="action-btn-sm" style="background:${b.isActive ? '#eab308' : '#22c55e'}; color:#fff; font-weight:700;">${b.isActive ? 'Deactivate' : 'Activate'}</button>
                            <button onclick="deleteWithdrawalBank(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')" class="action-btn-sm" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);" title="Delete Bank">🗑</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error fetching withdrawal banks:', err);
    }
}

function openAddWithdrawalBankModal() {
    const modal = document.getElementById('withdrawal-bank-modal');
    if (!modal) return;
    document.getElementById('wdr-bank-name').value = '';
    document.getElementById('wdr-is-fast').checked = false;
    modal.style.display = 'flex';
}

function closeWithdrawalBankModal() {
    const modal = document.getElementById('withdrawal-bank-modal');
    if (modal) modal.style.display = 'none';
}

async function saveWithdrawalBank(event) {
    event.preventDefault();
    const name = document.getElementById('wdr-bank-name').value.trim();
    const isFast = document.getElementById('wdr-is-fast').checked;

    if (!name) {
        alert('Please enter or select a bank name.');
        return;
    }

    try {
        const res = await authFetch('/api/admin/withdrawal-banks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, isFast })
        });
        const data = await res.json();
        if (data.success) {
            closeWithdrawalBankModal();
            await fetchWithdrawalBanks();
        } else {
            alert(data.msg || 'Failed to add withdrawal bank.');
        }
    } catch (err) {
        alert('Network error while adding withdrawal bank.');
    }
}

async function toggleWithdrawalBank(id) {
    try {
        const res = await authFetch(`/api/admin/withdrawal-banks/${id}/toggle`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            await fetchWithdrawalBanks();
        } else {
            alert(data.msg || 'Failed to toggle bank.');
        }
    } catch (err) {
        alert('Network error while toggling bank.');
    }
}

async function deleteWithdrawalBank(id, name) {
    if (!confirm(`Are you sure you want to remove "${name}" from the withdrawal payout banks?`)) return;
    try {
        const res = await authFetch(`/api/admin/withdrawal-banks/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            await fetchWithdrawalBanks();
        } else {
            alert(data.msg || 'Failed to delete bank.');
        }
    } catch (err) {
        alert('Network error while deleting bank.');
    }
}

window.fetchWithdrawalBanks = fetchWithdrawalBanks;
window.openAddWithdrawalBankModal = openAddWithdrawalBankModal;
window.closeWithdrawalBankModal = closeWithdrawalBankModal;
window.saveWithdrawalBank = saveWithdrawalBank;
window.toggleWithdrawalBank = toggleWithdrawalBank;
window.deleteWithdrawalBank = deleteWithdrawalBank;

// Global exports for inline HTML event attributes
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.saveUserEdit = saveUserEdit;
window.openDeleteUserModal = openDeleteUserModal;
window.closeDeleteUserModal = closeDeleteUserModal;
window.handleRequestAction = handleRequestAction;
window.deleteSingleRequest = deleteSingleRequest;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.fetchCallerVoice = fetchCallerVoice;
window.setAdminVoice = setAdminVoice;
window.loadVoice = fetchCallerVoice;
window.updateVoiceUI = updateVoiceUI;
window.fetchBonusSettings = fetchBonusSettings;
window.saveBonusSettings = saveBonusSettings;
window.fetchWinCallThreshold = fetchWinCallThreshold;
window.saveWinCallThreshold = saveWinCallThreshold;
window.applyWinCallPreset = applyWinCallPreset;
window.updateWinCallPreview = updateWinCallPreview;
window.fetchBotSettings = fetchBotSettings;
window.saveBotSettings = saveBotSettings;
window.updateStakeBadges = updateStakeBadges;
window.injectBots = injectBots;
window.clearBots = clearBots;
window.setIncomeLobbyFilter = setIncomeLobbyFilter;
window.openActivePlayersModal = openActivePlayersModal;
window.closeActivePlayersModal = closeActivePlayersModal;
window.fetchActivePlayers = fetchActivePlayers;
window.kickActivePlayer = kickActivePlayer;
window.setActivePlayersFilter = setActivePlayersFilter;
window.forceStartRoom = forceStartRoom;

// Admin & Bank exports
window.fetchAdmins = fetchAdmins;
window.fetchAdminBanks = fetchAdminBanks;
window.openAddAdminProfileModal = openAddAdminProfileModal;
window.promoteUserToAdmin = promoteUserToAdmin;
window.onAdminUserSelected = onAdminUserSelected;
window.updateBotLinkPreview = updateBotLinkPreview;
window.openEditAdminProfileModal = openEditAdminProfileModal;
window.closeAdminProfileModal = closeAdminProfileModal;
window.saveAdminProfile = saveAdminProfile;
window.deleteAdminProfile = deleteAdminProfile;
window.copyBotLink = copyBotLink;
window.openAddBankModal = openAddBankModal;
window.openEditBankModal = openEditBankModal;
window.closeBankModal = closeBankModal;
window.saveBankAccount = saveBankAccount;
window.toggleBankActive = toggleBankActive;

// Duty Withdrawal Admin management
let currentDutyWithdrawalAdmin = null;

async function fetchDutyWithdrawalAdmin() {
    try {
        const res = await authFetch('/api/admin/withdrawal-admin');
        if (!res.ok) return;
        const data = await res.json();
        currentDutyWithdrawalAdmin = data.withdrawalAdmin || null;
        const nameEl = document.getElementById('duty-withdrawal-admin-name');
        if (!nameEl) return;
        if (data.withdrawalAdmin) {
            const w = data.withdrawalAdmin;
            const disp = w.customName || w.user?.firstName || w.code;
            const uname = w.user?.username ? ` (@${w.user.username})` : '';
            nameEl.innerHTML = `<span style="color:#fbbf24;">⭐ ${escapeHtml(disp)}${escapeHtml(uname)}</span> &bull; Code: <code style="color:#a78bfa;">${escapeHtml(w.code)}</code>`;
        } else {
            nameEl.innerHTML = `<span style="color:#38bdf8;">👑 Master Admin (Super-Admin default #${escapeHtml(data.masterAdminId || 'Master')})</span>`;
        }
    } catch (e) {
        console.error('Error fetching duty withdrawal admin:', e);
    }
}

function openChangeWithdrawalAdminModal() {
    const modal = document.getElementById('withdrawal-admin-modal');
    if (!modal) return;
    const select = document.getElementById('select-withdrawal-admin');
    if (!select) return;

    let opts = '<option value="">👑 Master Admin (Super-Admin default)</option>';
    allAdmins.filter(a => a.isActive).forEach(a => {
        const name = a.customName || a.user?.firstName || 'Admin';
        const uname = a.user?.username ? ` (@${a.user.username})` : '';
        const selected = a.isWithdrawalAdmin ? 'selected' : '';
        opts += `<option value="${a.id}" ${selected}>${escapeHtml(name)}${escapeHtml(uname)} — Code: ${escapeHtml(a.code)} (#${a.id})</option>`;
    });

    select.innerHTML = opts;
    modal.style.display = 'flex';
}

function closeChangeWithdrawalAdminModal() {
    const modal = document.getElementById('withdrawal-admin-modal');
    if (modal) modal.style.display = 'none';
}

async function saveDutyWithdrawalAdmin(event) {
    if (event) event.preventDefault();
    const select = document.getElementById('select-withdrawal-admin');
    if (!select) return;

    const adminId = select.value ? parseInt(select.value, 10) : null;
    try {
        const res = await authFetch('/api/admin/withdrawal-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId, clear: !adminId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert(data.msg || 'Failed to update duty withdrawal admin.');
            return;
        }
        closeChangeWithdrawalAdminModal();
        await fetchAdmins();
        await fetchDutyWithdrawalAdmin();
        alert(data.msg || 'Duty withdrawal admin successfully assigned.');
    } catch (e) {
        alert('Network error while assigning withdrawal admin.');
    }
}

async function setDutyWithdrawalAdmin(adminId) {
    const target = allAdmins.find(a => a.id === adminId);
    const name = target ? (target.customName || target.user?.firstName || target.code) : `Admin #${adminId}`;
    if (!confirm(`Are you sure you want to assign "${name}" as the Duty Withdrawal Admin?\n\nAll player withdrawals will route to their personal Telegram chat for 1-click approval.`)) {
        return;
    }

    try {
        const res = await authFetch('/api/admin/withdrawal-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert(data.msg || 'Failed to update duty withdrawal admin.');
            return;
        }
        await fetchAdmins();
        await fetchDutyWithdrawalAdmin();
        alert(data.msg || 'Duty withdrawal admin updated!');
    } catch (e) {
        alert('Network error while setting duty withdrawal admin.');
    }
}

window.fetchDutyWithdrawalAdmin = fetchDutyWithdrawalAdmin;
window.openChangeWithdrawalAdminModal = openChangeWithdrawalAdminModal;
window.closeChangeWithdrawalAdminModal = closeChangeWithdrawalAdminModal;
window.saveDutyWithdrawalAdmin = saveDutyWithdrawalAdmin;
window.setDutyWithdrawalAdmin = setDutyWithdrawalAdmin;

// ----------------------------------------------------
// 9. Administrators Audit & Performance Breakdown
// ----------------------------------------------------
let currentAuditPeriod = 'today';
let allAuditStats = null;

function initAuditPeriodFilters() {
    const buttons = document.querySelectorAll('.btn-audit-period');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'rgba(255, 255, 255, 0.08)';
                b.style.color = '#94a3b8';
                b.style.border = '1px solid rgba(255,255,255,0.1)';
            });
            btn.classList.add('active');
            btn.style.background = 'linear-gradient(135deg, #8b5cf6, #3b82f6)';
            btn.style.color = '#fff';
            btn.style.border = '1px solid rgba(255,255,255,0.4)';

            currentAuditPeriod = btn.getAttribute('data-audit-period') || 'today';
            fetchAdminAuditStats();
        });
    });
}

async function fetchAdminAuditStats() {
    try {
        const res = await authFetch(`/api/admin/audit-stats?period=${currentAuditPeriod}`);
        if (!res.ok) throw new Error('Audit stats fetch failed');
        const data = await res.json();
        allAuditStats = data;
        renderAdminAuditStats(data);
    } catch (err) {
        console.error('Error fetching admin audit stats:', err);
    }
}

function renderAdminAuditStats(data) {
    if (!data || !data.admins) return;

    // Render summary KPI cards
    const totals = data.totals || {};
    setText('audit-kpi-dep-approved', `${(totals.depositsApprovedAmount || 0).toLocaleString()} Birr`);
    setText('audit-kpi-dep-count', `${(totals.depositsApprovedCount || 0).toLocaleString()} requests approved`);

    setText('audit-kpi-wdr-approved', `${(totals.withdrawalsApprovedAmount || 0).toLocaleString()} Birr`);
    setText('audit-kpi-wdr-count', `${(totals.withdrawalsApprovedCount || 0).toLocaleString()} requests approved`);

    const pendingTotalAmt = (totals.depositsPendingAmount || 0) + (totals.withdrawalsPendingAmount || 0);
    const pendingTotalCount = (totals.depositsPendingCount || 0) + (totals.withdrawalsPendingCount || 0);
    setText('audit-kpi-pending-total', `${pendingTotalAmt.toLocaleString()} Birr`);
    setText('audit-kpi-pending-count', `${pendingTotalCount.toLocaleString()} requests pending`);

    setText('audit-kpi-total-volume', `${(totals.totalSettledVolume || 0).toLocaleString()} Birr`);

    // Render table
    const tbody = document.querySelector('#audit-table tbody');
    if (!tbody) return;

    if (data.admins.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#94a3b8; padding:24px;">No administrator records found.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.admins.map(a => {
        const m = a.metrics || {};
        
        let roleBadge = '';
        if (a.isSuperAdmin) {
            roleBadge = `<span class="badge" style="background:rgba(139,92,246,0.25); color:#c4b5fd; border:1px solid rgba(139,92,246,0.5); font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px;">👑 Super Admin</span>`;
        } else if (a.isWithdrawalAdmin) {
            roleBadge = `<span class="badge" style="background:rgba(245,158,11,0.25); color:#fbbf24; border:1px solid rgba(245,158,11,0.5); font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px;">💸 Duty Withdrawal Admin</span>`;
        } else {
            roleBadge = `<span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-size:11px; font-weight:600; padding:2px 8px; border-radius:4px;">Affiliate Admin</span>`;
        }

        const statusBadge = a.isSuperAdmin || a.isActive
            ? `<span class="badge-active" style="margin-left:4px; font-size:10px;">Active</span>`
            : `<span class="badge-banned" style="margin-left:4px; font-size:10px;">Inactive</span>`;

        const adminIdentity = a.isSuperAdmin
            ? `<strong style="color:#f8fafc; font-size:14px;">👑 Super Admin (Master)</strong><br><span style="color:#64748b; font-size:12px;">Platform Pool & Direct Requests</span>`
            : `<strong style="color:#f8fafc; font-size:14px;">${escapeHtml(a.displayName)}</strong>` +
              (a.username ? `<br><a href="https://t.me/${a.username}" target="_blank" style="color:#38bdf8; font-size:12px; text-decoration:none; font-weight:600;">@${escapeHtml(a.username)}</a>` : '') +
              `<br><code style="color:#a78bfa; font-size:11px;">code: ${escapeHtml(a.code)}</code>`;

        return `
            <tr>
                <td>${adminIdentity}</td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                        <div>${roleBadge} ${statusBadge}</div>
                        ${(!a.isSuperAdmin && a.depositLimit) ? `<small style="color:#94a3b8; font-size:11px;">Limit: ${Number(a.depositLimit).toLocaleString()} Birr</small>` : ''}
                    </div>
                </td>
                <td>
                    <strong style="color:#4ade80; font-size:14px;">${Number(m.depositsApprovedAmount || 0).toLocaleString()}</strong> <span class="currency">Birr</span><br>
                    <small style="color:#94a3b8; font-size:11px;">${m.depositsApprovedCount || 0} approved</small>
                </td>
                <td>
                    <strong style="color:#facc15; font-size:14px;">${Number(m.depositsPendingAmount || 0).toLocaleString()}</strong> <span class="currency">Birr</span><br>
                    <small style="color:#94a3b8; font-size:11px;">${m.depositsPendingCount || 0} pending</small>
                </td>
                <td>
                    <strong style="color:#f87171; font-size:14px;">${Number(m.depositsRejectedAmount || 0).toLocaleString()}</strong> <span class="currency">Birr</span><br>
                    <small style="color:#94a3b8; font-size:11px;">${m.depositsRejectedCount || 0} rejected</small>
                </td>
                <td>
                    <strong style="color:#38bdf8; font-size:14px;">${Number(m.withdrawalsApprovedAmount || 0).toLocaleString()}</strong> <span class="currency">Birr</span><br>
                    <small style="color:#94a3b8; font-size:11px;">${m.withdrawalsApprovedCount || 0} approved</small>
                </td>
                <td>
                    <strong style="color:#facc15; font-size:14px;">${Number(m.withdrawalsPendingAmount || 0).toLocaleString()}</strong> <span class="currency">Birr</span><br>
                    <small style="color:#94a3b8; font-size:11px;">${m.withdrawalsPendingCount || 0} pending</small>
                </td>
                <td>
                    <strong style="color:#f87171; font-size:14px;">${Number(m.withdrawalsRejectedAmount || 0).toLocaleString()}</strong> <span class="currency">Birr</span><br>
                    <small style="color:#94a3b8; font-size:11px;">${m.withdrawalsRejectedCount || 0} rejected</small>
                </td>
                <td>
                    <strong style="color:#c084fc; font-size:15px; font-weight:800;">${Number(m.totalSettledVolume || 0).toLocaleString()}</strong> <span class="currency">Birr</span>
                </td>
            </tr>
        `;
    }).join('');
}

window.fetchAdminAuditStats = fetchAdminAuditStats;




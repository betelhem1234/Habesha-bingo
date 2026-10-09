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
    }
}
window.switchAdminTab = switchAdminTab;

// ----------------------------------------------------
// 0. Authentication & Security (Option 1 & Option 2)
// ----------------------------------------------------
function getAdminToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        const clean = urlToken.trim();
        localStorage.setItem('adminToken', clean);
        // Strip sensitive token from browser address bar
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        return clean;
    }
    return localStorage.getItem('adminToken');
}

function initAuth() {
    const loginForm = document.getElementById('admin-login-form');
    const logoutBtn = document.getElementById('btn-logout');

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

                if (res.ok && data.success && data.token) {
                    localStorage.setItem('adminToken', data.token);
                    hideLoginOverlay();
                    if (passInput) passInput.value = '';
                    await refreshAllData();
                } else {
                    showLoginOverlay(data.msg || 'Incorrect admin password.');
                }
            } catch (err) {
                showLoginOverlay('Network error verifying password.');
            } finally {
                if (submitBtn) {
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
        showLoginOverlay('Session expired or unauthorized. Please log in again.');
        throw new Error('Unauthorized');
    }
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
        fetchBonusSettings(),
        fetchAdmins(),
        fetchAdminBanks()
    ]);
}

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

// ----------------------------------------------------
// 3. House Income & Game Payouts Table
// ----------------------------------------------------
async function fetchHouseIncome() {
    try {
        const res = await authFetch(`/api/admin/income?period=${currentPeriod}`);
        if (!res.ok) throw new Error('House income fetch failed');
        const data = await res.json();

        const tbody = document.querySelector('#income-table tbody');
        if (!tbody) return;

        const incomes = data.incomes || [];
        const summary = data.summary || {};

        if (incomes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:24px;">No games recorded in this period.</td></tr>`;
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

                function formatUserBadge(name, username, id) {
                    if (username) {
                        return `<strong>${escapeHtml(name || 'Winner')}</strong><br><a href="https://t.me/${username}" target="_blank" style="color:#38bdf8; font-size:12px; text-decoration:none;">@${escapeHtml(username)}</a>`;
                    }
                    if (name) {
                        return `<strong>${escapeHtml(name)}</strong>`;
                    }
                    return `<span style="color:#64748b;">ID: ${escapeHtml(String(id || '—'))}</span>`;
                }

                let winnerDisplay = '—';
                const isAllBlocked = Boolean(i.winnerCount === 0 || (!i.winnerId && !i.winner2Id));
                const hasTwoWinners = Boolean(!isAllBlocked && ((i.winnerCount && i.winnerCount > 1) || i.winner2Id));

                if (isAllBlocked) {
                    winnerDisplay = `<span style="color:#ef4444; font-weight:700;">⛔ All Blocked (No Winner)</span>`;
                } else if (hasTwoWinners) {
                    const w1 = formatUserBadge(i.winnerName, i.winnerUsername, i.winnerId);
                    const w2 = formatUserBadge(i.winner2Name, i.winner2Username, i.winner2Id);
                    winnerDisplay = `<div style="display:flex; flex-direction:column; gap:4px;">
                        <div>${w1}</div>
                        <div style="color:#f59e0b; font-size:11px; font-weight:700;">🤝 Shared Jackpot</div>
                        <div>${w2}</div>
                    </div>`;
                } else if (i.winnerId) {
                    winnerDisplay = formatUserBadge(i.winnerName, i.winnerUsername, i.winnerId);
                }

                const payoutDisplay = isAllBlocked
                    ? `<strong style="color:#94a3b8;">0</strong> <span class="currency">Birr</span>`
                    : (hasTwoWinners
                        ? `<strong style="color:#38bdf8;">${(i.winnerPayout ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span><br><span style="color:#94a3b8; font-size:11px; font-weight:600;">(${(i.splitPayout ?? Math.floor((i.winnerPayout || 0) / 2)).toLocaleString()} Birr each)</span>`
                        : `<strong style="color:#38bdf8;">${(i.winnerPayout ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span>`);

                return `
                    <tr>
                        <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(i.id))}</td>
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
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:24px;">No users found.</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#94a3b8; padding:24px;">No requests found in this category.</td></tr>`;
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
    const bonus = parseFloat(document.getElementById('edit-user-bonus').value);
    const phone = document.getElementById('edit-user-phone').value.trim();
    const banned = document.getElementById('edit-user-banned').value === 'true';

    try {
        const res = await authFetch(`/api/admin/user/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ balance, bonus, phone, username, firstName, banned })
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
async function fetchBonusSettings() {
    try {
        const res = await authFetch('/api/admin/bonus');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.success) {
            const inputNewUser = document.getElementById('input-new-user-bonus');
            const inputReferral = document.getElementById('input-referral-bonus');
            if (inputNewUser && document.activeElement !== inputNewUser && data.newUserBonus !== undefined) {
                inputNewUser.value = data.newUserBonus;
            }
            if (inputReferral && document.activeElement !== inputReferral && data.referralBonus !== undefined) {
                inputReferral.value = data.referralBonus;
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
// 9. Active Players Inspector Modal
// ----------------------------------------------------
let activePlayersPollInterval = null;

async function openActivePlayersModal() {
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

async function fetchActivePlayers() {
    const loadingEl = document.getElementById('active-players-loading');
    const emptyEl = document.getElementById('active-players-empty');
    const tableEl = document.getElementById('active-players-table');
    const tbodyEl = document.getElementById('active-players-tbody');
    const countBadge = document.getElementById('active-players-count-badge');

    try {
        const res = await authFetch('/api/admin/active-players');
        if (!res.ok) throw new Error('Failed to load active players');
        const data = await res.json();
        const players = data.players || [];

        if (countBadge) countBadge.textContent = players.length;
        if (loadingEl) loadingEl.style.display = 'none';

        if (players.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            if (tableEl) tableEl.style.display = 'none';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (tableEl) tableEl.style.display = 'table';

        if (tbodyEl) {
            tbodyEl.innerHTML = players.map(item => {
                const p = item.player;
                const boardsHtml = (p.boards && p.boards.length > 0)
                    ? p.boards.map(b => `<span style="background:rgba(56,189,248,0.2); color:#38bdf8; padding:2px 8px; border-radius:6px; font-weight:700; margin-right:4px;">#${b}</span>`).join('')
                    : '<span style="color:#64748b;">None</span>';
                
                const roomText = item.fee > 0 ? `${item.fee} Birr (Room #${item.room})` : `Free Demo`;
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

                return `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                        <td style="padding:12px 8px;">
                            <div style="font-weight:700; color:#f8fafc;">${escapeHtml(p.firstName || 'Player')}</div>
                            <div style="font-size:11px; color:#94a3b8;">${p.username ? '@' + escapeHtml(p.username) + ' • ' : ''}ID: <code>${p.userId}</code></div>
                            ${p.phone ? `<div style="font-size:11px; color:#38bdf8;">📱 ${escapeHtml(p.phone)}</div>` : ''}
                        </td>
                        <td style="padding:12px 8px; font-weight:600; color:#cbd5e1;">${roomText}</td>
                        <td style="padding:12px 8px;">${boardsHtml}</td>
                        <td style="padding:12px 8px;">${stateBadge}</td>
                        <td style="padding:12px 8px;">${lastSeenHtml}</td>
                        <td style="padding:12px 8px; text-align:right;">${kickBtn}</td>
                    </tr>
                `;
            }).join('');
        }
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
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:24px;">No administrator affiliates created yet. Click <strong>➕ Add Administrator</strong> above to promote a user!</td></tr>`;
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

            const statusHtml = a.isActive
                ? `<span class="badge-active">Active</span>`
                : `<span class="badge-banned">Inactive</span>`;

            return `
                <tr>
                    <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${a.id}</td>
                    <td>${displayName}</td>
                    <td><code style="color:#38bdf8; font-size:12px;">#${escapeHtml(a.userId)}</code><br>${usernameHtml}</td>
                    <td>${linkHtml}</td>
                    <td>${banksHtml}</td>
                    <td><strong style="color:#4ade80;">${a.assignedUsersCount ?? 0}</strong> <span style="font-size:11px; color:#94a3b8;">players</span></td>
                    <td>${statusHtml}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button onclick="openEditAdminProfileModal(${a.id})" class="action-btn-sm" style="background:#3b82f6; color:#fff;" title="Edit Administrator">✏️ Edit</button>
                            <button onclick="deleteAdminProfile(${a.id})" class="action-btn-sm" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);" title="Remove Administrator">🗑</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
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

function openAddAdminProfileModal(preselectedUserId = null) {
    const modal = document.getElementById('admin-profile-modal');
    if (!modal) return;

    document.getElementById('admin-modal-title').textContent = '👑 Add Administrator from Users';
    document.getElementById('admin-profile-id').value = '';
    document.getElementById('admin-user-select-group').style.display = 'block';
    document.getElementById('admin-user-preview-card').style.display = 'none';
    document.getElementById('admin-code').value = '';
    document.getElementById('admin-custom-name').value = '';
    updateBotLinkPreview('');

    // Populate user select dropdown
    const select = document.getElementById('admin-user-select');
    select.innerHTML = '<option value="">-- Choose a user to promote --</option>' +
        allUsers.map(u => {
            const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'User';
            const uname = u.username ? `@${u.username}` : `ID: ${u.id}`;
            return `<option value="${u.id}">${escapeHtml(name)} (${escapeHtml(uname)}) — #${u.id}</option>`;
        }).join('');

    // Populate bank checklist
    renderAdminBanksChecklist([]);

    if (preselectedUserId) {
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

    document.getElementById('admin-modal-title').textContent = `✏️ Edit Administrator (${admin.user?.firstName || admin.code})`;
    document.getElementById('admin-profile-id').value = admin.id;
    document.getElementById('admin-user-select-group').style.display = 'none';

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
    updateBotLinkPreview(admin.code);

    const linkedIds = Array.isArray(admin.paymentAccounts) ? admin.paymentAccounts.map(b => b.id) : [];
    renderAdminBanksChecklist(linkedIds);

    modal.style.display = 'flex';
}

function closeAdminProfileModal() {
    const modal = document.getElementById('admin-profile-modal');
    if (modal) modal.style.display = 'none';
}

async function saveAdminProfile(event) {
    event.preventDefault();
    const id = document.getElementById('admin-profile-id').value;
    const userId = document.getElementById('admin-user-select').value;
    const code = document.getElementById('admin-code').value.trim();
    const customName = document.getElementById('admin-custom-name').value.trim();

    const checkBoxes = document.querySelectorAll('input[name="admin-bank-check"]:checked');
    const bankAccountIds = Array.from(checkBoxes).map(cb => parseInt(cb.value, 10));

    if (!id && !userId) {
        alert('Please select a registered user to promote.');
        return;
    }
    if (!code) {
        alert('Please specify an affiliate code.');
        return;
    }

    try {
        const url = id ? `/api/admin/admins/${id}` : '/api/admin/admins';
        const method = id ? 'PUT' : 'POST';
        const body = id 
            ? { code, customName: customName || null, bankAccountIds }
            : { userId, code, customName: customName || null, bankAccountIds };

        const res = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) {
            closeAdminProfileModal();
            await fetchAdmins();
            await fetchAdminBanks();
        } else {
            alert(data.msg || 'Failed to save administrator profile.');
        }
    } catch (err) {
        alert('Network error while saving administrator.');
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
window.toggleSelectRequest = toggleSelectRequest;
window.fetchBonusSettings = fetchBonusSettings;
window.saveBonusSettings = saveBonusSettings;
window.openActivePlayersModal = openActivePlayersModal;
window.closeActivePlayersModal = closeActivePlayersModal;
window.fetchActivePlayers = fetchActivePlayers;
window.kickActivePlayer = kickActivePlayer;

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



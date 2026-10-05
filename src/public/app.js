// Bingo Admin Dashboard Controller (app.js) with Authentication

let allRequests = [];
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
    await Promise.allSettled([
        fetchFinancialSummary(),
        fetchHouseIncome(),
        fetchStats(),
        fetchUsers(),
        fetchRequests()
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
        setText('stat-period-wdr', (data.totalWithdrawals ?? 0).toLocaleString());

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

                const winnerDisplay = i.winnerUsername
                    ? `<strong>${escapeHtml(i.winnerName || 'Winner')}</strong><br><a href="https://t.me/${i.winnerUsername}" target="_blank" style="color:#38bdf8; font-size:12px; text-decoration:none;">@${escapeHtml(i.winnerUsername)}</a>`
                    : i.winnerName
                        ? `<strong>${escapeHtml(i.winnerName)}</strong>`
                        : `<span style="color:#64748b;">ID: ${escapeHtml(String(i.winnerId || '—'))}</span>`;

                return `
                    <tr>
                        <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(i.id))}</td>
                        <td style="color:#94a3b8; font-size:12px; white-space:nowrap;">${dateStr}</td>
                        <td><strong style="color:#f8fafc;">${i.playerCount}</strong></td>
                        <td><strong>${(i.pot ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                        <td><strong style="color:#38bdf8;">${(i.winnerPayout ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
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
// 5. Top Users Table
// ----------------------------------------------------
async function fetchUsers() {
    try {
        const res = await authFetch('/api/users');
        if (!res.ok) throw new Error('Users fetch failed');
        const users = await res.json();

        const tbody = document.querySelector('#users-table tbody');
        if (!tbody) return;

        if (!users || users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:24px;">No users registered yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Player';
            const usernameHtml = u.username 
                ? `<a href="https://t.me/${u.username}" target="_blank" style="color:#38bdf8; text-decoration:none; font-weight:600;">@${escapeHtml(u.username)}</a>`
                : `<span style="color:#64748b;">—</span>`;
            
            return `
                <tr>
                    <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(u.id))}</td>
                    <td>${usernameHtml}</td>
                    <td>${escapeHtml(fullName)}</td>
                    <td><strong style="color:#4ade80;">${(u.balance ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                    <td style="color:#a78bfa; font-weight:600;">${u.referrals ?? 0}</td>
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

            if (isChecked) {
                filtered.forEach(r => selectedRequestIds.add(r.id));
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
        checkAll.checked = filtered.length > 0 && filtered.every(r => selectedRequestIds.has(r.id));
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

        actionButtons += `
                <button onclick="openEditModal(${r.id})" class="action-btn-sm" style="background:#3b82f6; color:#fff;" title="Edit request">✏️ Edit</button>
                <button onclick="deleteSingleRequest(${r.id}, '${r.type}', ${r.amount})" class="action-btn-sm" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4);" title="Delete request">🗑</button>
            </div>
        `;

        return `
            <tr>
                <td style="text-align:center;">
                    <input type="checkbox" class="req-check" data-id="${r.id}" ${isChecked ? 'checked' : ''} onchange="toggleSelectRequest(${r.id}, this.checked)">
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

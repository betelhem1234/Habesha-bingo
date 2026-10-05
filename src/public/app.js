// Bingo Admin Dashboard Controller (app.js)

let allRequests = [];
let currentFilter = 'ALL';
let isActionRunning = false;

document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initForceStart();
    
    // Initial fetch
    refreshAllData();

    // Auto-refresh every 10 seconds for real-time monitoring
    setInterval(refreshAllData, 10000);
});

async function refreshAllData() {
    await Promise.allSettled([
        fetchStats(),
        fetchUsers(),
        fetchRequests()
    ]);
}

// ----------------------------------------------------
// 1. Live Stats
// ----------------------------------------------------
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('Stats fetch failed');
        const data = await res.json();

        const statUsers = document.getElementById('stat-users');
        const statBalance = document.getElementById('stat-balance');
        const statPlayers = document.getElementById('stat-players');
        const statState = document.getElementById('stat-state');
        const btnStart = document.getElementById('btn-start');

        if (statUsers) statUsers.textContent = (data.users ?? 0).toLocaleString();
        if (statBalance) statBalance.textContent = (data.balance ?? 0).toLocaleString();
        if (statPlayers) statPlayers.textContent = (data.activePlayers ?? 0).toLocaleString();
        
        if (statState) {
            statState.textContent = data.gameState || 'WAITING';
            if (data.gameState === 'PLAYING') {
                statState.style.color = '#4ade80';
            } else {
                statState.style.color = '#facc15';
            }
        }

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
// 2. Top Users
// ----------------------------------------------------
async function fetchUsers() {
    try {
        const res = await fetch('/api/users');
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
// 3. Deposit & Withdraw Requests
// ----------------------------------------------------
async function fetchRequests() {
    try {
        const res = await fetch('/api/requests');
        if (!res.ok) throw new Error('Requests fetch failed');
        allRequests = await res.json();

        renderRequests();
    } catch (err) {
        console.error('Error fetching requests:', err);
    }
}

function initFilters() {
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

function renderRequests() {
    updateFilterButtonStyles();

    const tbody = document.querySelector('#req-table tbody');
    if (!tbody) return;

    let filtered = allRequests;
    if (currentFilter !== 'ALL') {
        filtered = allRequests.filter(r => r.status === currentFilter);
    }

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#94a3b8; padding:24px;">No requests found in this category.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(r => {
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

        let actionHtml = '';
        if (r.status === 'PENDING') {
            actionHtml = `
                <div style="display:flex; gap:6px;">
                    <button onclick="handleRequestAction(${r.id}, 'approve', '${r.type}', ${r.amount})" class="btn-primary" style="margin:0; padding:6px 10px; font-size:12px; background:#16a34a; border:none; border-radius:6px; cursor:pointer;">✓ Approve</button>
                    <button onclick="handleRequestAction(${r.id}, 'reject', '${r.type}', ${r.amount})" class="btn-primary" style="margin:0; padding:6px 10px; font-size:12px; background:#dc2626; border:none; border-radius:6px; cursor:pointer;">✗ Reject</button>
                </div>
            `;
        } else if (r.status === 'APPROVED') {
            actionHtml = `<span style="color:#4ade80; font-weight:600; font-size:12px;">✓ Done</span>`;
        } else {
            actionHtml = `<span style="color:#f87171; font-weight:600; font-size:12px;">✗ Done</span>`;
        }

        return `
            <tr>
                <td style="color:#94a3b8; font-family:monospace; font-size:13px;">#${escapeHtml(String(r.id))}</td>
                <td>${userDisplay}</td>
                <td>${typeBadge}</td>
                <td><strong style="font-size:15px; color:#f8fafc;">${(r.amount ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                <td>${phoneAndProof}</td>
                <td>${statusBadge}</td>
                <td><strong style="color:#94a3b8;">${(r.balance ?? 0).toLocaleString()}</strong> <span class="currency">Birr</span></td>
                <td style="color:#94a3b8; font-size:12px; white-space:nowrap;">${dateStr}</td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

// ----------------------------------------------------
// 4. Request Action Handlers (Approve / Reject)
// ----------------------------------------------------
async function handleRequestAction(id, action, type, amount) {
    if (isActionRunning) return;

    const actionUpper = action.toUpperCase();
    const typeUpper = type.toUpperCase();
    const ok = confirm(`Are you sure you want to ${actionUpper} this ${typeUpper} request #${id} of ${amount} Birr?`);
    if (!ok) return;

    isActionRunning = true;
    try {
        const res = await fetch(`/api/request/${id}/${action}`, {
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
// 5. Force Start Game
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
            const res = await fetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bet: 10, room: 1 })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                alert('✅ Game force-started successfully!');
                await fetchStats();
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

// Helper: Escape HTML to prevent injection
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

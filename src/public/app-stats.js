// Admin Dashboard Stats & Broadcast Controller (app-stats.js)

document.addEventListener('DOMContentLoaded', () => {
    initRefreshButton();
    initBroadcastButton();

    // Initial load
    loadAdminStats();

    // Auto-refresh every 15 seconds
    setInterval(loadAdminStats, 15000);
});

// ----------------------------------------------------
// 1. Fetch & Render Admin Stats
// ----------------------------------------------------
async function loadAdminStats() {
    const refreshSpan = document.getElementById('refreshing');
    const updatedAtEl = document.getElementById('updated-at');

    if (refreshSpan) refreshSpan.style.display = 'inline';

    try {
        const res = await fetch('/api/admin/stats');
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
        });
    }
}

// ----------------------------------------------------
// 3. Broadcast to Players
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
            const res = await fetch('/api/admin/broadcast', {
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

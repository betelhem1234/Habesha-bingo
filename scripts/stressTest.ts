/**
 * Bingo Bot Load & Stress Testing Simulator
 *
 * Usage:
 *   npx tsx scripts/stressTest.ts [--users 50] [--host http://localhost:3000] [--concurrency 25]
 */

interface StressOptions {
    host: string;
    users: number;
    concurrency: number;
    fee: number;
    room: number;
}

interface LatencyStats {
    count: number;
    errors: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    rps: number;
}

function parseArgs(): StressOptions {
    const args = process.argv.slice(2);
    const opts: StressOptions = {
        host: 'http://localhost:3000',
        users: 50,
        concurrency: 20,
        fee: 10,
        room: 1
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--host' && args[i + 1]) opts.host = args[++i];
        if (args[i] === '--users' && args[i + 1]) opts.users = parseInt(args[++i], 10);
        if (args[i] === '--concurrency' && args[i + 1]) opts.concurrency = parseInt(args[++i], 10);
        if (args[i] === '--fee' && args[i + 1]) opts.fee = parseInt(args[++i], 10);
        if (args[i] === '--room' && args[i + 1]) opts.room = parseInt(args[++i], 10);
    }

    return opts;
}

function computeStats(latencies: number[], errors: number, totalDurationMs: number): LatencyStats {
    if (latencies.length === 0) {
        return { count: 0, errors, min: 0, max: 0, p50: 0, p95: 0, p99: 0, avg: 0, rps: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const avg = sum / sorted.length;
    const rps = totalDurationMs > 0 ? (sorted.length / (totalDurationMs / 1000)) : 0;

    return {
        count: sorted.length,
        errors,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p50,
        p95,
        p99,
        avg: Math.round(avg * 100) / 100,
        rps: Math.round(rps * 100) / 100
    };
}

async function runHealthCheck(host: string): Promise<boolean> {
    const url = `${host}/api/health`;
    console.log(`[1/4] Checking server health at ${url}...`);
    try {
        const start = performance.now();
        const res = await fetch(url);
        const duration = Math.round(performance.now() - start);
        if (res.ok) {
            const data: any = await res.json();
            console.log(`✅ Health check OK (${duration}ms)`);
            console.log(`   - Status: ${data.status}`);
            console.log(`   - Uptime: ${data.uptimeSeconds}s`);
            console.log(`   - Heap Used: ${data.memory?.heapUsedMB} MB / ${data.memory?.heapTotalMB} MB`);
            console.log(`   - Event Loop Lag (p99): ${data.eventLoopLagMs?.p99}ms`);
            console.log(`   - Database: ${data.database}`);
            return true;
        } else {
            console.error(`❌ Health check failed: HTTP ${res.status}`);
            return false;
        }
    } catch (e: any) {
        console.error(`❌ Health check unreachable: ${e.message}`);
        return false;
    }
}

async function runBoardLoadTest(opts: StressOptions): Promise<void> {
    console.log(`\n[2/4] Testing /api/boards throughput with ${opts.users} virtual users (batch concurrency ${opts.concurrency})...`);

    const latencies: number[] = [];
    let errors = 0;
    const overallStart = performance.now();

    const queue = Array.from({ length: opts.users }, (_, i) => i + 1);

    async function worker() {
        while (queue.length > 0) {
            const userId = queue.shift()!;
            const url = `${opts.host}/api/boards?fee=${opts.fee}&room=${opts.room}&userId=${userId}`;
            const reqStart = performance.now();
            try {
                const res = await fetch(url);
                const dur = performance.now() - reqStart;
                if (res.ok) {
                    latencies.push(dur);
                } else {
                    errors++;
                }
            } catch {
                errors++;
            }
        }
    }

    const workers = Array.from({ length: Math.min(opts.concurrency, opts.users) }, () => worker());
    await Promise.all(workers);

    const totalDuration = performance.now() - overallStart;
    const stats = computeStats(latencies, errors, totalDuration);

    console.log(`\n📊 Board Lookup Benchmark Results:`);
    console.table({
        'Total Requests': stats.count + stats.errors,
        'Successful': stats.count,
        'Errors / Throttled': stats.errors,
        'Throughput (RPS)': `${stats.rps} req/sec`,
        'Min Latency': `${stats.min.toFixed(1)} ms`,
        'Average Latency': `${stats.avg.toFixed(1)} ms`,
        'p50 Latency': `${stats.p50.toFixed(1)} ms`,
        'p95 Latency': `${stats.p95.toFixed(1)} ms`,
        'p99 Latency': `${stats.p99.toFixed(1)} ms`,
        'Max Latency': `${stats.max.toFixed(1)} ms`
    });
}

async function runLobbyStatsTest(opts: StressOptions): Promise<void> {
    console.log(`\n[3/4] Testing /api/lobby/:userId under load (30 concurrent player polls)...`);

    const latencies: number[] = [];
    let errors = 0;
    const start = performance.now();

    const requests = Array.from({ length: 30 }, async (_, i) => {
        const userId = 900000 + i;
        const reqStart = performance.now();
        try {
            const res = await fetch(`${opts.host}/api/lobby/${userId}`);
            const dur = performance.now() - reqStart;
            if (res.ok) latencies.push(dur);
            else errors++;
        } catch {
            errors++;
        }
    });

    await Promise.all(requests);
    const totalDuration = performance.now() - start;
    const stats = computeStats(latencies, errors, totalDuration);

    console.log(`📊 Lobby Polling Results:`);
    console.table({
        'Successful': stats.count,
        'Errors': stats.errors,
        'Throughput (RPS)': `${stats.rps} req/sec`,
        'p50 Latency': `${stats.p50.toFixed(1)} ms`,
        'p95 Latency': `${stats.p95.toFixed(1)} ms`,
        'p99 Latency': `${stats.p99.toFixed(1)} ms`
    });
}

async function runPostTestHealth(opts: StressOptions): Promise<void> {
    console.log(`\n[4/4] Verifying server health post-stress...`);
    try {
        const res = await fetch(`${opts.host}/api/health`);
        if (res.ok) {
            const data: any = await res.json();
            console.log(`✅ Server healthy after load test:`);
            console.log(`   - Status: ${data.status}`);
            console.log(`   - Event Loop Lag (p99): ${data.eventLoopLagMs?.p99}ms`);
            console.log(`   - Heap Used: ${data.memory?.heapUsedMB} MB`);
        }
    } catch (e: any) {
        console.error(`❌ Post-stress check failed: ${e.message}`);
    }
}

async function main() {
    const opts = parseArgs();
    console.log(`========================================`);
    console.log(`  ETHIO BINGO LOAD & STRESS SIMULATOR   `);
    console.log(`========================================`);
    console.log(`Target:      ${opts.host}`);
    console.log(`Users:       ${opts.users}`);
    console.log(`Concurrency: ${opts.concurrency}`);
    console.log(`Fee Room:    ${opts.fee} Birr (Room ${opts.room})`);
    console.log(`----------------------------------------`);

    const alive = await runHealthCheck(opts.host);
    if (!alive) {
        console.error(`\n⚠️ Target server at ${opts.host} is not running or unreachable.`);
        console.error(`Please ensure the server is started with 'npm start' before running this test.`);
        process.exit(1);
    }

    await runBoardLoadTest(opts);
    await runLobbyStatsTest(opts);
    await runPostTestHealth(opts);

    console.log(`\n🎉 Load & stress test completed successfully.\n`);
}

main().catch(err => {
    console.error('Fatal error during stress test:', err);
    process.exit(1);
});

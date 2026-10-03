/**
 * Patches Grammy's platform.node.js to force IPv4 connections.
 * This is needed on networks where IPv6 connections to Telegram's API timeout.
 * Run automatically via the postinstall npm script.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../node_modules/grammy/out/platform.node.js');

if (!fs.existsSync(file)) {
    console.log('[patch-grammy] File not found, skipping.');
    process.exit(0);
}

let content = fs.readFileSync(file, 'utf8');

const OLD = `new https_1.Agent({ keepAlive: true })`;
const NEW = `new https_1.Agent({ keepAlive: true, family: 4 })`;

if (content.includes(NEW)) {
    console.log('[patch-grammy] Already patched, skipping.');
    process.exit(0);
}

if (!content.includes(OLD)) {
    console.log('[patch-grammy] Target string not found, patch may be outdated.');
    process.exit(0);
}

content = content.replace(OLD, NEW);
fs.writeFileSync(file, content);
console.log('[patch-grammy] ✅ Successfully patched grammy to use IPv4.');

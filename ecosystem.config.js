module.exports = {
    apps: [
        {
            name: 'bingo-bot',
            script: 'src/bot.ts',
            interpreter: 'node_modules/.bin/tsx',
            cwd: __dirname,
            env: {
                NODE_ENV: 'production'
            },
            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000
        }
    ]
};
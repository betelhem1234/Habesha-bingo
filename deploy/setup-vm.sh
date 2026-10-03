#!/usr/bin/env bash
# Play With Me — Oracle Cloud Free-tier VM setup script
# Run as:  sudo bash deploy/setup-vm.sh
set -e

echo "==> Updating system packages"
apt-get update -y && apt-get upgrade -y

echo "==> Installing Node.js 20 (LTS)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Installing PostgreSQL"
apt-get install -y postgresql postgresql-contrib

echo "==> Installing pm2 (process manager)"
npm install -g pm2

echo "==> Installing cloudflared"
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflare.com/cloudflared any main" | tee /etc/apt/sources.list.d/cloudflared.list
apt-get update -y && apt-get install -y cloudflared

echo "==> Starting PostgreSQL service"
systemctl enable postgresql
systemctl start postgresql

echo "==> Creating app database user"
sudo -u postgres psql -c "CREATE USER bingo WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE bingo_db OWNER bingo;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE bingo_db TO bingo;"

# Open firewall port for cloudflared (3000) — cloudflared can use a random local port too
echo "==> Opening port 3000 in firewall (if ufw is active)"
ufw allow 3000/tcp || true

echo ""
echo "==============================================================="
echo "  VM setup COMPLETE."
echo ""
echo "  Next steps (run as your normal user):"
echo "   1. cd to the bot folder"
echo "   2. cp .env.example .env   and fill in real values"
echo "   3. npm install"
echo "   4. npx prisma migrate deploy"
echo "   5. npx pm2 start ecosystem.config.js"
echo "   6. npx cloudflared tunnel --url http://localhost:3000"
echo "   7. Put the cloudflared https URL into .env as BINGO_APP_URL"
echo "   8. npx pm2 restart bingo-bot"
echo "==============================================================="
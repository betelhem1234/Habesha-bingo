# Deploying Play With Me to Oracle Cloud Free Tier

This guide takes you from an empty Oracle Cloud account to a running, always-online bingo bot that no longer depends on your PC.

## Part 1 — Create the free VM (once)

1. Go to https://cloud.oracle.com and sign in.
2. Menu ☰ → **Compute** → **Instances** → **Create instance**.
3. Name it `bingo` (any name).
4. **Placement / Shape**:
   - Click **Edit** next to Shape.
   - Choose **Ampere (ARM)** → **VM.Standard.A1.Flex** (free tier: up to 4 OCPU / 24 GB RAM).
   - Set **OCPUs: 2**, **Memory: 12 GB** (comfortable, still free). 1 OCPU / 6 GB also works.
   - This shape is marked **Always Free eligible**.
5. **Image**: Ubuntu **24.04** (or 22.04) — default is fine.
6. **SSH keys**:
   - Select **Generate a key pair for me** → click **Save Private Key** and **Save Public Key**.
   - Keep the private key somewhere safe on your PC — you'll need it to log in.
7. Scroll to **Boot volume** → keep default **Balanced**.
8. Click **Create**.

Wait 1–2 minutes until the instance shows **Running** with a public IP (e.g. `123.123.123.123`).

### Open the game port in Oracle's firewall

- Menu ☰ → **Networking** → **Virtual cloud networks** → your VCN.
- Click your **Subnet** → **Security List** → **Default Security List** → **Add Ingress Rules**.
- Add a rule: **Source CIDR** `0.0.0.0/0`, **IP Protocol** `TCP`, **Destination Port Range** `3000`.

## Part 2 — Log in and copy the code

From your PC's terminal (where the private key is):

```bash
chmod 600 /path/to/your_key.pem
ssh -i /path/to/your_key.pem ubuntu@123.123.123.123
```

On the VM, install the prerequisites:

```bash
sudo apt-get update && sudo apt-get install -y git
```

Copy this project to the VM. From your PC:

```bash
# In the project folder on your PC
rsync -av --exclude node_modules --exclude .env --exclude '*.log' \
  -e "ssh -i /path/to/your_key.pem" ./ ubuntu@123.123.123.123:~/bingo-bot/
```

## Part 3 — Run the setup script

```bash
ssh -i /path/to/your_key.pem ubuntu@123.123.123.123
cd ~/bingo-bot
sudo bash deploy/setup-vm.sh
```

This installs Node.js 20, PostgreSQL, pm2, and cloudflared, and creates the `bingo` DB user.

> If you prefer a stronger DB password, edit `deploy/setup-vm.sh` first (both the `CHANGE_ME_STRONG_PASSWORD` lines).

## Part 4 — Configure the bot

```bash
cp .env.example .env
nano .env
```

Fill in:
- `BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
- `ADMIN_USER_ID` — your Telegram id from [@userinfobot](https://t.me/userinfobot)
- `DATABASE_URL` — already matches the setup script (change if you changed the password)
- `BINGO_APP_URL` — leave the placeholder for now, set it in Part 6
- Telebirr keys — leave empty if not used

Then:

```bash
bash deploy/init-db.sh
```

## Part 5 — Start the bot with pm2 (auto-restart)

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

`pm2 startup` prints a command — copy & run it (it's one line). This makes the bot start automatically on reboot, so your PC never has to be on.

Check logs:

```bash
pm2 logs bingo-bot
```

## Part 6 — Start the tunnel and set the public URL

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a URL like `https://abc123.trycloudflare.com`. Copy it, then:

```bash
nano .env     # set BINGO_APP_URL=https://abc123.trycloudflare.com
pm2 restart bingo-bot
```

> The free `trycloudflare.com` URL changes every time cloudflared restarts.
> To keep a permanent URL, run `cloudflared tunnel login` once and create a named tunnel (instructions in Oracle's docs or Cloudflare's quickstart).

## Verify

- Open the bot in Telegram → **Play Bingo 10** → the lobby + boards should load.
- Reboot the VM once: `sudo reboot`, wait ~1 min, then the bot should be back automatically.

## Updating after code changes

```bash
cd ~/bingo-bot
rsync -av --exclude node_modules --exclude .env -e "ssh -i /path/to/your_key.pem" ./ ubuntu@123.123.123.123:~/bingo-bot/
# on the VM:
cd ~/bingo-bot && npm install && pm2 restart bingo-bot
```

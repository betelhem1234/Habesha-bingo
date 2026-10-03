#!/usr/bin/env bash
# Play With Me — one-time DB setup on the VM
# Run from the bot folder as your normal user:
#   bash deploy/init-db.sh
set -e

echo "==> Installing npm dependencies"
npm install

echo "==> Running prisma migrations"
npx prisma db push
npx prisma generate

echo "==> DB ready."
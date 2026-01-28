#!/usr/bin/env bash
# Install moltbot from cgnl/moltbot fork (main branch with custom fixes)

set -e

REPO_DIR="$HOME/clawdbot-source"
PACK_DIR="/tmp/moltbot-pack"

echo "🔧 Installing moltbot from cgnl/moltbot fork..."

# Ensure repo exists and is up to date
if [ ! -d "$REPO_DIR" ]; then
  echo "📦 Cloning cgnl/moltbot..."
  git clone https://github.com/cgnl/moltbot.git "$REPO_DIR"
fi

cd "$REPO_DIR"

echo "🔄 Pulling latest changes from origin/main..."
git fetch origin
git checkout main
git reset --hard origin/main

echo "📦 Installing dependencies..."
pnpm install

echo "🔨 Building..."
pnpm build

echo "📤 Packing..."
mkdir -p "$PACK_DIR"
pnpm pack --pack-destination "$PACK_DIR"

echo "🌍 Installing globally (force overwrite)..."
TARBALL=$(ls -t "$PACK_DIR"/moltbot-*.tgz | head -1)
npm i -g --force "$TARBALL"

echo "✅ Done! Running: moltbot from cgnl/moltbot (main)"
echo ""
echo "🔗 Repository: https://github.com/cgnl/moltbot"
echo "📝 To sync with upstream: cd $REPO_DIR && git fetch upstream && git merge upstream/main && git push origin main"

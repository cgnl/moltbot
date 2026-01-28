# cgnl/moltbot Fork

This is a fork of `moltbot/moltbot` with custom fixes applied.

## Current Fixes

### google-antigravity thinking-block sanitization
**Branch:** `main`  
**Status:** Merged  
**Issue:** The google-antigravity bridge would crash with "thinking.signature required" errors during tool-calls when using extended-thinking mode (e.g., `google-antigravity/claude-opus-4-5-thinking`).

**Fix:** Force thinking-block sanitization for all `google-antigravity` requests, regardless of model-id. This ensures invalid signatures are detected and removed before API submission.

**File:** `src/agents/pi-embedded-helpers/google.ts`

## Installation

### From this fork (recommended for Sander's setup)
```bash
bash ~/clawdbot-source/install-from-fork.sh
```

Or use the alias (already added to `~/.zshrc`):
```bash
moltbot-update
```

### Manual build + install
```bash
cd ~/clawdbot-source
git pull origin main
pnpm install
pnpm build
pnpm pack --pack-destination /tmp/moltbot-pack
npm i -g --force /tmp/moltbot-pack/moltbot-*.tgz
```

## Syncing with Upstream

To pull changes from `moltbot/moltbot` and merge into this fork:

```bash
cd ~/clawdbot-source
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

Then run `moltbot-update` to rebuild and reinstall.

## Repository Structure

- **origin:** `https://github.com/cgnl/moltbot.git` (your fork, with fixes)
- **upstream:** `https://github.com/moltbot/moltbot.git` (official repo)
- **Local path:** `~/clawdbot-source`

## Pull Requests

To contribute fixes back to upstream:

1. Create a feature branch: `git checkout -b fix/my-feature`
2. Make changes and commit
3. Push to fork: `git push origin fix/my-feature`
4. Open PR: `https://github.com/moltbot/moltbot/compare/main...cgnl:fix/my-feature?expand=1`

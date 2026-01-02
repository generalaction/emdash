# How to Test Auto-Updates

## ✅ DRAFT RELEASE METHOD (Private - Recommended)

Draft releases are **completely invisible to the public** - only repo maintainers can see them!

### Step 1: Push Test Version 1 (Old)

```bash
npm version 0.3.43-test.1 --no-git-tag-version
git add .
git commit -m "test: auto-update test.1"
git tag v0.3.43-test.1
git push origin autoupdate v0.3.43-test.1
```

### Step 2: Build as DRAFT Release

1. Go to: **GitHub Actions** → **Release workflow**
2. Click **"Run workflow"** button
3. Configure:
   - Branch: `autoupdate`
   - arch: `arm64` (or `both` for Intel too)
   - dry_run: `false`
   - **draft: `true`** ✅ ← KEY SETTING!
4. Click **"Run workflow"**

Wait ~5-10 minutes for build.

### Step 3: Download DRAFT Release

1. Go to: https://github.com/generalaction/emdash/releases
2. Look for **"v0.3.43-test.1"** with **Draft** badge (you're the only one who sees this!)
3. Download `emdash-arm64.dmg`
4. Install it (drag to Applications)

### Step 4: Create Test Version 2 (New)

```bash
npm version 0.3.43-test.2 --no-git-tag-version
git add .
git commit -m "test: auto-update test.2"
git tag v0.3.43-test.2
git push origin autoupdate v0.3.43-test.2
```

### Step 5: Build DRAFT Release for Test.2

1. **GitHub Actions** → **Release workflow** → **"Run workflow"**
2. Configure:
   - Branch: `autoupdate`
   - draft: `true` ✅
3. Click **"Run workflow"**

Wait ~5-10 minutes.

### Step 6: Test the Auto-Update! 🎉

**Launch the app (test.1):**

1. Wait **10 seconds** after app starts
2. ✅ Toast should appear: **"Update available - v0.3.43-test.2"**
3. ✅ Or go to **Settings → Version** → see **"Download update"** button

**Click "Download update":**
- ✅ Progress shows: "Downloading 45%"
- ✅ When done: "Restart and install" button appears
- ✅ Toast: "Update ready to install"

**Click "Restart and install":**
- ✅ App quits
- ✅ Update installs
- ✅ App relaunches
- ✅ Settings → Version shows **"0.3.43-test.2"**

**SUCCESS!** ✅ Auto-updates work!

---

## Cleanup

Delete the draft releases (they're private anyway, but good to clean up):

```bash
# Delete via CLI
gh release delete v0.3.43-test.1 --yes
gh release delete v0.3.43-test.2 --yes

# Or just click "Delete" button in GitHub releases UI
```

Delete tags:
```bash
git tag -d v0.3.43-test.1 v0.3.43-test.2
git push origin :refs/tags/v0.3.43-test.1
git push origin :refs/tags/v0.3.43-test.2
```

Restore version:
```bash
npm version 0.3.43 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: restore version after testing"
```

---

## Why This Works

✅ **Draft releases are invisible** to everyone except repo maintainers
✅ **electron-updater can still access them** via the GitHub API
✅ **No public releases needed** - completely private testing
✅ **Full OTA flow tested** - exactly as users will experience it
✅ **Easy cleanup** - just delete the draft releases

---

## Troubleshooting

**No toast after 10 seconds?**
- Manually click "Check for updates" in Settings → Version
- Check browser DevTools console for errors

**"Updater unavailable" error?**
- Make sure GitHub Actions finished successfully
- Verify `latest-mac.yml` was uploaded to the release
- Check that release has the DMG file

**Download fails?**
- Check internet connection
- Verify you're logged into GitHub (draft releases need auth)
- Check logs in DevTools console

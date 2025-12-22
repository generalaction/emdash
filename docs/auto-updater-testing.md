# Testing Auto-Updates in Development

This guide explains how to test the auto-update feature in development mode.

## Prerequisites

- macOS (auto-updates are macOS-first)
- Access to publish GitHub releases (or a test repository)
- Developer ID certificate for code signing

## Setup for Dev Testing

### Option 1: Using GitHub Releases (Recommended)

1. **Build a signed DMG with a lower version number**
   ```bash
   # In package.json, temporarily lower the version (e.g., 0.3.42 → 0.3.41)
   npm run build
   npm run package:mac
   ```

2. **Create a test GitHub release**
   ```bash
   # Create a tag and release
   git tag v0.3.41
   git push origin v0.3.41
   gh release create v0.3.41 --title "v0.3.41 (Test)" --notes "Test release for auto-updater"

   # Upload the DMG and metadata files
   gh release upload v0.3.41 release/emdash-*.dmg release/latest-mac.yml release/*.blockmap --clobber
   ```

3. **Restore the actual version in package.json**
   ```bash
   # Change back to 0.3.42 (or higher)
   # Don't commit this change
   ```

4. **Enable dev mode updates**
   ```bash
   export EMDASH_DEV_UPDATES=true
   ```

5. **Run the app**
   ```bash
   npm run dev
   ```

6. **Verify auto-update behavior**
   - Wait 10 seconds after app starts (startup check delay)
   - Check logs for `[autoUpdater] Checking for updates on startup...`
   - You should see a toast notification: "Update available"
   - The update should download automatically (if auto-download is enabled in settings)
   - When download completes, you should see: "Update ready to install"

### Option 2: Using dev-app-update.yml (Advanced)

1. **Create dev-app-update.yml in the project root**
   ```yaml
   provider: github
   owner: generalaction
   repo: emdash
   ```

2. **Enable dev update config**
   ```bash
   export EMDASH_DEV_UPDATES=true
   export EMDASH_DEV_UPDATE_CONFIG=/path/to/dev-app-update.yml
   ```

3. **Follow the same steps as Option 1**

### Option 3: Using Minio (Local Server)

For testing without internet dependency:

1. **Start Minio server**
   ```bash
   docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"
   ```

2. **Configure dev-app-update.yml**
   ```yaml
   provider: generic
   url: http://localhost:9000/updates
   ```

3. **Upload release files to Minio**
   - Upload DMG, latest-mac.yml, and blockmap files
   - Ensure URL structure matches electron-updater expectations

## Testing Scenarios

### 1. Startup Check
- [ ] App checks for updates 10 seconds after startup
- [ ] Toast notification shown when update is available
- [ ] No notification if already on latest version

### 2. Periodic Checks
- [ ] App checks periodically based on settings (default: daily)
- [ ] Can be disabled in Settings → Auto-Updates → "Automatically check for updates"
- [ ] Interval can be changed: hourly, twice daily, daily, weekly

### 3. Auto-Download
- [ ] **When disabled** (default): Toast says "Go to Settings to download"
- [ ] **When enabled**: Toast says "Downloading in the background"
- [ ] Download progress shown in Settings → Version
- [ ] "Update ready" toast shown when download completes

### 4. Manual Download
- [ ] User can click "Download update" button in Settings → Version
- [ ] Progress indicator shown during download
- [ ] "Restart and install" button appears when ready

### 5. Install Flow
- [ ] Clicking "Restart Now" in toast quits and installs update
- [ ] Update installs on next quit if "Restart Now" not clicked
- [ ] App launches with new version after install

### 6. Settings Integration
- [ ] Auto-check toggle works (stops/starts periodic checks)
- [ ] Auto-download toggle works (changes download behavior)
- [ ] Check interval dropdown works (changes periodic check timing)
- [ ] Settings persist across app restarts

### 7. Differential Downloads
- [ ] Check logs for "differential download" or "blockmap" messages
- [ ] Smaller download size for updates (vs. full DMG)
- [ ] Fallback to full download if blockmap missing

### 8. Error Handling
- [ ] Offline: No error shown, silent skip of update check
- [ ] Network error: Retries 3 times with exponential backoff
- [ ] Download error: Fallback to manual download link
- [ ] Invalid update metadata: Error message shown

### 9. Dev Mode Behavior
- [ ] Updates disabled by default in development
- [ ] `EMDASH_DEV_UPDATES=true` enables update checking
- [ ] Manual check still works in dev mode

## Verification Commands

### Check logs
```bash
# Main process logs show auto-updater activity
tail -f ~/Library/Logs/emdash/main.log | grep autoUpdater
```

### Expected log output
```
[autoUpdater] Periodic checks enabled (interval: 24h)
[autoUpdater] Checking for updates on startup...
[autoUpdater] Update available
[autoUpdater] Downloading update...
[autoUpdater] Download progress: 45%
[autoUpdater] Update downloaded
```

### Check for differential download
```bash
# Should see blockmap file being used
grep -i "blockmap\|differential" ~/Library/Logs/emdash/main.log
```

## Common Issues

### Update check fails
- Verify GitHub release exists and is published
- Check internet connectivity
- Ensure `latest-mac.yml` is uploaded to release
- Check logs for specific error message

### Download fails
- Verify DMG is uploaded to GitHub release
- Check file size matches latest-mac.yml
- Ensure blockmap file is present for differential downloads

### Auto-download doesn't work
- Check Settings → Auto-Updates → "Automatically download updates"
- Verify `autoUpdater.autoDownload` is set correctly in logs
- Check network connectivity

### Update doesn't install
- Verify app is code-signed
- Check that update was downloaded (check logs)
- Try manual "Restart and install" button

## Clean Up

After testing, don't forget to:
- Delete test GitHub releases
- Restore correct version in package.json
- Clear any test settings or cached data
- Remove dev-app-update.yml if created

## References

- [electron-updater docs](https://www.electron.build/auto-update.html)
- [Electron auto-updater API](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Testing updates guide](https://www.electron.build/auto-update#testing-in-development)

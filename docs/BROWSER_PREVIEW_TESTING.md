# Browser Preview Testing Guide

## Quick Start

1. **Start the development app:**
   ```bash
   npm run d
   # or if dependencies are already installed:
   npm run dev
   ```
   This will:
   - Install dependencies (if needed)
   - Start the Electron app on port 3000
   - Start Vite dev server for hot reload

2. **The app should open automatically** - you'll see the Electron window

## Testing the Browser Preview Feature

### Prerequisites

You need a workspace/project with a dev server. The browser preview works with Node.js projects that have:
- A `package.json` file
- A dev script (`dev`, `start`, `serve`, or `preview`)
- Common frameworks: Vite, Next.js, Create React App, etc.

### Test Scenario 1: Basic Preview Flow

**Goal:** Verify the browser preview opens without flashing and loads correctly

1. **Open a workspace** in the app (or create a new one)
2. **Click the browser icon** (🌐 Globe icon) in the titlebar
3. **Expected behavior:**
   - ✅ Browser pane slides in from the right (smooth animation, no flashing)
   - ✅ Loading spinner appears with "Loading preview…" message
   - ✅ If dependencies need installing, you'll see "Installing dependencies"
   - ✅ Then "Starting dev server"
   - ✅ Browser view appears when URL is ready (no flashing)
   - ✅ Preview loads the dev server content

**What to check:**
- ❌ **No flashing** - Browser view should appear smoothly, not flicker on/off
- ✅ **Loading states** - Clear indication of what's happening
- ✅ **URL loads** - Preview shows your dev server content

### Test Scenario 2: Fast Server Startup

**Goal:** Verify URL is only emitted when server is actually ready

1. **Use a project with a fast dev server** (e.g., simple Vite app)
2. **Click browser icon**
3. **Expected behavior:**
   - ✅ Spinner shows briefly
   - ✅ URL is emitted only after server is reachable
   - ✅ Browser loads successfully (no ERR_CONNECTION_REFUSED errors)
   - ✅ No race condition where browser tries to load before server is ready

**What to check:**
- ✅ **No connection errors** - Browser should never try to load unreachable URLs
- ✅ **Smooth transition** - From loading to preview without errors

### Test Scenario 3: Slow Server Startup

**Goal:** Verify loading states work correctly for slow servers (e.g., Next.js first build)

1. **Use a project that takes time to start** (e.g., Next.js with first build)
2. **Click browser icon**
3. **Expected behavior:**
   - ✅ Loading spinner shows with appropriate message
   - ✅ Browser view appears when URL is set (even if probe is still running)
   - ✅ Spinner hides when server becomes reachable
   - ✅ No "Loading preview…" blocking the view unnecessarily

**What to check:**
- ✅ **Browser view visible** - Should see browser pane even while probing
- ✅ **Spinner clears** - Hides when server is ready
- ✅ **No double spinner** - Only one spinner at a time

### Test Scenario 4: Error Handling

**Goal:** Verify error states work correctly

1. **Start a dev server manually** on a port (e.g., `npm run dev` on port 5173)
2. **Stop the server** while browser preview is open
3. **Or use an invalid URL** in the address bar
4. **Expected behavior:**
   - ✅ Error state appears: "Preview unavailable - Server at {url} is not reachable"
   - ✅ Retry button is visible
   - ✅ Error shows in production (not just dev mode)

**What to check:**
- ✅ **Error UI visible** - Shows in production builds
- ✅ **Retry works** - Clicking retry reloads the page
- ✅ **Clear error message** - User knows what went wrong

### Test Scenario 5: Workspace Switching

**Goal:** Verify state clears correctly when switching workspaces

1. **Open browser preview** for workspace A
2. **Switch to workspace B**
3. **Expected behavior:**
   - ✅ Browser preview closes or clears URL
   - ✅ No events from workspace A affect workspace B
   - ✅ Opening preview for workspace B works independently

**What to check:**
- ✅ **State isolation** - Workspaces don't interfere with each other
- ✅ **Clean transitions** - No stale URLs or states

### Test Scenario 6: Overlay Interactions

**Goal:** Verify browser hides when overlays appear

1. **Open browser preview**
2. **Open settings modal** or another overlay
3. **Expected behavior:**
   - ✅ Browser view hides when overlay appears
   - ✅ Browser view shows again when overlay closes
   - ✅ No flashing during overlay transitions

**What to check:**
- ✅ **Smooth hide/show** - Debounced, no rapid flashing
- ✅ **Proper z-index** - Overlay appears above browser

### Test Scenario 7: Resize and Drag

**Goal:** Verify pane resizing works smoothly

1. **Open browser preview**
2. **Drag the left edge** to resize the pane
3. **Expected behavior:**
   - ✅ Pane resizes smoothly
   - ✅ Browser view bounds update correctly
   - ✅ No flashing during resize
   - ✅ Resize handle is visible and responsive

**What to check:**
- ✅ **Smooth resizing** - No jank or flashing
- ✅ **Bounds update** - Browser view stays aligned with pane

## Manual Testing Checklist

- [ ] Browser preview opens without flashing
- [ ] Loading spinner shows only when appropriate
- [ ] URL loads correctly when server is ready
- [ ] No duplicate URL navigations
- [ ] Workspace switching clears state correctly
- [ ] Port conflicts handled gracefully
- [ ] Error states shown in production
- [ ] Bounds recalculation doesn't cause flashing
- [ ] Overlay (settings/modal) hides browser correctly
- [ ] Dev server restart updates URL correctly
- [ ] Retry button works on error state
- [ ] Browser view appears even while probing (if URL is set)

## Debugging Tips

### Check Browser Console

1. Open DevTools in the Electron app (View → Toggle Developer Tools)
2. Look for any errors related to:
   - `browserShow`, `browserHide`, `browserLoadURL`
   - `preview:host:event`
   - Network errors

### Check Main Process Logs

The main process logs will show:
- Dev server startup progress
- URL detection and emission
- Port probing results

### Common Issues to Watch For

1. **Flashing** - If you see rapid hide/show, check the visibility effect
2. **Connection errors** - If browser tries to load before server ready, check URL emission timing
3. **Double spinner** - If spinner appears twice, check spinner state management
4. **Stale URLs** - If wrong workspace URL shows, check workspace event filtering

## Testing with Different Frameworks

### Vite Project
```bash
npm create vite@latest test-vite -- --template react
cd test-vite
# Then open in emdash and test browser preview
```

### Next.js Project
```bash
npx create-next-app@latest test-nextjs
cd test-nextjs
# Then open in emdash and test browser preview
```

### Create React App
```bash
npx create-react-app test-cra
cd test-cra
# Then open in emdash and test browser preview
```

## Expected Fixes Verification

After the fixes, you should see:

✅ **No flashing** - Browser view appears smoothly
✅ **Proper loading states** - Clear indication of progress
✅ **URLs only when ready** - No connection errors
✅ **Better error handling** - Error states work in production
✅ **Smooth transitions** - No jank during state changes

If you see any of these issues, the fixes may need adjustment.

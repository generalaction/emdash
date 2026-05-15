//! `PtyId -> Session` map. Drained on app window-close to avoid orphan
//! shells (the Electron app leaves this implicit; we make it explicit).

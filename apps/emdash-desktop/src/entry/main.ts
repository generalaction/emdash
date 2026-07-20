import { app, dialog } from 'electron';

async function start(): Promise<void> {
  try {
    const { main } = await import('@main/bootstrap');
    await main();
  } catch (error) {
    try {
      const { enterSafeMode } = await import('@main/bootstrap/core/recovery');
      await enterSafeMode(error);
    } catch (recoveryError) {
      await app.whenReady();
      dialog.showErrorBox(
        'Something went wrong',
        `Emdash could not start recovery mode.\n\n${
          recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        }`
      );
    }
  }
}

void start();

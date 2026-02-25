let quitConfirmed = false;

export function isQuitConfirmed(): boolean {
  return quitConfirmed;
}

export function setQuitConfirmed(): void {
  quitConfirmed = true;
}

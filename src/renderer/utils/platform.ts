export const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const IS_WINDOWS_PLATFORM =
  typeof navigator !== 'undefined' && /Win/.test(navigator.platform);

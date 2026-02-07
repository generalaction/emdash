export const shouldDisablePlay = ({
  runActionBusy,
  hasProjectPath,
  isRunSelection,
  canStartRun,
}: {
  runActionBusy: boolean;
  hasProjectPath: boolean;
  isRunSelection: boolean;
  canStartRun: boolean;
}): boolean => runActionBusy || !hasProjectPath || (isRunSelection && !canStartRun);

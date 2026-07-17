export function createAutomationsController({ runtime: AutomationRuntime }): Controller {
  return withValidation(
    automationsContract,
    createController(automationsContract, createAutomationsProcedures(runtime, contract)),
    options.validate ?? 'inputs'
  );
}

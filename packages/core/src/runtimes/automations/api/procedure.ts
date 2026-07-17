export function createAutomationsProcedures({runtime: AutomationsRuntime}): {
    deploy: () => {
        runtime.deploy()
    }
    remove: () => {
        runtime.remove()
    }
    startRun: () => {
        runtime.startRun()
    }
    stopRun: () => {
        runtime.stopRun()
    }
    getRuns: () => {
        runtime.getRuns()
    }
    getRunEvents: () => {
        runtime.getRunEvents()
    }
}
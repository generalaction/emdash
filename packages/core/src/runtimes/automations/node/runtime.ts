import { AutomationScheduler } from "./scheduler";

export class AutomationsRuntime {
    private readonly scheduler: AutomationScheduler;
    private readonly store: AutomationStore;

    constructor() {
        this.scheduler = new AutomationScheduler();
    }

    async deploy() => {}

    async remove() => {}

    async startRun() => {}

    async stopRun() => {}

    async getRuns() => {}

    async getRunEvents() => {}

    async dispose() => {}

}
import { createRPCController } from '@shared/lib/ipc/rpc';
import { loopService } from './loop-service';

export const loopsController = createRPCController({
  createLoop: loopService.createLoop.bind(loopService),
  getLoopsForProject: loopService.getLoopsForProject.bind(loopService),
  getLoop: loopService.getLoop.bind(loopService),
  startLoop: loopService.startLoop.bind(loopService),
  pauseLoop: loopService.pauseLoop.bind(loopService),
  resumeLoop: loopService.resumeLoop.bind(loopService),
  cancelLoop: loopService.cancelLoop.bind(loopService),
  retryPhase: loopService.retryPhase.bind(loopService),
  deleteLoop: loopService.deleteLoop.bind(loopService),
});

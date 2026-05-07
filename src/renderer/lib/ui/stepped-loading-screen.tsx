import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

export interface StepDef {
  id: string;
  label: string;
}

export interface SteppedLoadingScreenProps<StepId extends string> {
  steps: Record<StepId, { label: string }>;
  activeStepStatus: 'pending' | 'success' | 'error';
  activeStep: StepId;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SteppedLoadingScreen<StepId extends string>({
  steps,
  activeStep,
  activeStepStatus,
  children,
  actions,
  className,
}: SteppedLoadingScreenProps<StepId>) {
  const label = steps[activeStep].label;

  const renderStatusIcon = () => {
    switch (activeStepStatus) {
      case 'pending':
        return <Loader2 className="size-3.5 animate-spin" />;
      case 'success':
        return <Check className="size-3.5 text-green-500" />;
      case 'error':
        return <AlertCircle className="size-3.5 text-red-500" />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'flex min-w-0 w-full flex-1 flex-col justify-center gap-6 p-8 max-w-2xl mx-auto max-h-full text-foreground-muted',
        className
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-6">
        <div className="flex w-full flex-col border rounded-md">
          <div
            className={cn(
              'flex  gap-2  items-center text-sm overflow-hidden p-3 rounded-md',
              children && 'rounded-b-none'
            )}
          >
            {renderStatusIcon()}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.h2
                key={activeStep}
                className="text-sm font-mono"
                initial={{ y: '60%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '-60%', opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {label}
              </motion.h2>
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {children != null && (
              <motion.div
                key="children"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
                className="w-full"
              >
                {children}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {actions && <div className="flex items-center gap-2 justify-center">{actions}</div>}
      </div>
    </motion.div>
  );
}

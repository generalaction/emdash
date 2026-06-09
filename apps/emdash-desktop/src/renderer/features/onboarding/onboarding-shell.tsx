import { useState } from 'react';
import { cn } from '@renderer/utils/utils';
import { ImportStep } from './import-step';
import { SignInStep } from './sign-in-step';

type OnboardingStep = 'sign-in' | 'import';

const stepConfig: Record<
  OnboardingStep,
  { label: string; component: React.ComponentType<{ onComplete: () => void }> }
> = {
  'sign-in': {
    label: 'Sign in',
    component: SignInStep,
  },
  import: {
    label: 'Import',
    component: ImportStep,
  },
};

function StepHeader({
  label,
  isActive,
  isLast,
}: {
  label: string;
  isActive: boolean;
  isLast: boolean;
}) {
  return (
    <div
      aria-current={isActive ? 'step' : undefined}
      className={cn(
        'text-md border-r px-5 py-3',
        isActive ? 'bg-background-1 text-primary' : 'text-foreground-muted',
        isLast && 'border-r-0'
      )}
    >
      {label}
    </div>
  );
}

export function OnboardingShell({
  steps,
  onComplete,
}: {
  steps: OnboardingStep[];
  onComplete: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStep = steps[activeIndex];
  const StepComponent = stepConfig[activeStep]?.component;

  const handleStepComplete = () => {
    const nextIndex = activeIndex + 1;
    if (nextIndex >= steps.length) {
      onComplete();
    } else {
      setActiveIndex(nextIndex);
    }
  };

  return (
    <div className="mx-auto flex h-full max-h-[70vh] min-h-0 w-full max-w-5xl flex-col items-start justify-center [-webkit-app-region:no-drag]">
      <div className="flex flex-row border border-b-0">
        {steps.map((step, index) => (
          <StepHeader
            key={step}
            label={stepConfig[step].label}
            isLast={index === steps.length - 1}
            isActive={step === activeStep}
          />
        ))}
      </div>
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center border bg-background-1">
        <StepComponent onComplete={handleStepComplete} />
      </div>
    </div>
  );
}

import { useState } from 'react';
import { OnboardingShell } from './onboarding-shell';

type OnboardingStep = 'sign-in' | 'import';

export function Onboarding({
  steps: initialSteps,
  onComplete,
}: {
  steps: OnboardingStep[];
  onComplete: () => void;
}) {
  const [steps] = useState(initialSteps);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <OnboardingShell steps={steps} onComplete={onComplete} />
    </div>
  );
}

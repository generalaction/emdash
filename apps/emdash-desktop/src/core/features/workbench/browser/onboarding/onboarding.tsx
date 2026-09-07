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
    <div className="flex h-full w-full flex-col items-center justify-center [-webkit-app-region:drag]">
      <OnboardingShell steps={steps} onComplete={onComplete} />
    </div>
  );
}

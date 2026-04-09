import { RotateCcw } from 'lucide-react';
import React from 'react';
import { Button } from '../../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';

interface ResetToDefaultButtonProps {
  /** Optional label shown in the tooltip: "Reset to default: <label>" */
  defaultLabel?: string;
  onReset: () => void;
  disabled?: boolean;
}

export const ResetToDefaultButton: React.FC<ResetToDefaultButtonProps> = ({
  defaultLabel,
  onReset,
  disabled,
}) => (
  <TooltipProvider delay={150}>
    <Tooltip>
      <TooltipTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onReset}
          disabled={disabled}
          aria-label="Reset to default"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {defaultLabel !== undefined ? `Reset to default: ${defaultLabel}` : 'Reset to default'}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

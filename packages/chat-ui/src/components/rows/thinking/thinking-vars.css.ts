import { createVariableThemeContract } from '../../../styles/variable-theme-contract.css';

export type ThinkingStyleVars = {
  padY: number;
};

export const thinkingCardVars = createVariableThemeContract<ThinkingStyleVars>({
  padY: null,
});

import { createVariableThemeContract } from '../../styles/variable-theme-contract.css';

export type PlanStyleVars = {
  padX: number;
  padY: number;
  iconBox: number;
  iconGap: number;
  entryGap: number;
  border: number;
};

export const planVars = createVariableThemeContract<PlanStyleVars>({
  padX: null,
  padY: null,
  iconBox: null,
  iconGap: null,
  entryGap: null,
  border: null,
});

import { createVariableThemeContract } from '../../styles/variable-theme-contract.css';

export type DiffStyleVars = {
  headerH: number;
};

export const diffCardVars = createVariableThemeContract<DiffStyleVars>({
  headerH: null,
});

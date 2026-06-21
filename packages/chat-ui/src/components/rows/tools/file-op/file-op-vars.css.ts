import { createVariableThemeContract } from '../../../../styles/variable-theme-contract.css';

export type FileOpStyleVars = {
  padY: number;
};

export const fileOpCardVars = createVariableThemeContract<FileOpStyleVars>({
  padY: null,
});

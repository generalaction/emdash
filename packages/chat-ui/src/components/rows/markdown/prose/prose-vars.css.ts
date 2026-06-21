import { createVariableThemeContract } from '../../../../styles/variable-theme-contract.css';

export type ProseStyleVars = {
  mentionPadX: number;
  mentionPadY: number;
  mentionIconW: number;
  mentionIconGap: number;
  listIndent: number;
  listBulletGap: number;
  blockquoteIndent: number;
};

export const proseVars = createVariableThemeContract<ProseStyleVars>({
  mentionPadX: null,
  mentionPadY: null,
  mentionIconW: null,
  mentionIconGap: null,
  listIndent: null,
  listBulletGap: null,
  blockquoteIndent: null,
});

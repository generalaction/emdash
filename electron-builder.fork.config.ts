import type { Configuration } from 'electron-builder';
import baseConfig from './electron-builder.config';

const config: Configuration = {
  ...baseConfig,
  win: {
    ...baseConfig.win,
    azureSignOptions: null,
  },
};

export default config;

import { createElectronBuilderConfig } from './electron-builder.base';
import {
  APP_ID,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from './src/shared/app-identity';

const config = createElectronBuilderConfig({
  appId: APP_ID,
  artifactPrefix: ARTIFACT_PREFIX,
  productName: PRODUCT_NAME,
  r2BaseUrl: R2_BASE_URL,
  updateChannel: UPDATE_CHANNEL,
  macIcon: 'src/assets/images/emdash/emdash-beta.icns',
  winIcon: 'src/assets/images/emdash/app-icon-beta.png',
});

export default config;

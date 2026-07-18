import { featureModalDefs } from '@core/manifests/browser-contributions';
import { defineModalCatalog } from '@core/primitives/modals/react';

export const modalCatalog = defineModalCatalog(featureModalDefs);

export type ModalCatalog = typeof modalCatalog;

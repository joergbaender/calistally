import { BUILD_ID } from './config';

const root = document.getElementById('app');
if (root) root.textContent = `CalisTally (${BUILD_ID})`;

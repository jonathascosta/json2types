import { versionLabel } from './version';

const status = document.getElementById('status');
if (status) status.textContent = `Coming soon · ${versionLabel(__APP_VERSION__)}`;

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { PortalClient } from './portal/client.js';

const config = loadConfig();
const portalClient = new PortalClient({
  baseUrl: config.PORTAL_BASE_URL,
  email: config.PORTAL_EMAIL,
  password: config.PORTAL_PASSWORD,
  timeoutMs: config.PORTAL_TIMEOUT_MS,
});

const app = createApp({ portalClient });
app.listen(config.PORT, () => {
  console.log(`Urja Meter API listening on http://localhost:${config.PORT}`);
});

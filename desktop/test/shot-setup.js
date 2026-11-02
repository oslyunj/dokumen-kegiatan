const { _electron: electron } = require('playwright-core'); const path = require('path');
(async () => { const app = await electron.launch({ args: [path.join(__dirname, '..'), '--no-sandbox'], env: { ...process.env, DK_USER_DATA: path.join(__dirname, 'out', 'ud-fresh'), DK_GOOGLE_BASE: 'http://127.0.0.1:47123' } });
  const p = await app.firstWindow(); await p.waitForSelector('#pick'); await p.waitForTimeout(500); await p.screenshot({ path: path.join(__dirname, 'out', 'setup.png') }); await app.close(); })();

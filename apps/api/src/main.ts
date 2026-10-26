// The HTTP entrypoint (spec 9.4).
import 'reflect-metadata';
import { createApp } from './app';
import { loadConfig } from './config';
import { startErrorReports } from './platform/error-reports';

const config = loadConfig();
startErrorReports(config, 'api');
const app = await createApp(config);
await app.listen(config.PORT, config.HOST);

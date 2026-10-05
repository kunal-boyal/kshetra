// The HTTP entrypoint (spec 9.4).
import 'reflect-metadata';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.PORT, config.HOST);

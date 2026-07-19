import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp(config);

app.listen({ port: config.port, host: config.host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

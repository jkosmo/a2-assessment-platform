import { env } from "./config/env.js";
import { app } from "./app.js";

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`a2-assessment-platform listening on port ${env.PORT}`);
});


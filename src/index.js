import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors.js";
import { errorMiddleware, notFoundMiddleware } from "./middleware/errors.js";
import { apiRoutes } from "./routes/api.js";

const app = new Hono();

app.use("*", corsMiddleware);
app.route("/", apiRoutes);
app.notFound(notFoundMiddleware);
app.onError(errorMiddleware);

export default app;

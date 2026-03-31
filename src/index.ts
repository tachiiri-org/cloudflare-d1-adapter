import { Hono } from 'hono';
import type { Env } from './env';
import { databasesRoutes } from './routes/v4/databases';
import { internalOperationsRouteDefinition } from './routes/internal/operations';

const app = new Hono<Env>();

app.onError((err, c) => {
  console.error('unhandled error', err);
  return c.json({ error: 'internal_server_error' }, 500);
});

app.get('/health', () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

const registerRoute = (method: string, path: string, handler: any) => {
  const normalized = method.toLowerCase();
  switch (normalized) {
    case 'get':
      app.get(path, handler);
      break;
    case 'post':
      app.post(path, handler);
      break;
    case 'put':
      app.put(path, handler);
      break;
    case 'patch':
      app.patch(path, handler);
      break;
    case 'delete':
      app.delete(path, handler);
      break;
    default:
      throw new Error(`Unsupported method ${method}`);
  }
};

databasesRoutes.forEach(({ route, handler }) => {
  registerRoute(route.method, route.getRoutingPath(), handler);
});

const { route: internalRoute, handler: internalHandler } = internalOperationsRouteDefinition;
registerRoute(internalRoute.method, internalRoute.getRoutingPath(), internalHandler);

export default app;

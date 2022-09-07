import { Router } from "itty-router";

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  METADATA: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  STORAGE: R2Bucket;
}

const router = Router();

const basic404 = () => new Response('Route not found', { status: 404 });
const basic200 = () => new Response('Paperframe backend is running');

router.get('/api', basic200);

router.get('/api/now', (request, env, context) => {
  return new Response('See sample', {
    status: 302,
    headers: {
      'Location': '/api/image/sample',
    },
  })
});

router.get('/api/image/:id', async (request, env, context) => {
  if (request.params?.id == 'sample') {
    // @TODO: the Env interface typings aren't getting picked up here...
    const sample = await env.STORAGE.get('sample.jpg');

    if (sample?.body) {
      return new Response(sample.body, {
        headers: {
          'content-type': 'image/jpeg',
        },
      });
    }
  }
});

router.all('*', basic404);

export default {
  fetch: router.handle,
};

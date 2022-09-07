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

router.post('/api/new', async (request, env: Env, context) => {
  const data = request.formData ? await request.formData() : false;

  if (data) {
    const title = data.get('title') || 'Untitled';
    const file = data.get('image');

    console.log(title, file.name);

    // @TODO: Need to figure out how to create a unique filename / ID
    // and maybe a single document rather than one per upload?
    const record = {
      title,
      id: file.name,
      filename: Date.now() + file.name,
    };

    // @TODO: So this works, but uhhhh error handling??
    const storage = await env.STORAGE.put(record.filename, file.stream());

    // @TODO: And don't do this part unless the R2 save completed...
    await env.METADATA.put(record.filename, JSON.stringify(record));

    // @TODO: Yeah. Sure. It must have worked.
    return new Response('Image uploaded', { status: 201 });
  }
});

router.get('/api/image/:id', async (request, env: Env, context) => {
  if (request.params?.id == 'sample') {
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

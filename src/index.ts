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

interface imageMeta {
  title: string,
  filename: string,
  order: number,
  deleted?: boolean
}

type imageCarousel = imageMeta[];

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
    const file = data.get('image');
    const title = data.get('title') || file.name || 'Untitled';
    const filename = `upload-${Date.now()}.${file.name.replace(/.+\./,'')}`;

    const carousel: imageCarousel = await env.METADATA.get('carousel')
    .then((data) => data ? JSON.parse(data) : []);

    const meta: imageMeta = {
      title,
      filename,
      order: carousel.length, // @TODO: So if the carousel is an array, we don't need this...?
    };

    carousel.push(meta);


    const success = await env.STORAGE.put(filename, file.stream())
    .then(async (stored) => {
      console.log('file uploaded');
      return await env.METADATA.put('carousel', JSON.stringify(carousel))
    })
    .then(async (data) => {
      // @TODO: I am not sure if this is a good way to know that both operations
      // succeeded or not...
      return true;
    })
    .catch((error) => {
      console.log(JSON.stringify(error));
    });

    if (success === true) {
      return new Response('Image uploaded', { status: 201 });
    }

    return new Response('Unknown error', { status: 500 });
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

import { Router } from "itty-router";

interface paperframeEnv {
  METADATA: KVNamespace;
  STORAGE: R2Bucket;
}

interface imageMeta {
  id: number,
  title: string,
  filename: string,
  order: number,
}

type imageCarousel = imageMeta[];

interface paperframeContext {
  carousel: imageCarousel,
  current: number,
  autoinc: number,
}

const router = Router();

const basic404 = () => new Response('Route not found', { status: 404 });
const basic200 = () => new Response('Paperframe backend is running');

router.get('/api', basic200);

router.all('*', async (request, env: paperframeEnv, context: any) => {
  // Get our index of all images.
  context.carousel = await env.METADATA.get('carousel')
  .then((data) => data ? JSON.parse(data) : []);

  // Get the current (@TODO: Order or ID?) that should be on display right now.
  context.current = await env.METADATA.get('current')
  .then((data) => data ? parseInt(data) : 0);

  // For setting numeric IDs on images, a simple auto_increment counter. We
  // increment here when the value is read, and will _save_ it if we change it.
  context.autoinc = await env.METADATA.get('autoinc')
  .then((data) => data ? parseInt(data) + 1 : 0);
});

router.get('/api/now', (request, env: paperframeEnv, context: paperframeContext) => {
  // Figure out what image should be currently displayed
  const image = context.carousel[context.current % context.carousel.length];

  // Redirect to it. (@TODO: Should we be nice and send it directly?)
  return new Response('See current frame', {
    status: 302,
    headers: {
      'Location': `/api/image/${image.id}`,
    },
  });
});

router.post('/api/new', async (request, env: paperframeEnv, context: paperframeContext) => {
  const data = request.formData ? await request.formData() : false;

  if (data) {
    const file = data.get('image');
    const title = data.get('title') || file.name || 'Untitled';
    const filename = `upload-${Date.now()}.${file.name.replace(/.+\./,'')}`;

    const meta: imageMeta = {
      id: context.autoinc,
      title,
      filename,
      order: context.carousel.length, // @TODO: So if the carousel is an array, we don't need this...?
    };

    context.carousel.push(meta);


    const success = await env.STORAGE.put(filename, file.stream())
    .then(async (stored) => {
      console.log('file uploaded');
      return await Promise.all([
        env.METADATA.put('carousel', JSON.stringify(context.carousel)),
        env.METADATA.put('autoinc', context.autoinc.toString()),
      ]);
    })
    .then(async (data) => {
      // @TODO: I am not sure if this is a good way to know that both operations
      // succeeded or not...
      return true;
    })
    .catch((error) => {
      console.log(JSON.stringify(error));
      return false;
    });

    if (success) {
      return new Response('Image uploaded', { status: 201 });
    }

    return new Response('Unknown error', { status: 500 });
  }
});

router.get('/api/image/:id', async (request, env: paperframeEnv, context: paperframeContext) => {
  const image = context.carousel.find((i) => i.id.toString() === request.params?.id);
  const file = (image) ? await env.STORAGE.get(image.filename) : null;

  if (file?.body) {
    return new Response(file.body, {
      headers: {
        'content-type': 'image/jpeg',
      },
    });
  }
});

router.get('/api/bulk', async (request, env: paperframeEnv, context: paperframeContext) => {
  return new Response(JSON.stringify(context.carousel), {
    headers: {
      'content-type': 'application/json',
    }
  });
});

router.all('*', basic404);

export default {
  fetch: router.handle,
};

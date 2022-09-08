import { Router } from 'itty-router';

interface pfEnv {
  METADATA: KVNamespace;
  STORAGE: R2Bucket;
}

interface imageMeta {
  id: number;
  title: string;
  filename: string;
  order: number;
}

type imageCarousel = imageMeta[];

interface pfCtx {
  carousel: imageCarousel;
  current: number;
  autoinc: number;
}

const router = Router();

const basic404 = () => new Response('Route not found', { status: 404 });
const basic200 = () => new Response('Paperframe backend is running');

router.get('/api', basic200);

router.all('*', async (request, env: pfEnv, context: any) => {
  // Get our index of all images.
  context.carousel = await env.METADATA.get('carousel').then((data) =>
    data ? JSON.parse(data) : []
  );

  // Get the current (@TODO: Order or ID?) that should be on display right now.
  context.current = await env.METADATA.get('current').then((data) =>
    data ? parseInt(data) : 0
  );

  // For setting numeric IDs on images, a simple auto_increment counter. We
  // increment here when the value is read, and will _save_ it if we change it.
  context.autoinc = await env.METADATA.get('autoinc').then((data) =>
    data ? parseInt(data) + 1 : 0
  );
});

router.get('/api/now', (request, env: pfEnv, context: pfCtx) => {
  // Figure out what image should be currently displayed
  const image = context.carousel[context.current % context.carousel.length];

  // Redirect to it. (@TODO: Should we be nice and send it directly?)
  return new Response('See current frame', {
    status: 302,
    headers: {
      Location: `/api/image/${image.id}`,
    },
  });
});

router.post('/api/image', async (request, env: pfEnv, context: pfCtx) => {
  const data = request.formData ? await request.formData() : false;

  if (!data) {
    return new Response('Empty submission', { status: 400 });
  }

  const file = data.get('image');
  const title = data.get('title') || file.name || 'Untitled';
  const filename = `upload-${Date.now()}.${file.name.replace(/.+\./, '')}`;

  if (!file) {
    return new Response('Could not process upload', { status: 400 });
  }

  const meta: imageMeta = {
    id: context.autoinc,
    title,
    filename,
    order: context.carousel.length, // @TODO: So if the carousel is an array, we don't need this...?
  };

  context.carousel.push(meta);

  const success = await env.STORAGE.put(filename, file.stream())
    .then(async () => {
      return await Promise.all([
        env.METADATA.put('carousel', JSON.stringify(context.carousel)),
        env.METADATA.put('autoinc', context.autoinc.toString()),
      ]);
    })
    .then(async () => {
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
});

router.get('/api/image/:id', async (request, env: pfEnv, context: pfCtx) => {
  const image = context.carousel.find((i) => i.id.toString() === request.params?.id);
  const file = image ? await env.STORAGE.get(image.filename) : null;

  if (file?.body) {
    return new Response(file.body, {
      headers: {
        'content-type': 'image/jpeg',
      },
    });
  }
});

router.delete('/api/image/:id', async (request, env: pfEnv, context: pfCtx) => {
  const index = context.carousel.findIndex((i) => i.id.toString() === request.params?.id);
  const image = context.carousel[index];

  if (!image || index < 0) {
    return;
  }

  // Drop the frame from the carousel
  context.carousel.splice(index, 1);

  // Delete from storage
  const success = await env.STORAGE.delete(image.filename)
    .then(async () => {
      return await env.METADATA.put('carousel', JSON.stringify(context.carousel));
    })
    .then(async () => {
      return true;
    })
    .catch((error) => {
      console.log(JSON.stringify(error));
      return false;
    });

  if (success) {
    return new Response(null, { status: 204 });
  }

  return new Response('Unknown error', { status: 500 });
});

router.get('/api/carousel', async (request, env: pfEnv, context: pfCtx) => {
  return new Response(JSON.stringify(context.carousel), {
    headers: {
      'content-type': 'application/json',
    },
  });
});

router.post('/api/carousel', async (request, env: pfEnv, context: pfCtx) => {
  // @TODO: This seems like a typing error that request.json() may not exist...
  const order = request.json ? await request.json() : [];

  if (!Array.isArray(order) || !order.length) {
    return new Response('Bad request: new order must be an array of IDs', {
      status: 400,
    });
  }

  order.forEach((id, newIndex) => {
    const currentIndex = context.carousel.findIndex((i) => i.id === parseInt(id));

    // @TODO: This is only gonna work reliably if every ID is specified exactly
    // once in the new order. But at least there won't be potential loss/dupes.
    if (currentIndex > -1) {
      context.carousel[currentIndex].order = newIndex;
    }
  });

  // Because the new indexes are from the array position, not manually spec'd,
  // we know images[].order will be unique.
  context.carousel.sort((a, b) => (a.order < b.order ? -1 : 1));

  const success = await env.METADATA.put('carousel', JSON.stringify(context.carousel))
    .then(() => {
      return true;
    })
    .catch((error) => {
      console.log(JSON.stringify(error));
      return false;
    });

  if (success) {
    return new Response('Order updated', { status: 200 });
  }

  return new Response('Unknown error', { status: 500 });
});

router.all('*', basic404);

export default {
  fetch: router.handle,

  scheduled: (event, env: pfEnv, ctx) => {
    ctx.waitUntil(async () => {
      // @TODO: DRY... this is repeated from the context fetch above

      // Get our index of all images.
      const carousel = await env.METADATA.get('carousel').then((data) =>
        data ? JSON.parse(data) : []
      );

      // Get the current (@TODO: Order or ID?) that should be on display right now.
      const current = await env.METADATA.get('current').then((data) =>
        data ? parseInt(data) : 0
      );

      const next = (current + 1) % carousel.length;
      return await env.METADATA.put('current', next.toString());
    });
  },
};

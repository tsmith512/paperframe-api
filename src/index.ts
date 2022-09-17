import { Router } from 'itty-router';
import { authCheck, requireAdmin } from './lib/Auth';

export interface pfEnv {
  METADATA: KVNamespace;
  STORAGE: R2Bucket;
  API_ADMIN_USER: string;
  API_ADMIN_PASS: string;
}

export interface pfCtx {
  carousel: imageCarousel;
  current: number;
  autoinc: number;
  authorized: boolean;
}

export interface imageMeta {
  id: number;
  title: string;
  filename: string;
}

export type imageCarousel = imageMeta[];

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'WWW-Authenticate': 'Basic realm="Paperframe API"',
};


const router = Router();

const basic404 = () => new Response('Route not found', { status: 404 });
const basic200 = () => new Response('Paperframe backend is running', {
  status: 200,
  headers: corsHeaders,
});
const basicCors = () => new Response(null, {
  status: 204,
  headers: corsHeaders,
});


router.get('/api', basic200);

router.all('*', async (request, env: pfEnv, context: any) => {
  // Get our index of all images.
  context.carousel = await env.METADATA.get('carousel').then((data) =>
    data ? JSON.parse(data) : []
  );

  // Get the current index that should be on display right now.
  context.current = await env.METADATA.get('current').then((data) =>
    data ? parseInt(data) : 0
  );

  // For setting numeric IDs on images, a simple auto_increment counter. We
  // increment here when the value is read, and will _save_ it if we change it.
  context.autoinc = await env.METADATA.get('autoinc').then((data) =>
    data ? parseInt(data) + 1 : 0
  );

  context.authorized = authCheck(request, env);
});

router.get('/api/auth/login', requireAdmin, (request, env: pfEnv, context: pfCtx) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      ...corsHeaders,
    },
  });
});

router.get('/api/auth/check', (request, env: pfEnv, context: pfCtx) => {
  return new Response(null, {
    status: (context.authorized) ? 204 : 400,
    headers: corsHeaders,
  });
});

router.get('/api/now/:type', (request, env: pfEnv, context: pfCtx) => {
  // Figure out what image should be currently displayed
  const image = context.carousel[context.current % context.carousel.length];

  // If only the ID was requested
  if (image && request.params?.type === 'id') {
    return new Response(JSON.stringify(image.id), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders,
      }
    });
  } else if (image && request.params?.type === 'image') {
    // Otherwise redirect to it. @TODO: Now that it's explicitly a request
    // for the current image, and there's an endpoint for ID, just return it??
    return new Response('See current frame', {
      status: 302,
      headers: {
        Location: `/api/image/${image.id}`,
        ...corsHeaders,
      },
    });
  }

  // :type is required; pass to 404 otherwise.
});

router.post('/api/image', requireAdmin, async (request, env: pfEnv, context: pfCtx) => {
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
    return new Response('Image uploaded', {
      status: 201,
      headers: corsHeaders,
    });
  }

  return new Response('Unknown error', {
    status: 500,
    headers: corsHeaders,
   });
});

router.get('/api/image/:id', async (request, env: pfEnv, context: pfCtx) => {
  const image = context.carousel.find((i) => i.id.toString() === request.params?.id);
  const file = image ? await env.STORAGE.get(image.filename) : null;

  // Should be JPG or GIF only, although that is not currently enforced on upload.
  const ext = image?.filename.split('.').pop();

  if (file?.body) {
    return new Response(file.body, {
      headers: {
        'content-type': `image/${ext}`,
        ...corsHeaders
      },
    });
  }
});

router.delete('/api/image/:id', requireAdmin, async (request, env: pfEnv, context: pfCtx) => {
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
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  return new Response('Unknown error', { status: 500 });
});

router.get('/api/carousel', async (request, env: pfEnv, context: pfCtx) => {
  return new Response(JSON.stringify(context.carousel), {
    headers: {
      'content-type': 'application/json',
      ...corsHeaders,
    },
  });
});

/*
@TODO TAKING THIS ENDPOINT OUT WHILE DUMPING ORDER AS AN IMAGE PROP
router.post('/api/carousel', requireAdmin, async (request, env: pfEnv, context: pfCtx) => {
  // @TODO: This seems like a typing error that request.json() may not exist...
  const order = request.json ? await request.json() : [];

  if (!Array.isArray(order) || !order.length) {
    return new Response('Bad request: new order must be an array of IDs', {
      status: 400,
      headers: corsHeaders,
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
    return new Response('Order updated', {
      status: 200,
      headers: corsHeaders,
    });
  }

  return new Response('Unknown error', {
    status: 500,
    headers: corsHeaders,
  });
});
*/

router.options('*', basicCors);
router.all('*', basic404);

export default {
  fetch: router.handle,

  scheduled: async (event: ScheduledController, env: pfEnv, ctx: ExecutionContext) => {
    // @TODO: DRY... this is repeated from the context fetch above

    // Get our index of all images.
    const carousel = await env.METADATA.get('carousel').then((data) =>
      data ? JSON.parse(data) : []
    );

    // Get the current frame that should be on display right now.
    const current = await env.METADATA.get('current').then((data) =>
      data ? parseInt(data) : 0
    );

    // Increment it
    const next = (current + 1) % carousel.length;

    // Save it
    await env.METADATA.put('current', next.toString());
  },
};

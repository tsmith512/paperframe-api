import { Router } from 'itty-router';
import { authCheck, requireAdmin } from './lib/Auth';

/**
 * Environment variables and bindings to R2 Storage and Workers KV (datastore)
 */
export interface pfEnv {
  METADATA: KVNamespace;
  STORAGE: R2Bucket;
  API_ADMIN_USER: string;
  API_ADMIN_PASS: string;
}

/**
 * Application "context" passed to all route handlers
 */
export interface pfCtx {
  carousel: imageCarousel;
  current: number;
  autoinc: number;
  authorized: boolean;
}

/**
 * A single photo in the carousel
 */
export interface imageMeta {
  id: number;
  title: string;
  filename: string;
}

/**
 * The carousel is just an array of photos
 */
export type imageCarousel = imageMeta[];

/**
 * These headers are sent back on every response
 */
export const globalheaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'WWW-Authenticate': 'Basic realm="Paperframe API"',
};

const router = Router();

//          _
//  ___ ___| |_ _  _ _ __
// (_-</ -_)  _| || | '_ \
// /__/\___|\__|\_,_| .__/
//                 |_|

const basic404 = () => new Response('Route not found', { status: 404 });
const basic200 = () => new Response('Paperframe backend is running', {
  status: 200,
  headers: globalheaders,
});
const basicCors = () => new Response(null, {
  status: 204,
  headers: globalheaders,
});

router.get('/api', basic200);
router.options('*', basicCors);

/**
 * For all routes, load up the carousel, current frame, the next ID to save, and
 * whether or not this request came with admin credentials. Save to conext.
 */
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

//            _   _
//  __ _ _  _| |_| |_
// / _` | || |  _| ' \
// \__,_|\_,_|\__|_||_|

/**
 * Trigger a Basic HTTP Authentication login with the requireAdmin middleware
 * then redirect to the home page for a full reload. Call from the frontend as
 * a link, not an API call.
 */
router.get('/api/auth/login', requireAdmin, (request, env: pfEnv, context: pfCtx) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      ...globalheaders,
    },
  });
});

/**
 * Trigger the browser to purge the Basic HTTP Authentication credentials by
 * returning a 401 status code without a WWW-Authentication challenge header.
 * Call from the frontend as a link, not an API call. Will redirect to home
 * client-side.
 */
router.get('/api/auth/logout', (request, env: pfEnv, context: pfCtx) => {
  const response = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta http-equiv="refresh" content="0;URL='/'" />
    <title>Log Out | Paperframe</title>
  </head>
  <body>
    Logging Out. <a href="/">Return home</a>.
  </body>
</html>
  `;

  return new Response(response, {
    status: 401,
    headers: {
      ...globalheaders,
      'Content-Type': 'text/html',
      'WWW-Authenticate': '',
    },
  });
});

/**
 * Use on the frontend to check if the session is authenticated with HTTP Basic
 * Auth. If the browser included admin creds, a 204 is returned, 400 otherwise,
 * which does not trigger a login.
 */
router.get('/api/auth/check', (request, env: pfEnv, context: pfCtx) => {
  return new Response(null, {
    status: (context.authorized) ? 204 : 400,
    headers: globalheaders,
  });
});

//                          _      __
//  __ _  _ _ _ _ _ ___ _ _| |_   / _|_ _ __ _ _ __  ___
// / _| || | '_| '_/ -_) ' \  _| |  _| '_/ _` | '  \/ -_)
// \__|\_,_|_| |_| \___|_||_\__| |_| |_| \__,_|_|_|_\___|

/**
 * GET the current frame by ID or a redirect to the image itself
 */
router.get('/api/now/:type', (request, env: pfEnv, context: pfCtx) => {
  // Figure out what image should be currently displayed
  const image = context.carousel[context.current % context.carousel.length];

  if (image && request.params?.type === 'id') {
    return new Response(JSON.stringify(image.id), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...globalheaders,
      }
    });
  } else if (image && request.params?.type === 'image') {
    return new Response('See current frame', {
      status: 302,
      headers: {
        Location: `/api/image/${image.id}`,
        ...globalheaders,
      },
    });
  }

  // 404 if the image wasn't available for :type was not `id` or `image`
});

/**
 * POST an image ID to set it as the current active frame. Admin credentials required.
 */
router.post('/api/now', requireAdmin, async (request, env: pfEnv, context: pfCtx) => {
  // @TODO: This seems like a typing error that request.json() may not exist...
  const id = request.json ? await request.json() : null;

  if (Number.isInteger(id)) {
    const index = context.carousel.findIndex((image) => image.id === id);

    if (index > -1) {
      await env.METADATA.put('current', index.toString());

      return new Response(null, {
        status: 204,
        headers: globalheaders,
      });
    }
  }

  return new Response('Bad request: ID not found or not an integer', {
    status: 400,
    headers: globalheaders,
  });
});

//  _
// (_)_ __  __ _ __ _ ___ ___
// | | '  \/ _` / _` / -_|_-<
// |_|_|_|_\__,_\__, \___/__/
//              |___/

/**
 * POST an image to upload. A file is "image" is required, and a title as "title"
 * is recommended. Post as formData. Admin credentials required.
 */
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
      headers: globalheaders,
    });
  }

  return new Response('Unknown error', {
    status: 500,
    headers: globalheaders,
   });
});

/**
 * GET an image download by ID. Returns the image file directly from R2.
 */
router.get('/api/image/:id', async (request, env: pfEnv, context: pfCtx) => {
  const image = context.carousel.find((i) => i.id.toString() === request.params?.id);
  const file = image ? await env.STORAGE.get(image.filename) : null;

  // Should be JPG or GIF only, although that is not currently enforced on upload.
  const ext = image?.filename.split('.').pop();

  if (file?.body) {
    return new Response(file.body, {
      headers: {
        'content-type': `image/${ext}`,
        ...globalheaders
      },
    });
  }
});

/**
 * DELETE an image by ID. Removes from carousel data and R2 storage. Admin
 * credentials required.
 */
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
      headers: globalheaders,
    });
  }

  return new Response('Unknown error', { status: 500 });
});

//                               _
//  __ __ _ _ _ ___ _  _ ___ ___| |
// / _/ _` | '_/ _ \ || (_-</ -_) |
// \__\__,_|_| \___/\_,_/__/\___|_|

/**
 * GET the entire carousel. Provides an array of imageMeta objects in order.
 */
router.get('/api/carousel', async (request, env: pfEnv, context: pfCtx) => {
  return new Response(JSON.stringify(context.carousel), {
    headers: {
      'content-type': 'application/json',
      ...globalheaders,
    },
  });
});


/**
 * POST an updated order of the carousel by sending an array of IDs.
 */
router.post('/api/carousel', requireAdmin, async (request, env: pfEnv, context: pfCtx) => {
  // @TODO: This seems like a typing error that request.json() may not exist...
  const order = request.json ? await request.json() : [];

  // Make sure the provided payload was a non-empty array
  if (!Array.isArray(order) || !order.length) {
    return new Response('Bad request: new order must be an array of IDs', {
      status: 400,
      headers: globalheaders,
    });
  }

  // The new array should not contain duplicates
  if (order.length !== [...new Set(order)].length) {
    return new Response('Bad request: new order contained duplicates', {
      status: 400,
      headers: globalheaders,
    });
  }

  // The new array should be the same length as the current one
  if (order.length !== context.carousel.length) {
    return new Response('Bad request: new order is a different length', {
      status: 400,
      headers: globalheaders,
    });
  }

  // Step through the array of IDs and populate a new array with the imageMeta[]
  // objects to create a new carousel.
  const newCarousel = order.reduce((c, id) => {
    const currentIndex = context.carousel.findIndex((i) => i.id === parseInt(id));

    if (currentIndex > -1) {
      c.push(context.carousel[currentIndex]);
    }

    return c;
  }, [] as imageMeta[]);

  // Sanity check: does the new size match the old one?
  if (newCarousel.length !== context.carousel.length) {
    return new Response('Error: new carousel had different length than original', {
      status: 500,
      headers: globalheaders,
    });
  }

  // Save and return
  const success = await env.METADATA.put('carousel', JSON.stringify(newCarousel))
    .then(() => {
      return true;
    })
    .catch((error) => {
      console.log(JSON.stringify(error));
      return false;
    });

  if (success) {
    return new Response(null, {
      status: 204,
      headers: globalheaders,
    });
  }

  return new Response('Unknown error', {
    status: 500,
    headers: globalheaders,
  });
});

// Fallback: any request not already caught is a 404.
router.all('*', basic404);

//  _      _ _
// (_)_ _ (_) |_
// | | ' \| |  _|
// |_|_||_|_|\__|

export default {
  // Inbound requests pass as-is to the router.
  fetch: router.handle,

  // The scheduled job moves the current pointer to the next frame in the carousel.
  scheduled: async (event: ScheduledController, env: pfEnv, ctx: ExecutionContext) => {
    // Get our index of all images.
    const carousel = await env.METADATA.get('carousel').then((data) =>
      data ? JSON.parse(data) : []
    );

    // Get the current frame that should be on display right now.
    const current = await env.METADATA.get('current').then((data) =>
      data ? parseInt(data) : 0
    );

    // Increment and save
    const next = (current + 1) % carousel.length;
    await env.METADATA.put('current', next.toString());
  },
};

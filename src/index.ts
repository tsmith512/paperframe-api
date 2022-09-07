import { Router } from "itty-router";

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
}

const router = Router();

const basic404 = () => new Response('Route not found', { status: 404 });
const basic200 = () => new Response('Paperframe backend is running');

router.get('/api', basic200);

router.get('/api/now', (request, env, context) => {
	return new Response('Current image');
});

router.get('/api/image/:id', (request, env, context) => {
	return new Response(`Returning image ${request.params?.id}`);
});

router.all('*', basic404);

export default {
	fetch: router.handle,
};

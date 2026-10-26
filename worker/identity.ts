import { createRemoteJWKSet, jwtVerify } from 'jose';

type AccessCtx = ExecutionContext & {
	access?: { getIdentity(): Promise<{ email?: string } | null> };
};

// Module scope so the fetched signing keys are reused across requests in an isolate.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * The GM's email when Access let this request through, or null.
 *
 * `ctx.access` is the `access.dev` stub under `vite dev`; in production it was absent on
 * the old table Worker, so the Access JWT is verified here. Both `iss` and `aud` are
 * pinned: without them any Cloudflare Access organisation in the world would be a valid
 * signer. An unset `POLICY_AUD` refuses everyone.
 */
export async function identify(request: Request, env: Env, ctx: ExecutionContext) {
	const local = await (ctx as AccessCtx).access?.getIdentity();
	if (local?.email) return local.email;

	const token =
		request.headers.get('Cf-Access-Jwt-Assertion') ??
		/(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') ?? '')?.[1];
	if (!token || !env.POLICY_AUD) return null;

	jwks ??= createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
	try {
		const { payload } = await jwtVerify(token, jwks, {
			issuer: env.TEAM_DOMAIN,
			audience: env.POLICY_AUD
		});
		return typeof payload.email === 'string' ? payload.email : null;
	} catch {
		return null;
	}
}

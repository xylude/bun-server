import type {
	BunServer,
	HandlerFunc,
	ErrorHandler,
	RequestHandler,
	ResponseHandler,
	ValidMethods,
	CookieOptions,
} from './server-types';
import { BunServerError } from './index';

export type TestRequestOptions = {
	method?: ValidMethods;
	body?: any;
	query?: Record<string, string>;
	headers?: Record<string, string>;
	cookies?: Record<string, string>;
};

export type TestResponse = {
	status: number;
	headers: Record<string, string>;
	cookies: Record<string, string>;
	body: any;
};

function validateMethod(method: string): method is ValidMethods {
	return [
		'GET',
		'POST',
		'PUT',
		'PATCH',
		'DELETE',
		'OPTIONS',
		'HEAD',
		'CONNECT',
		'TRACE',
	].includes(method);
}

export function createTestServer<ProvidedState extends object>({
	state = () => {
		return {} as ProvidedState;
	},
	debug = false,
	globalHeaders = {},
}: {
	state?: () => ProvidedState;
	globalHeaders?: Record<string, any>;
	debug?: boolean;
} = {}): BunServer<ProvidedState> & {
	call: (path: string, options?: TestRequestOptions) => Promise<TestResponse>;
} {
	const registeredMethods: Record<
		ValidMethods,
		Record<string, HandlerFunc<ProvidedState>>
	> = {
		GET: {},
		POST: {},
		PUT: {},
		PATCH: {},
		DELETE: {},
		OPTIONS: {},
		HEAD: {},
		CONNECT: {},
		TRACE: {},
	};

	let _errorHandler: ErrorHandler | null = null;
	const _preRequestHandlers: Array<
		(
			req: RequestHandler<ProvidedState>
		) => boolean | Response | Promise<boolean | Response>
	> = [];

	function logLine(...args: any[]) {
		if (debug) {
			console.log('[TEST-DEBUG]', ...args);
		}
	}

	function getMatchingPathKey(method: string, path: string): string | null {
		if (!validateMethod(method)) {
			logLine('invalid method', method);
			return null;
		}

		// options validates on it's own
		if (method === 'OPTIONS') {
			return path;
		}

		// Exact match
		if (registeredMethods[method][path]) return path;
		logLine('no exact matched path found', path);

		// Parameterized match (e.g., /foo/:id)
		const keys = Object.keys(registeredMethods[method]).filter((k) =>
			k.split('/').some((el) => el.startsWith(':'))
		);

		const parts = path.split('/').filter((p) => p);
		logLine('key search', keys, parts);

		for (const key of keys) {
			const keyParts = key.split('/').filter((p) => p);
			if (keyParts.length !== parts.length) continue;

			if (keyParts.every((kp, idx) => kp.startsWith(':') || kp === parts[idx])) {
				return key;
			}
		}

		// Wildcard support (e.g., /foo/* should match /foo/bar/baz)
		const wildcardKeys = Object.keys(registeredMethods[method]).filter((k) =>
			k.endsWith('/*')
		);
		for (const wildcardKey of wildcardKeys) {
			if (path.startsWith(wildcardKey.replace('/*', ''))) {
				return wildcardKey;
			}
		}

		return null;
	}

	function getParamsFromPath(
		pathKey: string,
		path: string
	): Record<string, string> {
		const pathParts = path.split('/').filter(Boolean);
		const keyParts = pathKey.split('/').filter(Boolean);

		const params: Record<string, string> = {};

		for (let i = 0; i < keyParts.length; i++) {
			const keyPart = keyParts[i]!;
			if (keyPart.startsWith(':')) {
				const paramName = keyPart.slice(1);
				params[paramName] = pathParts[i] ?? '';
			}
		}

		return params;
	}

	function parseCookieHeader(cookieHeader: string): Record<string, string> {
		return cookieHeader
			.split(';')
			.map((v) => v.trim())
			.reduce(
				(acc, cookie) => {
					const [key, ...valueParts] = cookie.split('=');
					if (!key) return acc;
					acc[key] = decodeURIComponent(valueParts.join('=') || '');
					return acc;
				},
				{} as Record<string, string>
			);
	}

	function parseSetCookieHeader(setCookieHeader: string): {
		name: string;
		value: string;
	} {
		const [cookiePair] = setCookieHeader.split(';');
		const [name, ...valueParts] = cookiePair?.split('=') || [];
		return {
			name: name || '',
			value: decodeURIComponent(valueParts.join('=') || ''),
		};
	}

	async function call(
		path: string,
		options: TestRequestOptions = {}
	): Promise<TestResponse> {
		const {
			method = 'GET',
			body,
			query = {},
			headers = {},
			cookies = {},
		} = options;

		try {
			// Build URL with query params
			const url = new URL(`http://test-server${path}`);
			Object.entries(query).forEach(([key, value]) => {
				url.searchParams.set(key, value);
			});

			// Build headers
			const requestHeaders = new Headers(headers);

			// Add cookies to headers
			if (Object.keys(cookies).length > 0) {
				const cookieHeader = Object.entries(cookies)
					.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
					.join('; ');
				requestHeaders.set('Cookie', cookieHeader);
			}

			// Handle body
			let bodyContent: BodyInit | undefined;
			if (body !== undefined) {
				if (typeof body === 'object' && !requestHeaders.has('Content-Type')) {
					requestHeaders.set('Content-Type', 'application/json');
					bodyContent = JSON.stringify(body);
				} else if (typeof body === 'string') {
					bodyContent = body;
				} else {
					bodyContent = body;
				}
			}

			// Create mock Request
			const request = new Request(url.toString(), {
				method,
				headers: requestHeaders,
				body: bodyContent,
			});

			logLine('Test Request:', method, path, query);

			if (!validateMethod(method)) {
				throw new BunServerError('Method not allowed', 405);
			}

			const pathKey = getMatchingPathKey(method, path);
			if (!pathKey) {
				throw new BunServerError('Not found', 404);
			}
			logLine('pathKey matched', pathKey);

			// Dynamically handle OPTIONS requests
			if (method === 'OPTIONS' && !registeredMethods.OPTIONS[pathKey]) {
				const allowedMethods: string[] = [];

				for (const [m, routeMap] of Object.entries(registeredMethods)) {
					if (routeMap[pathKey]) {
						allowedMethods.push(m);
					}
				}

				if (allowedMethods.length === 0) {
					throw new BunServerError('Not found', 404);
				}

				const response = new Response(null, {
					status: 204,
				});

				response.headers.set('Allow', allowedMethods.join(', '));
				Object.keys(globalHeaders).forEach((header) => {
					response.headers.set(header, globalHeaders[header]);
				});

				return convertResponseToTestResponse(response);
			}

			// Parse cookies from request
			const cookieHeader = request.headers.get('cookie') || '';
			const parsedCookies = parseCookieHeader(cookieHeader);

			// Initialize request handler
			const req: RequestHandler<ProvidedState> = {
				request,
				__raw: {
					query,
					body: {},
					path: getParamsFromPath(pathKey, path),
				},
				headers: request.headers,
				pathname: path,
				state: state(),
				cookies: parsedCookies,
				getBody: <T>(validator?: (body: Record<string, any>) => T): T => {
					if (validator) {
						return validator(req.__raw.body);
					}
					return req.__raw.body as T;
				},
				getQuery: <T>(
					validator?: (query: Record<string, string | string[]>) => T
				): T => {
					if (validator) {
						return validator(req.__raw.query);
					}
					return req.__raw.query as T;
				},
				getParams: <T>(validator?: (params: Record<string, string>) => T): T => {
					if (validator) {
						return validator(req.__raw.path);
					}
					return req.__raw.path as T;
				},
			};

			// Run pre-request handlers
			if (_preRequestHandlers.length > 0) {
				for (const guard of _preRequestHandlers) {
					const result = await guard(req);

					if (result instanceof Response) {
						return convertResponseToTestResponse(result);
					}

					if (result === false) {
						throw new BunServerError(
							`Bad Request: onRequest failed to validate "${request.url}"`,
							400
						);
					}
				}
			}

			if (registeredMethods[method][pathKey]) {
				// Parse request body for methods that typically include one
				if (['POST', 'PUT', 'PATCH'].includes(method)) {
					const contentType = request.headers.get('Content-Type') || '';
					const contentLength = request.headers.get('Content-Length');

					let parsedBody = {};

					if (contentLength === '0') {
						parsedBody = {};
					} else if (contentType.includes('application/json')) {
						try {
							const maybeJSON = await request.json();
							if (maybeJSON && typeof maybeJSON === 'object') {
								parsedBody = maybeJSON;
							} else {
								throw new BunServerError('Bad Request: Invalid JSON format', 400);
							}
						} catch (e) {
							throw new BunServerError('Bad Request: Malformed JSON', 400);
						}
					} else if (contentType.includes('application/x-www-form-urlencoded')) {
						const formData = new URLSearchParams(await request.text());
						parsedBody = Object.fromEntries(formData.entries());
					} else if (contentType.includes('multipart/form-data')) {
						const formData = await request.formData();
						const formDataObj: Record<string, any> = {};
						for (const [key, value] of formData.entries()) {
							formDataObj[key] = value;
						}
						parsedBody = formDataObj;
					} else if (
						contentType.includes('application/octet-stream') ||
						contentType.includes('image/') ||
						contentType.includes('video/') ||
						contentType.includes('audio/')
					) {
						parsedBody = {
							binary: await request.arrayBuffer(),
							contentType,
						};
					} else if (contentType) {
						parsedBody = { text: await request.text() };
					}

					req.__raw.body = parsedBody;
				}

				const res = (): ResponseHandler => {
					const headers: Record<string, string> = {};
					let sent = false;
					let status = 200;
					const cookieHeaders: string[] = [];

					return {
						setStatus: (statusCode: number) => {
							status = statusCode;
						},
						setCookie: (
							name: string,
							value: string,
							options?: CookieOptions
						) => {
							let cookie = `${name}=${encodeURIComponent(value)}`;

							if (options) {
								if (options.path) cookie += `; Path=${options.path}`;
								if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
								if (options.expires)
									cookie += `; Expires=${options.expires.toUTCString()}`;
								if (options.httpOnly) cookie += `; HttpOnly`;
								if (options.secure) cookie += `; Secure`;
								if (options.sameSite)
									cookie += `; SameSite=${options.sameSite}`;
								if (options.domain) cookie += `; Domain=${options.domain}`;
							}

							cookieHeaders.push(cookie);
						},
						deleteCookie: (
							name: string,
							options?: Pick<CookieOptions, 'domain' | 'path'>
						) => {
							let cookie = `${name}=; Max-Age=0`;

							if (options) {
								if (options.path) cookie += `; Path=${options.path}`;
								if (options.domain) cookie += `; Domain=${options.domain}`;
							}

							cookieHeaders.push(cookie);
						},
						setHeader: (key: string, value: string) => {
							if (!sent) {
								headers[key] = value;
							} else {
								console.warn('Headers already sent');
							}
						},
						redirect: (location: string, statusCode: number = 302) => {
							sent = true;
							const mergedHeaders = new Headers({
								Location: location,
								...globalHeaders,
								...headers,
							});

							cookieHeaders.forEach((cookie) => {
								mergedHeaders.append('Set-Cookie', cookie);
							});

							return new Response(null, {
								status: statusCode,
								headers: mergedHeaders,
							});
						},
						send: (data: any) => {
							sent = true;

							let bodyData: BodyInit;
							const mergedHeaders = new Headers({
								...globalHeaders,
								...headers,
							});

							cookieHeaders.forEach((cookie) => {
								mergedHeaders.append('Set-Cookie', cookie);
							});

							if (
								data instanceof ArrayBuffer ||
								data instanceof Blob ||
								data instanceof ReadableStream
							) {
								bodyData = data;
							} else if (typeof data === 'string') {
								bodyData = data;
								if (!mergedHeaders.has('Content-Type')) {
									mergedHeaders.set('Content-Type', 'text/html');
								}
							} else if (typeof data === 'object') {
								bodyData = JSON.stringify(data);
								if (!mergedHeaders.has('Content-Type')) {
									mergedHeaders.set('Content-Type', 'application/json');
								}
							} else {
								bodyData = data;
								if (!mergedHeaders.has('Content-Type')) {
									mergedHeaders.set('Content-Type', 'application/octet-stream');
								}
							}

							return new Response(bodyData, {
								status,
								headers: mergedHeaders,
							});
						},
					};
				};

				const response = await registeredMethods[method][pathKey](req, res());
				return convertResponseToTestResponse(response);
			} else {
				throw new BunServerError('Not found', 404);
			}
		} catch (e: any) {
			if (_errorHandler) {
				logLine('Sending error to registered handler', e);
				const errorResponse = _errorHandler({
					error: e,
					method,
					path,
					headers: new Headers(headers),
					status: e.status || 500,
				});
				return convertResponseToTestResponse(errorResponse);
			} else {
				logLine('No handler registered, throwing generic error.');
				return convertResponseToTestResponse(
					new Response('Internal server error', { status: 500 })
				);
			}
		}
	}

	async function convertResponseToTestResponse(
		response: Response
	): Promise<TestResponse> {
		// Parse headers
		const headers: Record<string, string> = {};
		const cookies: Record<string, string> = {};

		response.headers.forEach((value, key) => {
			if (key.toLowerCase() === 'set-cookie') {
				// Handle Set-Cookie specially (can have multiple)
				const parsed = parseSetCookieHeader(value);
				cookies[parsed.name] = parsed.value;
			} else {
				headers[key] = value;
			}
		});

		// Parse body based on content type
		let body: any;
		const contentType = response.headers.get('Content-Type') || '';

		if (contentType.includes('application/json')) {
			try {
				body = await response.json();
			} catch {
				body = await response.text();
			}
		} else if (
			contentType.includes('text/') ||
			contentType.includes('application/x-www-form-urlencoded')
		) {
			body = await response.text();
		} else if (response.body) {
			// Binary or unknown - convert to ArrayBuffer
			body = await response.arrayBuffer();
		} else {
			body = null;
		}

		return {
			status: response.status,
			headers,
			cookies,
			body,
		};
	}

	const publicAPI: BunServer<ProvidedState> = {
		get: function (path: string, handler: HandlerFunc<ProvidedState>) {
			logLine('adding get handler for ', `"${path}"`);
			registeredMethods.GET[path] = handler;
		},
		post: function (path: string, handler: HandlerFunc<ProvidedState>) {
			logLine('adding post handler for ', `"${path}"`);
			registeredMethods.POST[path] = handler;
		},
		put: function (path: string, handler: HandlerFunc<ProvidedState>) {
			logLine('adding put handler for ', `"${path}"`);
			registeredMethods.PUT[path] = handler;
		},
		delete: function (path: string, handler: HandlerFunc<ProvidedState>) {
			logLine('adding delete handler for ', `"${path}"`);
			registeredMethods.DELETE[path] = handler;
		},
		patch: function (path: string, handler: HandlerFunc<ProvidedState>) {
			logLine('adding patch handler for ', `"${path}"`);
			registeredMethods.PATCH[path] = handler;
		},
		options: function (path: string, handler: HandlerFunc<ProvidedState>) {
			logLine('adding options handler for ', `"${path}"`);
			registeredMethods.OPTIONS[path] = handler;
		},
		onError: function (errorHandler: ErrorHandler) {
			logLine('adding error handler');
			_errorHandler = errorHandler;
		},
		addPublicDirectory: function (dir: string) {
			logLine('addPublicDirectory called but is a no-op in test server');
			// No-op for test server
		},
		addPreRequestHandler: function (
			handler: (
				req: RequestHandler<ProvidedState>
			) => boolean | Response | Promise<boolean | Response>
		) {
			logLine('adding prerequest handler');
			_preRequestHandlers.push(handler);
		},
		start: () => {
			logLine('start() called but is a no-op in test server');
			// No-op for test server - return a mock Server object
			return {} as any;
		},
	};

	return {
		...publicAPI,
		call,
	};
}

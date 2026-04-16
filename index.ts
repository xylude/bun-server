import { type BodyInit, type ServerWebSocket } from 'bun';
import path from 'path';
import type {
	ErrorHandler,
	BunServer,
	HandlerFunc,
	RequestHandler,
	ValidMethods,
	WebSocketConfig,
	ResponseHandler,
	ModifiedServerWebSocket,
	CookieOptions,
	PublicDirectoryOptions,
	MCPConfig,
	TLSConfig,
} from './server-types';
import { createMcpHttpHandler, runMcpStdio } from './mcp';
import { WAF_COMMON_RULES, matchesWafRule } from './waf';

export type * from './server-types';
export { createTestServer } from './bun-test-server';
export type { TestRequestOptions, TestResponse } from './bun-test-server';
export { MCP_PROTOCOL_VERSION } from './mcp';
export { WAF_COMMON_RULES } from './waf';
export type { WafRule } from './waf';

/*
GET: Retrieve data from a server.
POST: Submit data to a server to create a new resource.
PUT: Update an existing resource on the server.
DELETE: Delete a resource on the server.
PATCH: Update a resource partially.
HEAD: Retrieve only the headers for a resource.
OPTIONS: Get information about the communication options available.
CONNECT: Establish a tunnel to the server via a proxy.
TRACE: Echoes the received request, helpful for debugging.
*/

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

export class BunServerError extends Error {
	public params: Record<string, string> = {};
	constructor(
		message: string,
		public status: number,
		params?: Record<string, string>
	) {
		super(message);
		if (params) {
			this.params = params;
		}
	}
}

// Security: Default patterns to block from being served
const DEFAULT_BLOCKED_PATTERNS = [
	'.env',
	'.env.local',
	'.env.production',
	'.env.development',
	'.git/',
	'.gitignore',
	'.npmrc',
	'.DS_Store',
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'bun.lockb',
];

// Security: Default secure headers for static files
const SECURE_DEFAULT_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'X-XSS-Protection': '1; mode=block',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	// HSTS: browsers ignore this on non-HTTPS origins, safe to send in all envs
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
	// COOP: isolates browsing context without breaking OAuth popup flows
	'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
	'Content-Security-Policy': [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"font-src 'self' data:",
		"img-src 'self' data: blob:",
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join('; '),
};

/**
 * Normalizes and validates a file path to prevent directory traversal attacks
 * @param requestedPath - The path from the HTTP request
 * @param publicDir - The absolute path to the public directory
 * @returns The safe absolute path or null if invalid
 */
function getSafePath(requestedPath: string, publicDir: string): string | null {
	try {
		// Normalize the public directory path
		const normalizedPublicDir = path.resolve(publicDir);

		// Normalize and resolve the requested path against the public directory
		const normalizedPath = path.resolve(normalizedPublicDir, `.${requestedPath}`);

		// Security check: Ensure the resolved path is within the public directory
		if (!normalizedPath.startsWith(normalizedPublicDir)) {
			console.warn(`[SECURITY] Path traversal attempt blocked: ${requestedPath}`);
			return null;
		}

		return normalizedPath;
	} catch (e) {
		console.error(`[SECURITY] Error validating path: ${requestedPath}`, e);
		return null;
	}
}

/**
 * Checks if a file path matches any blocked patterns
 */
function isFileBlocked(filePath: string, blockedPatterns: string[]): boolean {
	const normalizedPath = filePath.toLowerCase();
	return blockedPatterns.some(pattern => {
		const normalizedPattern = pattern.toLowerCase();
		// Check if pattern is in the path
		return normalizedPath.includes(normalizedPattern);
	});
}

/**
 * Gets the appropriate Content-Type header based on file extension
 */
function getContentType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const contentTypes: Record<string, string> = {
		'.html': 'text/html; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.js': 'application/javascript; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.svg': 'image/svg+xml',
		'.ico': 'image/x-icon',
		'.webp': 'image/webp',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
		'.ttf': 'font/ttf',
		'.eot': 'application/vnd.ms-fontobject',
		'.pdf': 'application/pdf',
		'.txt': 'text/plain; charset=utf-8',
		'.xml': 'application/xml; charset=utf-8',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.zip': 'application/zip',
	};

	return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Warns about security header overrides
 */
function warnSecurityOverride(headerName: string, publicDir: string): void {
	console.warn(
		`[SECURITY WARNING] Overriding secure default header "${headerName}" for public directory: ${publicDir}\n` +
		`This may reduce security. Ensure you understand the implications.`
	);
}

// todo CORS SUPPORT
export function createServer<ProvidedState extends object>({
	port,
	webSocket,
	mcp,
	tls,
	state = () => {
		return {} as ProvidedState;
	},
	debug = false,
	globalHeaders = {},
	idleTimeout,
	enableWaf = false,
	wafOverrides,
}: {
	port: number;
	webSocket?: WebSocketConfig;
	mcp?: MCPConfig;
	tls?: TLSConfig;
	state?: () => ProvidedState;
	globalHeaders?: Record<string, any>;
	debug?: boolean;
	idleTimeout?: number;
	/**
	 * Enable the built-in WAF (Web Application Firewall).
	 * When true, requests matching known scanner/exploit paths are rejected with 404
	 * before hitting any route logic. Uses WAF_COMMON_RULES by default.
	 * @experimental
	 */
	enableWaf?: boolean;
	/**
	 * Replace the default WAF ruleset entirely. Useful when you want to extend or
	 * trim the common rules:
	 * @example
	 * wafOverrides: [...WAF_COMMON_RULES, { pattern: '/secret', description: 'custom' }]
	 * @experimental
	 */
	wafOverrides?: import('./server-types').WafRule[];
}): BunServer<ProvidedState> {
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

	const PUBLIC_DIRECTORIES: Array<{
		dir: string;
		options: PublicDirectoryOptions;
	}> = [];

	const CATCHALL_DIRECTORIES: Array<{
		dir: string;
		options: PublicDirectoryOptions;
	}> = [];

	function logLine(...args: any[]) {
		if (debug) {
			console.log('[DEBUG]', ...args);
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

	/**
	 * Attempts to serve a file from the provided public directories
	 * @returns Response if file found and served, null otherwise
	 */
	async function tryServePublicFile(
		path: string,
		directories: typeof PUBLIC_DIRECTORIES
	): Promise<Response | null> {
		for (const publicDir of directories) {
			const requestedPath = path === '/' ? '/index.html' : path;

			// Security: Validate and normalize the path
			const safePath = getSafePath(requestedPath, publicDir.dir);
			if (!safePath) {
				// Path traversal attempt - skip to next directory
				continue;
			}

			// Security: Check if file is blocked
			if (!publicDir.options.allowAllFiles) {
				if (isFileBlocked(safePath, publicDir.options.blockPatterns || [])) {
					logLine('Blocked file access attempt:', safePath);
					continue;
				}
			}

			const file = Bun.file(safePath);
			logLine('Attempting to serve file:', safePath);

			if (await file.exists()) {
				// Build headers with secure defaults + custom headers
				const headers = new Headers({
					...SECURE_DEFAULT_HEADERS,
					...globalHeaders,
					...publicDir.options.headers,
				});

				// Set Content-Type based on file extension
				const contentType = getContentType(safePath);
				headers.set('Content-Type', contentType);

				return new Response(file, { headers });
			}

			// SPA mode: if file not found and spaMode is enabled, serve index.html
			if (publicDir.options.spaMode) {
				const indexPath = getSafePath('/index.html', publicDir.dir);
				if (indexPath) {
					const indexFile = Bun.file(indexPath);
					if (await indexFile.exists()) {
						logLine('SPA mode: serving index.html for', path);
						const headers = new Headers({
							...SECURE_DEFAULT_HEADERS,
							...globalHeaders,
							...publicDir.options.headers,
							'Content-Type': 'text/html; charset=utf-8',
						});

						return new Response(indexFile, { headers });
					}
				}
			}
		}

		return null;
	}

	// Set up MCP HTTP handler if configured for HTTP mode
	const mcpHttpHandler =
		mcp && (mcp.mode === 'http' || mcp.mode === undefined)
			? createMcpHttpHandler(mcp)
			: null;
	const mcpPath = mcp?.path ?? '/mcp';

	let _errorHandler: ErrorHandler | null = null;
	const _preRequestHandlers: Array<
		(
			req: RequestHandler<ProvidedState>
		) => boolean | Response | Promise<boolean | Response>
	> = [];

	// makes it a lil easier from a type perspective to send, as well as adding JSON support.
	function GetModifiedServerWebsocket(
		ws: ServerWebSocket<unknown>
	): ModifiedServerWebSocket<unknown> {
		return {
			...ws,
			// Bun's `data` property is non-enumerable so the spread above doesn't copy it
			data: ws.data,
			send: (data: any) => {
				if (typeof data === 'object') {
					ws.send(JSON.stringify(data));
				} else if (typeof data === 'string') {
					ws.send(data);
				} else if (data instanceof Buffer) {
					const bufferSource = data.buffer.slice(
						data.byteOffset,
						data.byteOffset + data.byteLength
					);
					ws.send(bufferSource);
				}
			},
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
		addPublicDirectory: function (dir: string, options: PublicDirectoryOptions = {}) {
			const absoluteDir = path.resolve(process.cwd(), dir);
			const fallbackMode = options.fallbackMode || 'priority';

			logLine('adding public directory', absoluteDir, 'with mode', fallbackMode);

			// Warn about security overrides
			if (options.headers) {
				for (const headerName of Object.keys(SECURE_DEFAULT_HEADERS)) {
					if (options.headers[headerName]) {
						warnSecurityOverride(headerName, absoluteDir);
					}
				}
			}

			if (options.allowAllFiles) {
				console.warn(
					`[SECURITY WARNING] allowAllFiles enabled for public directory: ${absoluteDir}\n` +
					`This disables protection against serving sensitive files. Use with caution.`
				);
			}

			const publicDirConfig = {
				dir: absoluteDir,
				options: {
					headers: options.headers || {},
					blockPatterns: options.blockPatterns || DEFAULT_BLOCKED_PATTERNS,
					allowAllFiles: options.allowAllFiles || false,
					fallbackMode,
					spaMode: options.spaMode || false,
				},
			};

			if (fallbackMode === 'catchall') {
				CATCHALL_DIRECTORIES.push(publicDirConfig);
			} else {
				PUBLIC_DIRECTORIES.push(publicDirConfig);
			}
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
			if (mcp?.mode === 'stdio') {
				// Run the stdio MCP transport concurrently in Bun's event loop.
				// The HTTP server still starts normally — both coexist.
				runMcpStdio(mcp).catch((e) => {
					console.error('[MCP stdio] fatal error:', e);
					process.exit(1);
				});
			}

			const websocketConfig = {
				message: (ws: any, message: any) => {
					if (webSocket?.onMessage) {
						let obj: string | undefined;
						if (typeof message === 'string') {
							try {
								obj = JSON.parse(message);
							} catch (e) {
								obj = message;
							}
						}
						webSocket?.onMessage(GetModifiedServerWebsocket(ws), obj || message);
					}
				},
				open: async (ws: any) => {
					if (webSocket?.onConnected) {
						webSocket?.onConnected(ws);
					}
				},
				close: (ws: any) => {
					if (webSocket?.onClose) {
						webSocket?.onClose(ws);
					}
				},
			};

			const wafRules = wafOverrides ?? WAF_COMMON_RULES;

			const fetchHandler = async (request: Request, server: any) => {
					try {
						const url = new URL(request.url);
						const path = url.pathname;
						const searchParams = url.searchParams;
						const method = request.method.toUpperCase();

						logLine(
							'Request:',
							`"${url.toString()}"`,
							`"${path}"`,
							`"${searchParams}"`,
							`"${method}"`
						);

						// WAF: reject known scanner/exploit paths before any routing
						if (enableWaf && matchesWafRule(path, wafRules)) {
							logLine('[WAF] blocked:', path);
							return new Response(null, { status: 404 });
						}

						// Handle MCP endpoint before all other routing
						if (mcpHttpHandler && path === mcpPath) {
							if (method === 'POST') return await mcpHttpHandler.handlePost(request);
							if (method === 'GET') return mcpHttpHandler.handleGet(request);
							if (method === 'DELETE') return mcpHttpHandler.handleDelete(request);
							return new Response('Method Not Allowed', { status: 405 });
						}

						// Handle WebSocket upgrades before static file serving and route matching.
						// Must run early — SPA catchall would otherwise intercept the GET and return 200.
						if (webSocket) {
							const wsPath = webSocket.path ?? '/ws';
							if (path === wsPath) {
								if (webSocket.onUpgrade) {
									const upgradeData = webSocket.onUpgrade(request);
									if (!upgradeData) {
										throw new BunServerError(
											'Websocket upgrade error. The onUpgrade function returned false.',
											400
										);
									}
									const success = server.upgrade(request, { data: upgradeData });
									if (!success) {
										throw new BunServerError(
											'Websocket upgrade error. Bun threw while trying to upgrade the connection.',
											400
										);
									}
								} else {
									const success = server.upgrade(request);
									if (!success) {
										throw new BunServerError(
											'Websocket upgrade error. Bun failed to upgrade the connection.',
											400
										);
									}
								}
								return;
							}
						}

						// First try to serve files from priority public directories (for GET requests)
						if (method === 'GET') {
							const priorityResponse = await tryServePublicFile(path, PUBLIC_DIRECTORIES);
							if (priorityResponse) {
								return priorityResponse;
							}
						}

						if (!validateMethod(method)) {
							return new Response('Method not allowed', { status: 405 });
						}

						const pathKey = getMatchingPathKey(method, path);
						if (!pathKey) {
							// No route matched - try catchall public directories for GET requests
							if (method === 'GET' && CATCHALL_DIRECTORIES.length > 0) {
								const catchallResponse = await tryServePublicFile(path, CATCHALL_DIRECTORIES);
								if (catchallResponse) {
									return catchallResponse;
								}
							}

							throw new BunServerError('Not found', 404);
						}
						logLine('pathKey matched', pathKey);

						// Dynamically handle OPTIONS requests and return allowed methods for the path
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
								logLine('set header', header, globalHeaders[header]);
								response.headers.set(header, globalHeaders[header]);
							});

							return response;
						}

						// Initialize query parameters early - handle multiple values for same key
						const query: Record<string, string | string[]> = {};
						searchParams.forEach((value, key) => {
							const existing = query[key];
							if (existing === undefined) {
								// First occurrence - check if there are more
								const allValues = searchParams.getAll(key);
								query[key] = allValues.length > 1 ? allValues : value;
							}
							// If already set, it means we handled all values in first occurrence
						});

						// try and get cookies from the request
						const cookieHeader = request.headers.get('cookie') || '';
						const cookies = cookieHeader
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

						const req: RequestHandler<ProvidedState> = {
							request,
							__raw: {
								query,
								body: {},
								path: getParamsFromPath(pathKey, path),
							},
							headers: request.headers,
							pathname: new URL(request.url).pathname,
							state: state(),
							cookies,
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
						logLine(method, path);

						if (_preRequestHandlers.length > 0) {
							for (const guard of _preRequestHandlers) {
								const result = await guard(req);

								if (result instanceof Response) {
									return result; // <-- if a Response is returned, immediately send it back
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
							try {
								const res = (): ResponseHandler => {
									const headers: Record<string, string> = {};
									let sent = false;
									let status = 200;
									const cookieHeaders: string[] = [];

									return {
										setStatus: (statusCode: number) => {
											status = statusCode;
										},
										setCookie: (name: string, value: string, options?: CookieOptions) => {
											let cookie = `${name}=${encodeURIComponent(value)}`;

											if (options) {
												if (options.path) cookie += `; Path=${options.path}`;
												if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
												if (options.expires)
													cookie += `; Expires=${options.expires.toUTCString()}`;
												if (options.httpOnly) cookie += `; HttpOnly`;
												if (options.secure) cookie += `; Secure`;
												if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
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

											cookieHeaders.forEach(cookie => {
												mergedHeaders.append('Set-Cookie', cookie);
											});

											return new Response(null, {
												status: statusCode,
												headers: mergedHeaders,
											});
										},
										send: (data: any) => {
											sent = true;

											let body: BodyInit;
											const mergedHeaders = new Headers({
												...globalHeaders,
												...headers,
											});

											// Add each cookie as a separate Set-Cookie header
											cookieHeaders.forEach(cookie => {
												mergedHeaders.append('Set-Cookie', cookie);
											});

											// Handle ArrayBuffer and binary data first
											if (data instanceof ArrayBuffer || data instanceof Blob || data instanceof ReadableStream) {
												body = data;
												// Content-Type should already be set by the handler
											} else if (typeof data === 'string') {
												body = data;
												if (!mergedHeaders.has('Content-Type')) {
													mergedHeaders.set('Content-Type', 'text/html'); // default to HTML for strings
												}
											} else if (typeof data === 'object') {
												body = JSON.stringify(data);
												if (!mergedHeaders.has('Content-Type')) {
													mergedHeaders.set('Content-Type', 'application/json');
												}
											} else {
												body = data; // Fallback for any other type
												if (!mergedHeaders.has('Content-Type')) {
													mergedHeaders.set('Content-Type', 'application/octet-stream');
												}
											}

											// @ts-ignore: Todo - fix this
											return new Response(body, {
												status,
												headers: mergedHeaders,
											});
										},
									};
								};

								// Parse request body for methods that typically include one
								if (['POST', 'PUT', 'PATCH'].includes(method)) {
									// Get Content-Type
									const contentType = request.headers.get('Content-Type') || '';

									// Initialize body storage
									let parsedBody = {};

									// Check if request actually has content
									const contentLength = request.headers.get('Content-Length');
									if (contentLength === '0') {
										// Empty body is allowed
										parsedBody = {};
									} else if (contentType.includes('application/json')) {
										// Parse JSON body
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
										// Parse URL-encoded form data
										const formData = new URLSearchParams(await request.text());
										parsedBody = Object.fromEntries(formData.entries());
									} else if (contentType.includes('multipart/form-data')) {
										const formData = await request.formData();
										// Convert FormData to object for consistency
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
										// Handle binary data (raw buffer)
										parsedBody = {
											binary: await request.arrayBuffer(), // Returns an ArrayBuffer
											contentType,
										};
									} else {
										// Default to raw text
										parsedBody = { text: await request.text() };
									}

									// Attach parsed body to request
									req.__raw.body = parsedBody;
								}

								return await registeredMethods[method][pathKey](req, res());
							} catch (e) {
								logLine(`Error while processing route ${method}:${pathKey}`, e);
								throw e;
							}
						} else {
							logLine(404, method, path);
							throw new BunServerError('Not found', 404, {
								url: request.url,
								method: request.method,
							});
						}
					} catch (e: any) {
						if (_errorHandler) {
							logLine('Sending error to registered handler', e);
							return _errorHandler({
								error: e,
								method: request.method,
								path: request.url,
								headers: request.headers,
								status: e.status,
							});
						} else {
							logLine('No handler registered, throwing generic error.');
							return new Response('Internal server error', { status: 500 });
						}
					}
				};

				if (tls) {
					Bun.serve({
						port,
						websocket: websocketConfig,
						fetch: fetchHandler,
						...(idleTimeout !== undefined ? { idleTimeout } : {}),
					});
					return Bun.serve({
						port: tls.httpsPort,
						websocket: websocketConfig,
						fetch: fetchHandler,
						tls: {
							key: Bun.file(tls.keyFile),
							cert: Bun.file(tls.certFile),
							...(tls.caFile ? { ca: Bun.file(tls.caFile) } : {}),
							...(tls.passphrase ? { passphrase: tls.passphrase } : {}),
						},
						...(idleTimeout !== undefined ? { idleTimeout } : {}),
					});
				}

				return Bun.serve({
					port,
					websocket: websocketConfig,
					fetch: fetchHandler,
					...(idleTimeout !== undefined ? { idleTimeout } : {}),
				});
		},
	};

	return {
		...publicAPI,
	};
}

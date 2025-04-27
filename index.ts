import path from "path";

import { type ServerWebSocket } from 'bun';
import {
	ErrorHandler,
	BunServer,
	HandlerFunc,
	RequestHandler,
	ValidMethods,
	WebSocketConfig,
	ResponseHandler,
	ModifiedServerWebSocket,
} from './server-types';

export type * from './server-types';

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

class BunServerError extends Error {
	public params: Record<string, string> = {};
	constructor(message: string, public status: number, params?: Record<string, string>) {
		super(message);
		if (params) {
			this.params = params;
		}
	}
}

// todo CORS SUPPORT
export function createServer({
	port,
	webSocket,
	state = {},
	debug = false,
	globalHeaders = {},
	onRequest,
}: {
	port: number;
	webSocket?: WebSocketConfig;
	state?: Record<string, any>;
	globalHeaders?: Record<string, any>;
	debug?: boolean;
	onRequest?: ((req: RequestHandler) => boolean | Response | Promise<boolean | Response>) | Array<(req: RequestHandler) => boolean | Response | Promise<boolean | Response>>;
}): BunServer {
	const registeredMethods: Record<ValidMethods, Record<string, HandlerFunc>> = {
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

	const PUBLIC_DIRECTORIES: string[] = [];

	function logLine(...args) {
		if (debug) {
			console.log(...args);
		}
	}

	function getMatchingPathKey(method: string, path: string): string | null {
		if (!validateMethod(method)) return null;

		// Exact match
		if (registeredMethods[method][path]) return path;

		// Parameterized match (e.g., /foo/:id)
		const keys = Object.keys(registeredMethods[method]).filter(k =>
			k.split('/').some(el => el.startsWith(':'))
		);

		const parts = path.split('/').filter(p => p);
		for (const key of keys) {
			const keyParts = key.split('/').filter(p => p);
			if (keyParts.length !== parts.length) continue;

			if (keyParts.every((kp, idx) => kp.startsWith(':') || kp === parts[idx])) {
				return key;
			}
		}

		// Wildcard support (e.g., /foo/* should match /foo/bar/baz)
		const wildcardKeys = Object.keys(registeredMethods[method]).filter(k => k.endsWith('/*'));
		for (const wildcardKey of wildcardKeys) {
			if (path.startsWith(wildcardKey.replace('/*', ''))) {
				return wildcardKey;
			}
		}

		return null;
	}


	function getParamsFromPath(pathKey: string, path: string) {
		return pathKey
			.split('/')
			.filter((p) => p)
			.reduce(
				(acc: Record<string, string>, part: string, idx: number) => {
					if (part.startsWith(':')) {
						acc[part.replace('/', '').replace(':', '')] = path
							.split('/')
							.filter((p) => p)[idx];
					}
					return acc;
				},
				{} as Record<string, string>
			);
	}

	let _errorHandler: ErrorHandler | null = null;

	// makes it a lil easier from a type perspective to send, as well as adding JSON support.
	function GetModifiedServerWebsocket(ws: ServerWebSocket<unknown>): ModifiedServerWebSocket<unknown> {
		return {
			...ws,
			send: (data: any) => {
				if (typeof data === 'object') {
					ws.send(JSON.stringify(data));
				} else if (typeof data === 'string') {
					ws.send(data);
				} else if (data instanceof Buffer) {
					const bufferSource = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
					ws.send(bufferSource);
				}
			}
		}
	}

	const publicAPI: BunServer = {
		get: function (path: string, handler: HandlerFunc) {
			registeredMethods.GET[path] = handler;
		},
		post: function (path: string, handler: HandlerFunc) {
			registeredMethods.POST[path] = handler;
		},
		put: function (path: string, handler: HandlerFunc) {
			registeredMethods.PUT[path] = handler;
		},
		delete: function (path: string, handler: HandlerFunc) {
			registeredMethods.DELETE[path] = handler;
		},
		patch: function (path: string, handler: HandlerFunc) {
			registeredMethods.PATCH[path] = handler;
		},
		options: function (path: string, handler: HandlerFunc) {
			registeredMethods.OPTIONS[path] = handler;
		},
		onError: function (errorHandler: ErrorHandler) {
			_errorHandler = errorHandler;
		},
		addPublicDirectory: function (dir: string) {
			PUBLIC_DIRECTORIES.push(`${process.cwd()}/${dir}`);
		},
		start: () => {
			return Bun.serve({
				port,
				websocket: {
					message: (ws, message) => {
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
					open: async (ws) => {
						if (webSocket?.onConnected) {
							webSocket?.onConnected(ws);
						}
					},
					close: (ws) => {
						if (webSocket?.onClose) {
							webSocket?.onClose(ws);
						}
					},
				},
				async fetch(request, server) {
					try {
						const url = new URL(request.url);
						const path = url.pathname;
						const searchParams = url.searchParams;
						const method = request.method;

						//first try to serve file from public folder
						if (method === 'GET') {
							for (const dir of PUBLIC_DIRECTORIES) {
								const filePath = path === '/' ? '/index.html' : path;
								const absolutePath = `${dir}${filePath}`;
								const file = Bun.file(absolutePath);

								logLine('file', [absolutePath]);

								if (await file.exists()) {
									return new Response(file);
								}
							}
						}

						const pathKey = getMatchingPathKey(method, path);
						if (!pathKey) {
							throw new BunServerError('Not found', 404);
						}
						logLine('pathKey', pathKey);

						const req: RequestHandler = {
							request,
							params: {
								query: {},
								body: {},
								path: getParamsFromPath(pathKey, path),
							},
							headers: request.headers,
							pathname: new URL(request.url).pathname,
							state,
						};
						logLine(method, path);

						if (onRequest) {
							const handlers = Array.isArray(onRequest) ? onRequest : [onRequest];
							for (const guard of handlers) {
								const result = await guard(req);

								if (result instanceof Response) {
									return result; // <-- if a Response is returned, immediately send it back
								}

								if (result === false) {
									throw new BunServerError(`Bad Request: onRequest failed to validate "${request.url}"`, 400);
								}
							}
						}

						// handle websockets:
						if (webSocket) {
							if (path === webSocket.path) {
								if (webSocket.onUpgrade) {
									const upgradeData = webSocket.onUpgrade(request);
									if (!upgradeData) {
										throw new BunServerError('Websocket upgrade error. The onUpgrade function returned false.', 400);
									}

									const success = server.upgrade(request, {
										data: upgradeData,
									});
									if (!success) {
										throw new BunServerError('Websocket upgrade error. Bun threw while trying to upgrade the connection.', 400);
									}
								} else {
									const success = server.upgrade(request);
									if (!success) {
										throw new BunServerError('Websocket upgrade error. Bun failed to upgrade the connection.', 400);
									}
								}
								return;
							}
						}

						if (!validateMethod(method)) {
							return new Response('Method not allowed', { status: 405 });
						}

						// we know the path is valid so if it's OPTIONS we can send back the globally set headers at the very least for now
						if (['OPTIONS'].includes(method) && !registeredMethods[method][pathKey]) {
							const response = new Response(null, {
								status: 200,
							});
							Object.keys(globalHeaders).forEach((header) => {
								logLine('set header', header, globalHeaders[header]);
								response.headers.set(header, globalHeaders[header]);
							});
							return response;
						}

						if (registeredMethods[method][pathKey]) {
							try {
								const res = (): ResponseHandler => {
									const headers: Record<string, string> = {};
									let sent = false;
									let status = 200;

									return {
										setStatus: (statusCode: number) => {
											status = statusCode;
										},
										setHeader: (key: string, value: string) => {
											if (!sent) {
												headers[key] = value;
											} else {
												console.warn('Headers already sent');
											}
										},
										send: (data: any) => {
											sent = true;
											const isObj = typeof data !== 'string';
											const response = isObj
												? Response.json(data, {
													status,
												})
												: new Response(data, {
													status,
												});
											const typeHeader = isObj
												? 'application/json'
												: 'text/html';

											response.headers.set('Content-Type', typeHeader);

											Object.keys(globalHeaders).forEach((header) => {
												response.headers.set(header, globalHeaders[header]);
											});

											Object.keys(headers).forEach((header) => {
												response.headers.set(header, headers[header]);
											});

											return response;
										},
									};
								};

								// this is untested af, chatgpt helped write it so we'll see what happens.
								if (['POST', 'PUT', 'PATCH'].includes(method)) {
									try {
										// Get Content-Type
										const contentType = request.headers.get('Content-Type') || '';

										// Initialize body storage
										let parsedBody = {};

										if (contentType.includes('application/json')) {
											// Parse JSON body
											parsedBody = await request.json();
										} else if (contentType.includes('application/x-www-form-urlencoded')) {
											// Parse URL-encoded form data
											const formData = new URLSearchParams(await request.text());
											parsedBody = Object.fromEntries(formData.entries());
										} else if (contentType.includes('multipart/form-data')) {
											// Parse multipart form data
											const formData = await request.formData();
											parsedBody = Object.fromEntries([...formData.entries()]);
										} else if (contentType.includes('application/octet-stream') || contentType.includes('image/') || contentType.includes('video/') || contentType.includes('audio/')) {
											// Handle binary data (raw buffer)
											parsedBody = {
												binary: await request.arrayBuffer(), // Returns an ArrayBuffer
												contentType
											};
										} else {
											// Default to raw text
											parsedBody = { text: await request.text() };
										}

										// Attach parsed body to request
										req.params.body = parsedBody;

										// Call the appropriate method handler
										return await registeredMethods[method][pathKey](req, res());
									} catch (e) {
										// Structured error handling
										logLine(`Error processing ${method} request to ${pathKey}:`, e);

										// Return a structured error response
										return new Response(
											JSON.stringify({
												error: true,
												message: e.message || 'Internal Server Error',
												stack: process.env.NODE_ENV === 'development' ? e.stack : undefined, // Hide stack in production
											}),
											{ status: 500, headers: { 'Content-Type': 'application/json' } }
										);
									}
								}

								// Initialize an empty object to store the query parameters
								const query: Record<string, string> = {};

								// Loop through the searchParams and construct the queryParams object
								searchParams.forEach((value, key) => {
									query[key] = value;
								});

								req.params.query = query;

								if (registeredMethods[method][pathKey] instanceof Promise) {
									return await registeredMethods[method][pathKey](req, res());
								}

								return registeredMethods[method][pathKey](req, res());
							} catch (e) {
								logLine(e);
								return new Response('Internal server error', { status: 500 });
							}
						} else {
							logLine(404, method, path);
							throw new BunServerError('Not found', 404, {
								url: request.url,
								method: request.method,
							});
						}
					} catch (e) {
						if (_errorHandler) {
							return _errorHandler({
								error: e,
								method: request.method,
								path: request.url,
								headers: request.headers,
								status: e.status,
							});
						} else {
							return new Response('Internal server error', { status: 500 });
						}
					}
				},
			});
		},
	};

	return {
		...publicAPI,
	};
}

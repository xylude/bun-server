import {
	ErrorHandler,
	BunServer,
	HandlerFunc,
	RequestHandler,
	ValidMethods,
	WebSocketConfig,
	ResponseHandler,
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

// todo CORS SUPPORT
export function createServer({
	port,
	webSocket,
	state = {},
	debug = false,
	globalHeaders = {},
}: {
	port: number;
	webSocket?: WebSocketConfig;
	state?: Record<string, any>;
	globalHeaders?: Record<string, any>;
	debug?: boolean;
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

	function logLine(...args) {
		if (debug) {
			console.log(...args);
		}
	}

	function getMatchingPathKey(method: string, path: string): string | null {
		if (!validateMethod(method)) {
			return null; //new Response('Method not allowed', { status: 405 })
		}

		// if there is an exact match, then we stop looking here
		if (registeredMethods[method][path]) {
			return path;
		} else {
			// search for param matches
			const keys = Object.keys(registeredMethods[method]).filter((k) => {
				return k.split('/').some((el) => el.startsWith(':'));
			});

			const parts = path.split('/').filter((p) => p);

			for (const key of keys) {
				const keyParts = key.split('/').filter((p) => p);
				if (keyParts.length !== parts.length) {
					continue;
				} else {
					if (
						keyParts.every((kp, idx) => {
							if (kp.startsWith(':')) {
								return true;
							} else {
								return kp === parts[idx];
							}
						})
					) {
						return key;
					}
				}
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
		onError: function (errorHandler: ErrorHandler) {
			_errorHandler = errorHandler;
		},
		start: () => {
			return Bun.serve({
				port,
				websocket: {
					message: (ws, message) => {
						if (webSocket?.onMessage) {
							webSocket?.onMessage(ws, message);
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

						logLine(method, path);

						// handle websockets:
						if (webSocket) {
							if (path === webSocket.path) {
								if (webSocket.onUpgrade) {
									const upgradeData = webSocket.onUpgrade(request);
									if (!upgradeData) {
										throw Object.assign(
											{},
											new Error(
												'Websocket upgrade error. The onUpgrade function threw.'
											),
											{
												status: 400,
											}
										);
									}

									const success = server.upgrade(request, {
										data: upgradeData,
									});
									if (!success) {
										throw Object.assign(
											{},
											new Error(
												'Websocket upgrade error. Bun threw while trying to upgrade the connection.'
											),
											{
												status: 400,
											}
										);
									}
								} else {
									const success = server.upgrade(request);
									if (!success) {
										throw Object.assign(
											{},
											new Error(
												'Websocket upgrade error. Bun threw while trying to upgrade the connection.'
											),
											{
												status: 400,
											}
										);
									}
								}
								return;
							}
						}

						if (!validateMethod(method)) {
							return new Response('Method not allowed', { status: 405 });
						}

						// we know the path is valid so if it's OPTIONS we can send back the globally set headers at the very least for now
						if (['OPTIONS'].includes(method)) {
							const response = new Response(null, {
								status: 200,
							});
							Object.keys(globalHeaders).forEach((header) => {
								logLine('set header', header, globalHeaders[header]);
								response.headers.set(header, globalHeaders[header]);
							});
							return response;
						}

						const pathKey = getMatchingPathKey(method, path);

						logLine('pathKey', pathKey);

						if (!pathKey) {
							throw Object.assign({}, new Error('Not found'), {
								status: 404,
							});
						}

						if (registeredMethods[method][pathKey]) {
							try {
								// this is redundant but I guess somehow it might be possible for the
								// `Request.Headers` type to be something other than Record<string, string>
								const _headers: Record<string, string> = Object.keys(
									request.headers
								).reduce((acc, current) => {
									// normalize to lower case
									acc[current.toLowerCase()] = request.headers[current];
									return acc;
								}, {});

								const req: RequestHandler = {
									request,
									params: {
										query: {},
										body: {},
										path: getParamsFromPath(pathKey, path),
									},
									headers: _headers,
									state,
								};

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

								if (['POST', 'PUT', 'PATCH'].includes(method)) {
									try {
										if (
											request.headers
												.get('Content-Type')
												?.includes('application/json')
										) {
											req.params.body = (await request.json()) || {};
										} else {
											req.params.body = {
												text: request.body,
											};
										}
										return registeredMethods[method][pathKey](req, res());
									} catch (e) {
										// try to handle error better
										logLine(e);
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
							throw Object.assign({}, new Error('Not found'), {
								status: 404,
							});
						}
					} catch (e) {
						if (_errorHandler) {
							return _errorHandler(e);
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

import type { Server, ServerWebSocket } from 'bun';

export type HandlerFunc<StateType> = (
	req: RequestHandler<StateType>,
	res: ResponseHandler
) => Response | Promise<Response>;

export type WebSocketConnectedHandler = (
	ws: ServerWebSocket<any>
) => void | Promise<void> | null;

export interface ModifiedServerWebSocket<T>
	extends Omit<ServerWebSocket<T>, 'send'> {
	send: (message: string | Buffer | Record<string, any>) => void;
}

export type WebSocketMessageHandler = (
	ws: ModifiedServerWebSocket<any>,
	message: string | Buffer | Record<string, any>
) => void | Promise<void> | null;

export type Handler<StateType> = {
	path: string;
	handler: HandlerFunc<StateType>;
};

export type ValidMethods =
	| 'GET'
	| 'POST'
	| 'PUT'
	| 'DELETE'
	| 'PATCH'
	| 'HEAD'
	| 'OPTIONS'
	| 'CONNECT'
	| 'TRACE';

export type WebSocketConfig = {
	onConnected?: WebSocketConnectedHandler;
	onMessage?: WebSocketMessageHandler;
	onClose?: (ws: ServerWebSocket<any>) => void;
	onUpgrade?: (req: Request) => boolean | Record<string, any>;
	path: string;
};

export type RequestHandler<StateType> = {
	request: Request;
	/**
	 * Raw access to parsed request data. Prefer the typed getter methods instead.
	 * @see getBody
	 * @see getQuery
	 * @see getParams
	 */
	__raw: {
		body: Record<string, any>;
		query: Record<string, string | string[]>;
		path: Record<string, string>;
	};
	headers: Headers;
	state: StateType;
	pathname: string;
	cookies: Record<string, string>;
	/**
	 * Returns the parsed request body, optionally validated/transformed.
	 *
	 * Works with any validator function — including Zod schemas:
	 * @example
	 * // Manual validation
	 * const body = req.getBody<{ name: string }>(b => {
	 *   if (typeof b.name !== 'string') throw new Error('name required');
	 *   return b as { name: string };
	 * });
	 *
	 * // Zod
	 * const body = req.getBody(MySchema.parse);
	 *
	 * // Raw (no validation)
	 * const body = req.getBody();
	 */
	getBody: <T = Record<string, any>>(validator?: (body: Record<string, any>) => T) => T;
	/**
	 * Returns parsed query string parameters, optionally validated/transformed.
	 * Multi-value keys (e.g. `?tag=a&tag=b`) are returned as `string[]`.
	 *
	 * @example
	 * // Manual validation
	 * const query = req.getQuery<{ page: string }>(q => {
	 *   if (typeof q.page !== 'string') throw new Error('page required');
	 *   return q as { page: string };
	 * });
	 *
	 * // Zod
	 * const query = req.getQuery(QuerySchema.parse);
	 *
	 * // Raw (no validation)
	 * const query = req.getQuery();
	 */
	getQuery: <T = Record<string, string | string[]>>(validator?: (query: Record<string, string | string[]>) => T) => T;
	/**
	 * Returns parsed URL path parameters, optionally validated/transformed.
	 *
	 * @example
	 * // Manual validation
	 * const { id } = req.getParams<{ id: string }>(p => {
	 *   if (!p.id) throw new Error('id required');
	 *   return p as { id: string };
	 * });
	 *
	 * // Zod
	 * const params = req.getParams(ParamsSchema.parse);
	 *
	 * // Raw (no validation)
	 * const params = req.getParams();
	 */
	getParams: <T = Record<string, string>>(validator?: (params: Record<string, string>) => T) => T;
};

export type ErrorHandler = (err: {
	error: any;
	method: string;
	path: string;
	headers: Headers;
	status: number;
}) => Response;

export type CookieOptions = {
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
	domain?: string;
	path?: string;
	maxAge?: number;
	expires?: Date;
};

export type PublicDirectoryOptions = {
	/**
	 * Custom headers to set on responses for files served from this directory.
	 * Note: Overriding secure defaults will trigger a console warning.
	 */
	headers?: Record<string, string>;
	/**
	 * Block specific file patterns from being served (e.g., ['.env', '.git'])
	 * Default blocks: .env files, .git directory, and other sensitive patterns
	 */
	blockPatterns?: string[];
	/**
	 * Allow overriding the default blocked patterns entirely
	 * WARNING: Only use this if you know what you're doing
	 */
	allowAllFiles?: boolean;
	/**
	 * When to serve files from this directory:
	 * - 'priority': Check public directory before routes (default, best for SPAs)
	 * - 'catchall': Only serve public files if no route matches (best for API servers)
	 */
	fallbackMode?: 'priority' | 'catchall';
	/**
	 * Enable SPA mode: serve index.html for any non-file requests
	 * This is essential for client-side routers (React Router, Wouter, etc.)
	 * When enabled, any request that doesn't match an existing file will serve index.html
	 */
	spaMode?: boolean;
};

export type ResponseHandler = {
	setStatus: (statusCode: number) => void;
	setHeader: (key: string, value: string) => void;
	setCookie: (key: string, value: string, options?: CookieOptions) => void;
	deleteCookie: (
		key: string,
		options?: Pick<CookieOptions, 'domain' | 'path'>
	) => void;
	redirect: (url: string, statusCode?: number) => Response;
	send: (data: any) => Response;
};

// ─── MCP Types ────────────────────────────────────────────────────────────────

export type MCPContentText = { type: 'text'; text: string };
export type MCPContentImage = { type: 'image'; data: string; mimeType: string };
export type MCPContentAudio = { type: 'audio'; data: string; mimeType: string };
export type MCPContentResource = {
	type: 'resource';
	resource: { uri: string; mimeType?: string; text?: string; blob?: string };
};

export type MCPContent =
	| MCPContentText
	| MCPContentImage
	| MCPContentAudio
	| MCPContentResource;

/**
 * What a tool handler may return:
 * - `string` — auto-wrapped as `{ type: 'text', text: ... }`
 * - `MCPContent[]` — array of content items
 * - `{ content, isError? }` — explicit MCP result shape
 */
export type MCPToolResult =
	| string
	| MCPContent[]
	| { content: MCPContent[]; isError?: boolean };

export type MCPToolDefinition = {
	/** Unique tool name exposed to MCP clients. */
	name: string;
	/** Human-readable description shown to LLMs. */
	description: string;
	/** JSON Schema describing the tool's arguments (type must be "object"). */
	inputSchema: {
		type: 'object';
		properties?: Record<string, { type: string; description?: string; [key: string]: any }>;
		required?: string[];
		[key: string]: any;
	};
	/** Called when a client invokes the tool. Throw to signal an error. */
	handler: (args: Record<string, any>) => MCPToolResult | Promise<MCPToolResult>;
};

export type MCPConfig = {
	/**
	 * Transport mode.
	 * - `'http'` (default) — registers POST/GET/DELETE at `path` on the HTTP server.
	 * - `'stdio'` — reads JSON-RPC from stdin and writes to stdout when `start()` is called.
	 *   The HTTP server still starts normally; both transports coexist.
	 */
	mode?: 'http' | 'stdio';
	/**
	 * URL path for the MCP endpoint (HTTP mode only).
	 * @default '/mcp'
	 */
	path?: string;
	/** Tools this server exposes. */
	tools: MCPToolDefinition[];
	/** Identifies this server in the MCP `initialize` handshake. */
	serverInfo?: { name: string; version: string };
};

export type TLSConfig = {
	/** Path to the TLS private key file (PEM format). */
	keyFile: string;
	/** Path to the TLS certificate file (PEM format). */
	certFile: string;
	/** Path to the CA certificate file (PEM format). Optional. */
	caFile?: string;
	/** Passphrase for an encrypted private key. Optional. */
	passphrase?: string;
	/** Port to serve HTTPS on. */
	httpsPort: number;
};

export type BunServer<StateType> = {
	get: (path: string, handler: HandlerFunc<StateType>) => void;
	post: (path: string, handler: HandlerFunc<StateType>) => void;
	put: (path: string, handler: HandlerFunc<StateType>) => void;
	delete: (path: string, handler: HandlerFunc<StateType>) => void;
	patch: (path: string, handler: HandlerFunc<StateType>) => void;
	options: (path: string, handler: HandlerFunc<StateType>) => void;
	onError: (errorHandler: ErrorHandler) => void;
	addPublicDirectory: (dir: string, options?: PublicDirectoryOptions) => void;
	addPreRequestHandler: (
		handler: (
			req: RequestHandler<StateType>
		) => boolean | Response | Promise<boolean | Response>
	) => void;
	start: () => Server<StateType>;
};

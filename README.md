# @xylude/bun-server

A lightweight Express-like HTTP server for [Bun](https://bun.sh/) with WebSocket support, typed request helpers, static file serving, and a built-in test server.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Creating a Server](#creating-a-server)
- [Routing](#routing)
- [Request Object](#request-object)
  - [getBody](#getbody)
  - [getQuery](#getquery)
  - [getParams](#getparams)
  - [Cookies](#cookies)
  - [Headers](#headers)
  - [State](#state)
- [Response Object](#response-object)
  - [send](#send)
  - [setStatus](#setstatus)
  - [setHeader](#setheader)
  - [setCookie / deleteCookie](#setcookie--deletecookie)
  - [redirect](#redirect)
- [Pre-Request Handlers](#pre-request-handlers)
- [Static File Serving](#static-file-serving)
  - [SPA Mode](#spa-mode)
  - [Priority vs Catchall Mode](#priority-vs-catchall-mode)
  - [Security](#security)
- [WebSockets](#websockets)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
  - [HTTP Mode](#http-mode)
  - [Stdio Mode](#stdio-mode)
  - [Tool Handlers](#tool-handlers)
  - [MCP Spec Version](#mcp-spec-version)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [TypeScript](#typescript)

---

## Installation

```sh
bun add @xylude/bun-server@github:xylude/bun-server
```

---

## Quick Start

```ts
import { createServer } from '@xylude/bun-server';

const app = createServer({ port: 3000 });

app.get('/hello', (req, res) => {
	return res.send({ message: 'Hello, world!' });
});

app.start();
```

---

## Creating a Server

```ts
const app = createServer({
  port: 3000,
  debug: false,
  globalHeaders: {
    'Access-Control-Allow-Origin': '*',
  },
  state: () => ({
    db: getDatabase(),
    startedAt: Date.now(),
  }),
  webSocket: { ... },
});
```

| Option          | Type                  | Default | Description                                               |
| --------------- | --------------------- | ------- | --------------------------------------------------------- |
| `port`          | `number`              | —       | Port to listen on                                         |
| `globalHeaders` | `Record<string, any>` | `{}`    | Headers added to every response                           |
| `state`         | `() => YourStateType` | `{}`    | Factory function called once per request to produce state |
| `webSocket`     | `WebSocketConfig`     | —       | WebSocket configuration (see [WebSockets](#websockets))   |
| `debug`         | `boolean`             | `false` | Log routing and request info to the console               |

> **State is a factory function.** It's called fresh on every request, so each handler gets its own isolated copy. Use this to scope things like database transactions.

---

## Routing

```ts
app.get('/path', handler);
app.post('/path', handler);
app.put('/path', handler);
app.patch('/path', handler);
app.delete('/path', handler);
app.options('/path', handler);
```

`OPTIONS` requests that have no registered handler are handled automatically — the server inspects which methods are registered for the matched path and returns the appropriate `Allow` header with a `204`.

### Route Patterns

**Exact match**

```ts
app.get('/users', handler); // matches /users only
```

**Path parameters**

```ts
app.get('/users/:id', handler); // matches /users/42
app.get('/users/:id/posts/:postId', handler); // matches /users/42/posts/7
```

**Wildcards**

```ts
app.get('/files/*', handler); // matches /files/a, /files/a/b/c, etc.
```

**Match priority:** exact → parameterized → wildcard

---

## Request Object

Every handler receives `(req, res)`. The `req` object contains:

| Property   | Type                     | Description                                |
| ---------- | ------------------------ | ------------------------------------------ |
| `request`  | `Request`                | The raw Bun `Request` object               |
| `headers`  | `Headers`                | Request headers                            |
| `pathname` | `string`                 | URL pathname (e.g. `/users/42`)            |
| `cookies`  | `Record<string, string>` | Parsed cookies from the `Cookie` header    |
| `state`    | `YourStateType`          | State returned by your state factory       |
| `__raw`    | `{ body, query, path }`  | Raw parsed data — prefer the getters below |

### getBody

Returns the parsed request body. Supports manual validation or any validator function — Zod's `.parse` is a natural fit.

```ts
// No validation — returns raw parsed body
const body = req.getBody();

// Manual validation
const body = req.getBody<{ name: string; age: number }>((b) => {
	if (typeof b.name !== 'string') throw new Error('name is required');
	if (typeof b.age !== 'number') throw new Error('age must be a number');
	return b as { name: string; age: number };
});

// Zod
import { z } from 'zod';
const Schema = z.object({ name: z.string(), age: z.number() });
const body = req.getBody(Schema.parse);
```

Body parsing is automatic based on `Content-Type`:

| Content-Type                                                | Parsed as                                      |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `application/json`                                          | Object                                         |
| `application/x-www-form-urlencoded`                         | Object                                         |
| `multipart/form-data`                                       | Object (values may be `File` instances)        |
| `application/octet-stream`, `image/*`, `video/*`, `audio/*` | `{ binary: ArrayBuffer, contentType: string }` |
| anything else                                               | `{ text: string }`                             |

### getQuery

Returns parsed query string parameters. Multi-value keys (e.g. `?tag=a&tag=b`) are returned as `string[]`.

```ts
// No validation
const query = req.getQuery();
// { search: 'bun', page: '2', tag: ['news', 'tech'] }

// Manual validation
const query = req.getQuery<{ search: string }>((q) => {
	if (typeof q.search !== 'string') throw new Error('search is required');
	return q as { search: string };
});

// Zod
const QuerySchema = z.object({
	search: z.string(),
	page: z.coerce.number().default(1),
});
const query = req.getQuery(QuerySchema.parse);
```

### getParams

Returns URL path parameters extracted from the route pattern.

```ts
// Route: /users/:id/posts/:postId
// Request: /users/42/posts/7

// No validation
const params = req.getParams();
// { id: '42', postId: '7' }

// Manual validation
const params = req.getParams<{ id: string }>((p) => {
	if (!p.id) throw new Error('id required');
	return p as { id: string };
});

// Zod
const ParamsSchema = z.object({ id: z.coerce.number() });
const { id } = req.getParams(ParamsSchema.parse);
// id is a number
```

### Cookies

Cookies from the `Cookie` header are pre-parsed into a plain object:

```ts
app.get('/profile', (req, res) => {
	const sessionId = req.cookies['session_id'];
	if (!sessionId) return res.send('no session');
	return res.send({ sessionId });
});
```

### Headers

```ts
const auth = req.headers.get('Authorization');
const contentType = req.headers.get('Content-Type');
```

### State

State is typed via the generic parameter on `createServer`. See [TypeScript](#typescript).

```ts
app.get('/status', (req, res) => {
	return res.send({ uptime: Date.now() - req.state.startedAt });
});
```

---

## Response Object

### send

Sends a response. The `Content-Type` is inferred automatically if not already set.

```ts
// JSON (object → application/json)
return res.send({ ok: true });

// HTML/text (string → text/html)
return res.send('<h1>Hello</h1>');

// Binary passthrough (ArrayBuffer, Blob, ReadableStream — set Content-Type yourself)
res.setHeader('Content-Type', 'image/png');
return res.send(imageBuffer);
```

### setStatus

Sets the HTTP status code. Must be called before `send`.

```ts
res.setStatus(201);
return res.send({ created: true });
```

### setHeader

Sets a response header. Must be called before `send`.

```ts
res.setHeader('X-Request-Id', crypto.randomUUID());
return res.send({ ok: true });
```

### setCookie / deleteCookie

```ts
// Set a cookie
res.setCookie('session_id', token, {
	httpOnly: true,
	secure: true,
	sameSite: 'Lax',
	maxAge: 60 * 60 * 24 * 7, // 1 week in seconds
	path: '/',
});
return res.send({ ok: true });

// Delete a cookie
res.deleteCookie('session_id', { path: '/' });
return res.send({ ok: true });
```

**CookieOptions:**

| Option     | Type                          | Description                |
| ---------- | ----------------------------- | -------------------------- |
| `httpOnly` | `boolean`                     | Inaccessible to JavaScript |
| `secure`   | `boolean`                     | HTTPS only                 |
| `sameSite` | `'Strict' \| 'Lax' \| 'None'` | Cross-site policy          |
| `maxAge`   | `number`                      | Max age in seconds         |
| `expires`  | `Date`                        | Expiry date                |
| `domain`   | `string`                      | Cookie domain              |
| `path`     | `string`                      | Cookie path                |

### redirect

```ts
return res.redirect('/login'); // 302 by default
return res.redirect('/dashboard', 301); // permanent redirect
```

Cookies and custom headers set before `redirect()` are included in the redirect response.

---

## Pre-Request Handlers

Pre-request handlers run before every route handler. They're useful for authentication, logging, or any cross-cutting concern. You can register multiple — they run in order.

```ts
app.addPreRequestHandler((req) => {
	// Return true to allow the request through
	return true;
});

// Return false to reject with a 400
app.addPreRequestHandler((req) => {
	const token = req.headers.get('Authorization');
	return token !== null;
});

// Return a Response to short-circuit (e.g. 401)
app.addPreRequestHandler((req) => {
	const token = req.cookies['session'];
	if (!token) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	return true;
});
```

| Return value | Behavior                         |
| ------------ | -------------------------------- |
| `true`       | Continue to next handler / route |
| `false`      | Reject with 400                  |
| `Response`   | Send that response immediately   |

---

## Static File Serving

```ts
app.addPublicDirectory('./public');
```

Files are served securely by default:

- Path traversal attempts are blocked
- Sensitive files (`.env`, `.git/`, lock files, etc.) are blocked by default
- Secure headers are added automatically (`X-Content-Type-Options`, `X-Frame-Options`, CSP, HSTS, etc.)
- Content-Type is set based on file extension

### SPA Mode

For apps using client-side routing (React Router, Wouter, etc.), enable SPA mode to serve `index.html` for any request that doesn't match a static file:

```ts
app.addPublicDirectory('./dist', { spaMode: true });
```

### Priority vs Catchall Mode

Control when static files are checked relative to your registered routes:

```ts
// priority (default): public files checked BEFORE routes
// Good for SPAs where the static bundle should always win
app.addPublicDirectory('./dist', { fallbackMode: 'priority' });

// catchall: public files only served if NO route matches
// Good for API servers that also host a few static assets
app.addPublicDirectory('./public', { fallbackMode: 'catchall' });
```

Both modes can be used simultaneously — the server checks priority directories first, then routes, then catchall directories.

### Security

**Custom block patterns:**

```ts
app.addPublicDirectory('./public', {
	blockPatterns: ['.env', '.git/', 'secrets/'],
});
```

**Disable default block list** (not recommended):

```ts
app.addPublicDirectory('./public', { allowAllFiles: true });
```

**Custom headers per directory:**

```ts
app.addPublicDirectory('./assets', {
	headers: {
		'Cache-Control': 'public, max-age=31536000, immutable',
	},
});
```

> Overriding any of the secure default headers will print a console warning.

**PublicDirectoryOptions:**

| Option          | Type                       | Default                   | Description                                      |
| --------------- | -------------------------- | ------------------------- | ------------------------------------------------ |
| `fallbackMode`  | `'priority' \| 'catchall'` | `'priority'`              | When to serve this directory relative to routes  |
| `spaMode`       | `boolean`                  | `false`                   | Serve `index.html` for unmatched paths           |
| `headers`       | `Record<string, string>`   | `{}`                      | Additional headers for files from this directory |
| `blockPatterns` | `string[]`                 | (sensitive file defaults) | Patterns to block from being served              |
| `allowAllFiles` | `boolean`                  | `false`                   | Disable block pattern protection entirely        |

---

## WebSockets

```ts
const app = createServer({
	port: 3000,
	webSocket: {
		path: '/ws',

		// Called during the HTTP → WS upgrade.
		// Whatever you return is attached to socket.data.
		onUpgrade: (request) => {
			const token = new URL(request.url).searchParams.get('token');
			if (!token) return false; // reject the upgrade
			return { userId: verifyToken(token) };
		},

		onConnected: (socket) => {
			console.log('connected', socket.data.userId);
		},

		onMessage: (socket, message) => {
			// message is already parsed from JSON if the client sent JSON
			console.log('message from', socket.data.userId, message);

			// send accepts string, object (auto JSON-stringified), or Buffer
			socket.send({ type: 'echo', data: message });
		},

		onClose: (socket) => {
			console.log('disconnected', socket.data.userId);
		},
	},
});
```

| Option        | Type                                             | Description                                                       |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `path`        | `string`                                         | URL path that triggers a WebSocket upgrade                        |
| `onUpgrade`   | `(req: Request) => false \| Record<string, any>` | Return `false` to reject, or an object to attach as `socket.data` |
| `onConnected` | `(socket) => void`                               | Called when a client connects                                     |
| `onMessage`   | `(socket, message) => void`                      | Called on each message; `message` is pre-parsed from JSON         |
| `onClose`     | `(socket) => void`                               | Called when a client disconnects                                  |

---

## MCP (Model Context Protocol)

The server has first-class support for the [Model Context Protocol](https://modelcontextprotocol.io/), letting you expose tools to LLM clients alongside your regular HTTP routes.

### HTTP Mode

Pass `mcp` to `createServer`. The server registers a single endpoint (default `/mcp`) that handles the full MCP Streamable HTTP transport: POST for JSON-RPC messages, GET for the SSE stream (server-initiated messages), and DELETE for session termination.

```ts
import { createServer } from '@xylude/bun-server';

const app = createServer({
	port: 3000,
	mcp: {
		path: '/mcp', // optional, defaults to '/mcp'
		mode: 'http', // optional, defaults to 'http'
		serverInfo: { name: 'my-server', version: '1.0.0' },
		tools: [
			{
				name: 'get_weather',
				description: 'Get current weather for a city',
				inputSchema: {
					type: 'object',
					properties: {
						city: { type: 'string', description: 'City name' },
					},
					required: ['city'],
				},
				handler: async ({ city }) => {
					const data = await fetchWeather(city);
					return `Weather in ${city}: ${data.summary}`;
				},
			},
		],
	},
});

app.get('/health', (req, res) => res.send({ ok: true }));
app.start();
```

The MCP endpoint is handled before all other routing, so `/mcp` is never matched by your regular routes.

### Stdio Mode

Set `mode: 'stdio'` to run a stdio MCP server. When `start()` is called, the process reads newline-delimited JSON-RPC from stdin and writes responses to stdout — the standard stdio transport used by Claude Desktop, the MCP CLI, and other hosts that spawn MCP servers as subprocesses.

The HTTP server still starts and your regular routes still work. Both transports coexist in Bun's event loop.

```ts
const app = createServer({
	port: 3000,
	mcp: {
		mode: 'stdio',
		tools: [
			{
				name: 'add',
				description: 'Add two numbers',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				handler: ({ a, b }) => `${a + b}`,
			},
		],
	},
});

app.start();
```

To use with Claude Desktop, add to `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"my-server": {
			"command": "bun",
			"args": ["run", "/path/to/your/server.ts"]
		}
	}
}
```

### Tool Handlers

A `handler` receives the tool's arguments as a plain object and can return:

| Return type                                    | How it's sent                        |
| ---------------------------------------------- | ------------------------------------ |
| `string`                                       | `{ type: 'text', text: yourString }` |
| `MCPContent[]`                                 | Sent as-is                           |
| `{ content: MCPContent[], isError?: boolean }` | Sent as-is                           |

Throwing from a handler is safe — the error message is returned to the client as `{ isError: true }` rather than crashing the server.

```ts
handler: async ({ query }) => {
  // String shorthand
  return `Result: ${query}`;

  // Multi-content
  return [
    { type: 'text', text: 'Here is your image:' },
    { type: 'image', data: base64string, mimeType: 'image/png' },
  ];

  // Explicit error
  return { content: [{ type: 'text', text: 'Something went wrong' }], isError: true };

  // Throw — server catches and sets isError: true automatically
  throw new Error('API rate limit exceeded');
},
```

### MCPConfig

| Option       | Type                  | Default                                        | Description                    |
| ------------ | --------------------- | ---------------------------------------------- | ------------------------------ |
| `mode`       | `'http' \| 'stdio'`   | `'http'`                                       | Transport to use               |
| `path`       | `string`              | `'/mcp'`                                       | Endpoint path (HTTP mode only) |
| `tools`      | `MCPToolDefinition[]` | —                                              | Tools to expose                |
| `serverInfo` | `{ name, version }`   | `{ name: 'bun-server-mcp', version: '1.0.0' }` | Sent during handshake          |

### MCP Spec Version

This implementation follows **MCP 2025-03-26** (Streamable HTTP transport). If you're using a client that expects an older spec (e.g., the legacy HTTP+SSE transport from 2024-11-05), it may not be compatible. Check the `MCP_PROTOCOL_VERSION` export to see what version is active.

```ts
import { MCP_PROTOCOL_VERSION } from '@xylude/bun-server';
console.log(MCP_PROTOCOL_VERSION); // '2025-03-26'
```

---

## Error Handling

Register a global error handler with `onError`. Without one, the server returns a generic 500.

```ts
app.onError((err) => {
	console.error(err.error);
	return new Response(JSON.stringify({ error: err.error.message }), {
		status: err.status || 500,
		headers: { 'Content-Type': 'application/json' },
	});
});
```

The error object contains:

| Property  | Type      | Description                                  |
| --------- | --------- | -------------------------------------------- |
| `error`   | `any`     | The thrown value                             |
| `method`  | `string`  | HTTP method of the request                   |
| `path`    | `string`  | Full request URL                             |
| `headers` | `Headers` | Request headers                              |
| `status`  | `number`  | Status from `BunServerError`, or `undefined` |

### BunServerError

Throw a `BunServerError` from any route handler to produce a structured error response. The `status` is forwarded to your `onError` handler.

```ts
import { createServer, BunServerError } from '@xylude/bun-server';

app.get('/users/:id', (req, res) => {
	const { id } = req.getParams();
	const user = db.find(id);

	if (!user) {
		throw new BunServerError('User not found', 404);
	}

	return res.send(user);
});

app.onError((err) => {
	return new Response(JSON.stringify({ error: err.error.message }), {
		status: err.status || 500,
		headers: { 'Content-Type': 'application/json' },
	});
});
```

---

## Testing

`createTestServer` creates an in-memory server with the same API as `createServer` but without binding to a port. Use it in unit tests to exercise your route handlers directly.

```ts
import { createTestServer } from '@xylude/bun-server';

const app = createTestServer();

app.get('/hello', (req, res) => {
	const { name } = req.getQuery<{ name: string }>();
	return res.send({ message: `Hello, ${name}!` });
});

// In your test
const response = await app.call('/hello', {
	method: 'GET',
	query: { name: 'world' },
});

console.log(response.status); // 200
console.log(response.body); // { message: 'Hello, world!' }
```

### call(path, options)

| Option    | Type                     | Description                      |
| --------- | ------------------------ | -------------------------------- |
| `method`  | `ValidMethods`           | HTTP method (default: `'GET'`)   |
| `body`    | `any`                    | Request body (objects → JSON)    |
| `query`   | `Record<string, string>` | Query string parameters          |
| `headers` | `Record<string, string>` | Request headers                  |
| `cookies` | `Record<string, string>` | Cookies to send with the request |

### TestResponse

```ts
const { status, headers, cookies, body } = await app.call('/path');
```

| Property  | Type                     | Description                         |
| --------- | ------------------------ | ----------------------------------- |
| `status`  | `number`                 | HTTP status code                    |
| `headers` | `Record<string, string>` | Response headers                    |
| `cookies` | `Record<string, string>` | Parsed `Set-Cookie` headers         |
| `body`    | `any`                    | Parsed body (JSON, text, or buffer) |

### Example with a test framework

```ts
import { describe, it, expect } from 'bun:test';
import { createTestServer, BunServerError } from '@xylude/bun-server';

const app = createTestServer({
	state: () => ({ user: null as string | null }),
});

app.addPreRequestHandler((req) => {
	const token = req.headers.get('Authorization');
	if (!token) return new Response('Unauthorized', { status: 401 });
	req.state.user = token;
	return true;
});

app.get('/me', (req, res) => {
	return res.send({ user: req.state.user });
});

describe('GET /me', () => {
	it('returns 401 without token', async () => {
		const res = await app.call('/me');
		expect(res.status).toBe(401);
	});

	it('returns user when authenticated', async () => {
		const res = await app.call('/me', {
			headers: { Authorization: 'Bearer abc123' },
		});
		expect(res.status).toBe(200);
		expect(res.body.user).toBe('Bearer abc123');
	});
});
```

---

## TypeScript

Pass your state type as a generic to get full type inference throughout your handlers:

```ts
type AppState = {
	db: Database;
	userId: string | null;
};

const app = createServer<AppState>({
	port: 3000,
	state: () => ({
		db: getDatabase(),
		userId: null,
	}),
});

app.get('/profile', (req, res) => {
	// req.state is fully typed as AppState
	const user = req.state.db.findUser(req.state.userId);
	return res.send(user);
});
```

The same generic works with `createTestServer<AppState>(...)`.

### Using Zod for request validation

Zod's `.parse` method is directly compatible with all three getters since it takes an `unknown` and throws on invalid input — which the server will catch and forward to your `onError` handler.

```ts
import { z } from 'zod';

const CreateUserBody = z.object({
	name: z.string().min(1),
	email: z.string().email(),
	age: z.coerce.number().int().min(0),
});

const UserQuery = z.object({
	page: z.coerce.number().default(1),
	limit: z.coerce.number().default(20),
});

app.post('/users', (req, res) => {
	const body = req.getBody(CreateUserBody.parse);
	// body is typed as { name: string; email: string; age: number }
	return res.send({ created: body });
});

app.get('/users', (req, res) => {
	const { page, limit } = req.getQuery(UserQuery.parse);
	return res.send({ page, limit });
});
```

---

## License

MIT

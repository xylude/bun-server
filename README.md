# Bun Server

A lightweight and flexible HTTP & WebSocket server built with [Bun](https://bun.sh/). This server provides an Express-like API for handling HTTP requests, managing WebSockets, and serving static files with minimal dependencies.

## Features

- **Express-like API**: Define routes with `get`, `post`, `put`, `delete`, and more.
- **WebSocket Support**: Easily manage WebSocket connections with custom handlers.
- **Middleware-like Request Validation**: Hook into requests before they hit your route handlers.
- **Static File Serving**: Serve files from a public directory with minimal setup.
- **Custom Error Handling**: Define custom responses for errors across the server.
- **Built-in JSON & Form Parsing**: Automatically parses `application/json`, `x-www-form-urlencoded`, and `multipart/form-data` requests.
- **Global State Management**: Define global server state variables accessible in request handlers.
- **Lightweight & Fast**: Runs efficiently with minimal overhead.

## Installation

```sh
bun add @nex-app/bun-server
```

## Quick Start

```ts
import { createServer } from '@nex-app/bun-server';

const server = createServer({
	port: 3000,
	globalHeaders: {
		'Access-Control-Allow-Origin': '*',
	},
	state: {
		someProp: 'my-global-prop'
		someFunc: function() {
			return 'hello!'
		},
	},
	onRequest: (req) => {
		console.log(`${req.request.method} ${req.request.url}`);
		return true; // Allow request to proceed
	},
});

// an unnessecarily verbose demo
server.get('/hello', (req, res) => {
	const user = req.state.someFunc();
	const db = req.state.db();
	console.log(req.params.query);
	console.log(req.state);
	res.setStatus(400);
	res.setHeader('custom', 'custom value');
	return res.send({
		message: 'Hello World',
		headers: req.headers['user-agent'],
	});
});

server.start();
console.log('Server running on http://localhost:3000');
```

## API Reference

### `createServer(options)`

Creates and configures a new Bun server.

#### Options:

| Option          | Type                                          | Description                                                                                                                                                                |
| --------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`          | `number`                                      | Port for the server to listen on.                                                                                                                                          |
| `webSocket`     | `WebSocketConfig` (optional)                  | WebSocket configuration.                                                                                                                                                   |
| `state`         | `Record<string, any>` (optional)              | Global server state object.                                                                                                                                                |
| `globalHeaders` | `Record<string, any>` (optional)              | Headers applied to all responses.                                                                                                                                          |
| `debug`         | `boolean` (optional)                          | Enable debugging logs.                                                                                                                                                     |
| `onRequest`     | `(req: RequestHandler) => boolean` (optional) | Middleware-like request validator. Can be used for authentication or any other thing you may want to do with it. Returning false will send a 400 error back to the client. |

### HTTP Methods

The server provides methods for handling different HTTP requests:

```ts
server.get("/route", (req, res) => { ... });
server.post("/route", (req, res) => { ... });
server.put("/route", (req, res) => { ... });
server.patch("/route", (req, res) => { ... });
server.delete("/route", (req, res) => { ... });
server.options("/route", (req, res) => { ... });
server.head("/route", (req, res) => { ... });
```

Each handler receives:

- `req`: Request object containing `params`, `headers`, `state`, and `request`.
- `res`: Response object with `send()`, `setStatus()`, and `setHeader()`.

#### Example:

```ts
server.get('/users/:id', (req, res) => {
	res.send({ userId: req.params.path.id });
});
```

### WebSocket Support

To enable WebSockets, pass a `webSocket` config:

```ts
server = createServer({
	port: 3000,
	webSocket: {
		path: '/ws',
		onUpgrade: (req) => {
			console.log('WebSocket upgrade');
			return { userId: '1234' };
		},
		onConnected: (socket) => {
			console.log('Client connected');
		},
		onMessage: (socket, message) => {
			console.log(socket.data.userId);
			console.log('Received message', message);
			socket.send({ echo: message });
		},
		onClose: (socket) => console.log('Client disconnected'),
	},
});
```

The websocket config's onUpgrade method will allow you to define custom data that will be
present in the onMessage function via `socket.data`. This is useful for authentication or carrying
state across multiple messages.

Currently `socket.data` is mutable, but in future updates I plan to use a state management function to
perform mutations, similar to how setState works in React.

### Static File Serving

You can serve a folder as a public directory:

```ts
server.addPublicDirectory('public');
```

This allows access to files via:

```
http://localhost:3000/index.html
http://localhost:3000/styles.css
```

### Custom Error Handling

Define a global error handler:

```ts
server.onError((err) => {
	console.log('Error handler', err.message);
	return new Response('error', { status: err.status || 500 });
});
```

## License

MIT

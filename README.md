# Bun Server

This is a pretty small and lightweight abstraction from the built-in Bun webserver. Currently, it handles routing and websockets (what I need for my own purposes right now).

You can enable CORS headers by passing them into the `globalHeaders` property of the createServer function.

If you'd like state that's available for any request objects, you can add it to the `state` property.

### The request object:

**request:** The original request object that was passed into the native Bun server.

**params:** Contains the following - query: an object containing the key/value pairs of the querystring. - body: either an object or string of the JSON request or an object containing a single property `text` containing the plain text of the request body - path: an object containing the key/value pairs of the path variables eg. `/foo/:bar` will return { bar: 'whatever bar was' }`

**state:** Anything you have set in the state object upon server creation. I believe this is currently mutable so be careful if you are assigning
values here.

### The response object:

**setStatus(status: number):** Sets the HTTP status code to respond with

**setHeader(k: string, v:string):** Sets a header for the response

**send(responseTextOrObject: string):** Send the response to the client.

The `res.send()` method will automatically send the response as JSON if you pass an object in.

`req.body` will try to parse the input as an object if the request header content type is application/json.

## Example Usage

```javascript
import { createServer } from '..';

const app = createServer({
	port: 3222,
	globalHeaders: {
		'Access-Control-Allow-Origin': '*',
	},
	state: {
		authenticate: () => {
			console.log('authenticate!');
		},
		db: () => {
			console.log('db!');
		},
	},
	webSocket: {
		path: '/ws', // localhost:3222/ws from the client
		onUpgrade: (req) => {
			console.log('you can upgrade here, must return a boolean!');
			return {
				userId: '1234',
			};
		},
		onConnected: (socket) => {
			console.log('A socket was connected');
		},
		onMessage: (socket, message) => {
			// 1234 set in the upgrade function. You can sessionize like this or just emit to select clients rather than everyone on the socket using this
			console.log(socket.data.userId);
			console.log('a message was received', message);
			// echo back:
			socket.send(message);
		},
		onClose: (socket) => {
			console.log('socket connection was closed');
		},
	},
	debug: true,
});

app.get('/hello', (req, res) => {
	const user = req.state.authenticate();
	const db = req.state.db();
	console.log(req.params.query);
	res.setStatus(400);
	res.setHeader('custom', 'custom value');
	return res.send({
		message: 'Hello World',
	});
});

app.get('/hello/:id', (req, res) => {
	return res.send({
		message: 'Hello World with param',
		params: req.params,
	});
});

app.get('/hello/:id/configure/:name', (req, res) => {
	return res.send({
		message: 'Hello World with param',
		params: req.params,
	});
});

app.get('/text', (req, res) => {
	return res.send('text content');
});

app.onError((err) => {
	console.log('error handler', err.message);
	return new Response('error', { status: err.status || 500 });
});

const server = app.start();

console.log('server started', server.url.host);
```

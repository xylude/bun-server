# Bun Server

This is a pretty small and lightweight abstraction from the built-in Bun webserver. Currently, it handles routing and websockets (what I need for my own purposes right now). As I get time I will add CORS, middleware, and other need to haves. 

## Example Usage

```javascript
// create a server
import { createServer } from "..";

const app = createServer({
	port: 3101,
	state: {
    // lets you add state across requests for whatever you might want to attach to every request object globally
		authenticate: () => {
			console.log('authenticate!');
		},
		db: () => {
			console.log('db!');
		},
	},
  webSocket: {
			path: '/ws',
			onUpgrade: (req) => {
        // you can return null here and it will halt the upgrade attempt. This is a solid spot
        // to authenticate the connection.

        // just a way to get information from the request before connecting.
				// const cookies = cookie.parse(req.headers.get('Cookie') || '');
				return {
					// testData: cookies['somecookie'],
					testData: `Test ${Date.now()}`,
				};
			},
			onConnected: (ws) => {
				console.log(ws.data.testData);
				console.log('connected');
			},
			onMessage: (ws, message) => {
				console.log(ws.data.testData);
				console.log('message', message);
			},
			onClose: (ws) => {
				console.log(ws.data.testData);
				console.log('closed');
			},
		},
  // uncomment if you want console.logs about various happenings
  // debug: true
});

app.get('/hello', (req) => {
	const user = req.state.authenticate();
	const db = req.state.db();
	console.log(req.params.query);
	return Response.json({
		message: 'Hello World',
	});
});

app.get('/hello/:id', (req) => {
  const { id } = req.params.path;
	return Response.json({
		message: 'Hello World with param',
		params: req.params,
	});
});

app.post('/hello/:id/configure/:name', (req) => {
  // if content-type is json then it comes back as a js object, else just plain text.
  const { foo, bar } = req.params.body;
	return Response.json({
		message: 'Hello World with param',
		params: req.params,
	});
});

app.onError((err) => {
	console.log('error handler', err);
	return new Response('error', { status: err.status || 500 });
});

const server = app.start();

console.log('server started', server.url.host);

```

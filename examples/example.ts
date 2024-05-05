import { createServer } from "..";

const app = createServer({
	port: 3101,
	state: {
		authenticate: () => {
			console.log('authenticate!');
		},
		db: () => {
			console.log('db!');
		},
	},
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
	return Response.json({
		message: 'Hello World with param',
		params: req.params,
	});
});

app.get('/hello/:id/configure/:name', (req) => {
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

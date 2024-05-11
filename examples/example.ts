import { createServer } from "..";

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
});

app.get('/hello', (req, res) => {
	const user = req.state.authenticate();
	const db = req.state.db();
	console.log(req.params.query);
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
})

app.onError((err) => {
	console.log('error handler', err);
	return new Response('error', { status: err.status || 500 });
});

const server = app.start();

console.log('server started', server.url.host);

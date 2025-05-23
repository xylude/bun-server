import { createServer } from '..';

const publicRoutes = ['/hellos'];

const app = createServer({
	port: 3222,
	globalHeaders: {
		'Access-Control-Allow-Origin': '*',
	},
	state: () => ({
		var1: 'value1' as string,
		var2: false as boolean,
	}),
	webSocket: {
		path: '/ws', // localhost:3222/ws from the client
		onUpgrade: (req) => {
			console.log(
				'you can upgrade here, whatever you return will be attached to socket.data'
			);
			return {
				userId: '1234',
			};
		},
		onConnected: (socket) => {
			console.log('A socket was connected');
		},
		onMessage: (socket, message) => {
			// 1234 set in the upgrade function. You can sessionize like this
			console.log(socket.data.userId);
			console.log('a message was received', message);
			// string suppport
			socket.send(`echo ${message}`);
			// JSON support
			socket.send({ message: 'echo', data: message });
			// Buffer support
			socket.send(Buffer.from('echo'));
		},
		onClose: (socket) => {
			console.log('socket connection was closed');
		},
	},
	debug: true,
});

app.addPublicDirectory('public');

app.addPreRequestHandler((req) => {
	req.state.var2 = true;
	return true;
});

app.get('/hello', (req, res) => {
	const test = req.state.var2
	console.log(req.params.query);
	console.log(req.state);
	res.setStatus(400);
	res.setHeader('custom', 'custom value');
	return res.send({
		message: 'Hello World',
		headers: req.headers['user-agent'],
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

export type WrappedServerWebSocket = {
	conn: ServerWebSocket<any>;
	user: User;
};

export function wrapWebsocket(
	ws: ServerWebSocket<any>,
	user: User
): WrappedServerWebSocket {
	return {
		conn: ws,
		user,
	};
}

export type HandlerFunc = (req: RequestHandler) => Response | Promise<Response>;

export type WebSocketConnectedHandler = (
	ws: ServerWebSocket<any>
) => void | Promise<void> | null;

export type WebSocketMessageHandler = (
	ws: ServerWebSocket<any>,
	message: string | Buffer
) => void | Promise<void> | null;

export type Handler = {
	path: string;
	handler: HandlerFunc;
};

type ValidMethods =
	| 'GET'
	| 'POST'
	| 'PUT'
	| 'DELETE'
	| 'PATCH'
	| 'HEAD'
	| 'OPTIONS'
	| 'CONNECT'
	| 'TRACE';

type WebSocketConfig = {
	onConnected?: WebSocketConnectedHandler;
	onMessage?: WebSocketMessageHandler;
	onClose?: (ws: ServerWebSocket<any>) => void;
	onUpgrade?: (req: Request) => boolean | Record<string, any>;
	path: string;
};

export type RequestHandler = {
	request: Request;
	params: {
		body: Record<string, any>;
		query: Record<string, string>;
		path: Record<string, string>;
	};
	state: Record<string, any>;
};

export type ErrorHandler = (err: any) => void;

export type EzBunServer = {
	get: (path: string, handler: HandlerFunc) => void;
	post: (path: string, handler: HandlerFunc) => void;
	put: (path: string, handler: HandlerFunc) => void;
	delete: (path: string, handler: HandlerFunc) => void;
	patch: (path: string, handler: HandlerFunc) => void;
	onError: (errorHandler: ErrorHandler) => void;
	start: () => Server;
};

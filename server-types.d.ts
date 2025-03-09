import { Server, ServerWebSocket } from 'bun';

export type HandlerFunc = (
	req: RequestHandler,
	res: ResponseHandler
) => Response | Promise<Response>;

export type WebSocketConnectedHandler = (
	ws: ServerWebSocket<any>
) => void | Promise<void> | null;

interface ModifiedServerWebSocket<T> extends Omit<ServerWebSocket<T>, "send"> {
	send: (message: string | Buffer | Record<string, any>) => void
}

export type WebSocketMessageHandler = (
	ws: ModifiedServerWebSocket<any>,
	message: string | Buffer | Record<string, any>
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
	headers: Headers;
	state: Record<string, any>;
};

export type ErrorHandler = (err: any) => Response;

export type ResponseHandler = {
	setStatus: (statusCode: number) => void;
	setHeader: (key: string, value: string) => void;
	send: (data: any) => Response;
};

export type BunServer = {
	get: (path: string, handler: HandlerFunc) => void;
	post: (path: string, handler: HandlerFunc) => void;
	put: (path: string, handler: HandlerFunc) => void;
	delete: (path: string, handler: HandlerFunc) => void;
	patch: (path: string, handler: HandlerFunc) => void;
	options: (path: string, handler: HandlerFunc) => void;
	onError: (errorHandler: ErrorHandler) => void;
	addPublicDirectory: (dir: string) => void;
	start: () => Server;
};
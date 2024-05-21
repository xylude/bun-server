import { Server, ServerWebSocket } from 'bun';

export type HandlerFunc = (
	req: RequestHandler,
	res: ResponseHandler
) => Response | Promise<Response>;

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
	headers: Record<string, string>;
	state: Record<string, any>;
};

export type ErrorHandler = (err: any) => void;

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
	onError: (errorHandler: ErrorHandler) => void;
	start: () => Server;
};

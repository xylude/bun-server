import { Server, ServerWebSocket } from 'bun';

export type HandlerFunc<StateType> = (
	req: RequestHandler<StateType>,
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

export type Handler<StateType> = {
	path: string;
	handler: HandlerFunc<StateType>;
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

export type RequestHandler<StateType> = {
	request: Request;
	params: {
		body: Record<string, any>;
		query: Record<string, string>;
		path: Record<string, string>;
	};
	headers: Headers;
	state: StateType;
	pathname: string;
	cookies: Record<string, string>;
};

export type ErrorHandler = (err: any) => Response;

export type CookieOptions = {
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
	domain?: string;
	path?: string;
	maxAge?: number;
	expires?: Date;
};

export type ResponseHandler = {
	setStatus: (statusCode: number) => void;
	setHeader: (key: string, value: string) => void;
	setCookie: (key: string, value: string, options?: CookieOptions) => void;
	deleteCookie: (key: string, options?: Pick<CookieOptions, "domain" | "path">) => void;
	redirect: (url: string, statusCode?: number) => Response;
	send: (data: any) => Response;
};

export type BunServer<StateType> = {
	get: (path: string, handler: HandlerFunc<StateType>) => void;
	post: (path: string, handler: HandlerFunc<StateType>) => void;
	put: (path: string, handler: HandlerFunc<StateType>) => void;
	delete: (path: string, handler: HandlerFunc<StateType>) => void;
	patch: (path: string, handler: HandlerFunc<StateType>) => void;
	options: (path: string, handler: HandlerFunc<StateType>) => void;
	onError: (errorHandler: ErrorHandler) => void;
	addPublicDirectory: (dir: string) => void;
	addPreRequestHandler: (handler: (req: RequestHandler<StateType>) => boolean | Response | Promise<boolean | Response>) => void;
	start: () => Server;
};
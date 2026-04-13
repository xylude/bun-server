import type { MCPConfig, MCPToolDefinition, MCPContent, MCPToolResult } from './server-types';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

// ─── Internal types ───────────────────────────────────────────────────────────

type Session = {
	id: string;
	initialized: boolean;
	sseController?: ReadableStreamDefaultController<Uint8Array>;
};

type MessageResult = {
	response: Record<string, any> | null; // null = notification, respond 202
	newSessionId?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rpcResult(id: any, result: any): Record<string, any> {
	return { jsonrpc: '2.0', id, result };
}

function rpcError(id: any, code: number, message: string): Record<string, any> {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

function normalizeToolResult(raw: MCPToolResult): { content: MCPContent[]; isError: boolean } {
	if (typeof raw === 'string') {
		return { content: [{ type: 'text', text: raw }], isError: false };
	}
	if (Array.isArray(raw)) {
		return { content: raw, isError: false };
	}
	return { content: raw.content, isError: raw.isError ?? false };
}

// ─── Core message handler (shared between HTTP and stdio) ─────────────────────

export function createMcpMessageHandler(config: MCPConfig) {
	const sessions = new Map<string, Session>();
	const toolMap = new Map<string, MCPToolDefinition>();

	for (const tool of config.tools) {
		toolMap.set(tool.name, tool);
	}

	const serverInfo = config.serverInfo ?? { name: 'bun-server-mcp', version: '1.0.0' };

	async function handleMessage(message: any, sessionId?: string): Promise<MessageResult> {
		const { method, id, params } = message;

		// ── initialize ────────────────────────────────────────────────────────
		if (method === 'initialize') {
			const newSessionId = crypto.randomUUID();
			sessions.set(newSessionId, { id: newSessionId, initialized: false });

			return {
				response: rpcResult(id, {
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: {
						tools: { listChanged: false },
					},
					serverInfo,
				}),
				newSessionId,
			};
		}

		// ── session validation for all other methods ──────────────────────────
		// stdio uses a synthetic fixed session; HTTP requires a real session ID
		if (sessionId && sessionId !== '__stdio__' && !sessions.has(sessionId)) {
			return { response: rpcError(id ?? null, -32600, 'Invalid or expired session') };
		}

		// ── notifications (no response body) ──────────────────────────────────
		if (method === 'notifications/initialized') {
			if (sessionId && sessions.has(sessionId)) {
				sessions.get(sessionId)!.initialized = true;
			}
			return { response: null };
		}

		if (method?.startsWith('notifications/')) {
			return { response: null };
		}

		// ── ping ──────────────────────────────────────────────────────────────
		if (method === 'ping') {
			return { response: rpcResult(id, {}) };
		}

		// ── tools/list ────────────────────────────────────────────────────────
		if (method === 'tools/list') {
			return {
				response: rpcResult(id, {
					tools: config.tools.map((t) => ({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema,
					})),
				}),
			};
		}

		// ── tools/call ────────────────────────────────────────────────────────
		if (method === 'tools/call') {
			const toolName: string = params?.name;
			const args: Record<string, any> = params?.arguments ?? {};

			const tool = toolMap.get(toolName);
			if (!tool) {
				return { response: rpcError(id, -32602, `Unknown tool: ${toolName}`) };
			}

			try {
				const raw = await tool.handler(args);
				return { response: rpcResult(id, normalizeToolResult(raw)) };
			} catch (e: any) {
				return {
					response: rpcResult(id, {
						content: [{ type: 'text', text: e?.message ?? String(e) }],
						isError: true,
					}),
				};
			}
		}

		return { response: rpcError(id ?? null, -32601, `Method not found: ${method}`) };
	}

	return { handleMessage, sessions };
}

// ─── HTTP transport ───────────────────────────────────────────────────────────

export function createMcpHttpHandler(config: MCPConfig) {
	const { handleMessage, sessions } = createMcpMessageHandler(config);
	const encoder = new TextEncoder();

	async function handlePost(request: Request): Promise<Response> {
		const sessionId = request.headers.get('Mcp-Session-Id') ?? undefined;

		let body: any;
		try {
			body = await request.json();
		} catch {
			return new Response(JSON.stringify(rpcError(null, -32700, 'Parse error')), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Batch of messages
		if (Array.isArray(body)) {
			const results = await Promise.all(body.map((msg) => handleMessage(msg, sessionId)));
			const responses = results.map((r) => r.response).filter((r) => r !== null);
			if (responses.length === 0) return new Response(null, { status: 202 });
			return new Response(JSON.stringify(responses), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Single message
		const { response, newSessionId } = await handleMessage(body, sessionId);

		if (response === null) {
			return new Response(null, { status: 202 });
		}

		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (newSessionId) {
			headers['Mcp-Session-Id'] = newSessionId;
		}

		return new Response(JSON.stringify(response), { status: 200, headers });
	}

	function handleGet(request: Request): Response {
		const sessionId = request.headers.get('Mcp-Session-Id') ?? undefined;

		// Validate session exists (except for clients that haven't initialized yet)
		if (sessionId && !sessions.has(sessionId)) {
			return new Response('Session not found', { status: 404 });
		}

		let interval: ReturnType<typeof setInterval>;

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				if (sessionId) {
					const session = sessions.get(sessionId);
					if (session) session.sseController = controller;
				}

				// Keep-alive heartbeat every 15 seconds (SSE comment, ignored by clients)
				interval = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(': heartbeat\n\n'));
					} catch {
						clearInterval(interval);
					}
				}, 15_000);
			},
			cancel() {
				clearInterval(interval);
				if (sessionId) {
					const session = sessions.get(sessionId);
					if (session) delete session.sseController;
				}
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'X-Accel-Buffering': 'no',
			},
		});
	}

	function handleDelete(request: Request): Response {
		const sessionId = request.headers.get('Mcp-Session-Id');
		if (!sessionId || !sessions.has(sessionId)) {
			return new Response('Session not found', { status: 404 });
		}
		const session = sessions.get(sessionId)!;
		try {
			session.sseController?.close();
		} catch {
			// already closed
		}
		sessions.delete(sessionId);
		return new Response(null, { status: 200 });
	}

	return { handlePost, handleGet, handleDelete };
}

// ─── Stdio transport ──────────────────────────────────────────────────────────

export async function runMcpStdio(config: MCPConfig): Promise<void> {
	const { handleMessage } = createMcpMessageHandler(config);

	// Stdio uses a single synthetic session for the lifetime of the process
	const stdioSessionId = '__stdio__';

	const decoder = new TextDecoder();
	let buffer = '';

	const reader = Bun.stdin.stream().getReader();

	function writeLine(obj: Record<string, any>): void {
		process.stdout.write(JSON.stringify(obj) + '\n');
	}

	while (true) {
		let chunk: ReadableStreamReadResult<Uint8Array>;
		try {
			chunk = await reader.read();
		} catch {
			break;
		}

		if (chunk.done) break;

		buffer += decoder.decode(chunk.value, { stream: true });

		const lines = buffer.split('\n');
		// Last element may be incomplete — keep it in the buffer
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			let message: any;
			try {
				message = JSON.parse(trimmed);
			} catch {
				writeLine(rpcError(null, -32700, 'Parse error'));
				continue;
			}

			const { response } = await handleMessage(message, stdioSessionId);
			if (response !== null) {
				writeLine(response);
			}
		}
	}
}

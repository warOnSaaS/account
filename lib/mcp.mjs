import { CATALOGUE, toWire, fromWire, runTool, ToolError } from './tools.mjs';
import { json, bodyOf } from './http.mjs';

// MCP over Streamable HTTP (plain JSON answers, no server-sent stream needed): initialize, tools/list, tools/call.
const PROTOCOL = '2025-06-18';

export function mcpTools() {
  return CATALOGUE.filter((t) => t.name !== 'account.answer_approval').map((t) => ({
    name: toWire(t.name),
    title: t.title,
    description: t.description + (t.confirm === 'human' ? ' Needs the person\'s yes on their account page before it runs.' : ''),
    inputSchema: t.input,
    outputSchema: t.output?.type === 'object' && t.output.properties ? t.output : undefined,
    annotations: { title: t.title, readOnlyHint: t.scope === 'read', destructiveHint: t.scope === 'delete', idempotentHint: t.scope === 'read' },
  }));
}

export async function handleMcp(req, res, { H, db, call, issuer }) {
  if (req.method === 'GET') return res.writeHead(405, { allow: 'POST' }).end();
  if (req.method === 'DELETE') return res.writeHead(200).end();
  if (!call) {
    return json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to your warOnSaaS account' } }, { 'www-authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"` });
  }
  const msg = await bodyOf(req);
  const batch = Array.isArray(msg);
  const out = [];
  for (const m of batch ? msg : [msg]) {
    const r = await one(m, { H, db, call });
    if (r) out.push(r);
  }
  if (!out.length) return res.writeHead(202).end();
  json(res, 200, batch ? out : out[0]);
}

async function one(m, { H, db, call }) {
  const reply = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
  if (m.id === undefined) return null; // a notification
  switch (m.method) {
    case 'initialize':
      return reply({ protocolVersion: m.params?.protocolVersion ?? PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'warOnSaaS Account', version: '0.1.0' }, instructions: `Signed in as ${call.account.name}. These tools manage the person's warOnSaaS account and teams: profile, sign-ins, brand kit, data home, export.` });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: mcpTools() });
    case 'tools/call': {
      const name = fromWire(m.params?.name ?? '');
      try {
        const r = await runTool(H, db, name, m.params?.arguments ?? {}, call);
        const body = r.pending ? { pending: r.pending } : r.result;
        return reply({ content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: false });
      } catch (e) {
        if (e instanceof ToolError) return reply({ content: [{ type: 'text', text: e.message }], isError: true });
        console.error(e);
        return reply({ content: [{ type: 'text', text: 'Something went wrong on our side. Try again.' }], isError: true });
      }
    }
    default:
      return err(-32601, `Unknown method ${m.method}`);
  }
}

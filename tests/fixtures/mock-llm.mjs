// A stand-in for the Anthropic and OpenAI-compatible APIs: it "translates" by
// prefixing each message with the target language code, keeping ICU intact.
import http from 'node:http';

export function startMockLLM({ fail = () => false } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const json = JSON.parse(body);
      requests.push({ url: req.url, headers: req.headers, body: json });
      const system = json.system ?? json.messages.find(m => m.role === 'system').content;
      const user = json.messages.find(m => m.role === 'user').content;
      const code = /\) into .*\(([\w-]+)\)\./.exec(system)[1];
      const blocks = [...user.matchAll(/^## (\S+)\n\n(?:Context: .*\n\n)?```icu\n([\s\S]*?)\n```/gm)];
      const reply = blocks.map(([, key, text]) => `## ${key}\n\n\`\`\`icu\n${fail(key, text) ? `[${code}] {bogus}` : `[${code}] ${text}`}\n\`\`\``).join('\n\n');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url.endsWith('/chat/completions')
        ? { choices: [{ message: { content: reply }, finish_reason: 'stop' }] }
        : { content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() })));
}

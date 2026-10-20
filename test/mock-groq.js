// Minimal stand-in for the Groq chat completions endpoint (used by tests only).
const http = require('node:http');

module.exports = function startMock(behaviour) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ headers: req.headers, body });
      const b = behaviour(body, calls.length) || {};
      setTimeout(() => {
        res.statusCode = b.status || 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(b.json || { choices: [{ message: { role: 'assistant', content: `Mock reply to: ${body.messages[body.messages.length - 1].content}` } }] }));
      }, b.delay || 0);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` })));
};

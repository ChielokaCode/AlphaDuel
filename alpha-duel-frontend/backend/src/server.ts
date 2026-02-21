// server.ts
import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

type GuessStore = {
  [sessionId: string]: {
    player1?: number[];
    player2?: number[];
  }
};

const guesses: GuessStore = {};

// ---------------------
// WebSocket Server
// ---------------------
const wss = new WebSocketServer({ noServer: true });
const sessionSockets: { [sessionId: string]: Set<WebSocket> } = {};

// Broadcast updates to all clients in a session
function broadcast(sessionId: string, data: any) {
  const sockets = sessionSockets[sessionId];
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

// ---------------------
// HTTP Endpoints
// ---------------------

//COMMIT GUESSES OF PLAYER 1 AND PLAYER 2
app.post('/commitGuess', (req, res) => {
  const { sessionId, player, guessNumbers } = req.body;
  if (!sessionId || !player || !guessNumbers) {
    return res.status(400).send('Missing parameters');
  }

  guesses[sessionId] = guesses[sessionId] || {};
  if (player === 1) guesses[sessionId].player1 = guessNumbers;
  else if (player === 2) guesses[sessionId].player2 = guessNumbers;

  console.log(`📥 Session ${sessionId} updated:`, guesses[sessionId]);

  broadcast(sessionId, { player, guessNumbers });

  res.send({ success: true });
});

//GET GUESSES OF PLAYER 1 AND PLAYER 2
app.get('/getGuesses', (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).send('Missing sessionId');

  const sessionGuesses = guesses[sessionId];
  if (!sessionGuesses) return res.status(404).send('No guesses for this session');

  res.send(sessionGuesses);
});


// ---------------------
// WebSocket Upgrade
// ---------------------
import http from 'http';
const server = http.createServer(app);

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return socket.destroy();

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, sessionId);
  });
});

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage, sessionId: string) => {
  sessionSockets[sessionId] = sessionSockets[sessionId] || new Set();
  sessionSockets[sessionId].add(ws);

  console.log(`🔗 New WS connection for session ${sessionId}. Total clients: ${sessionSockets[sessionId].size}`);
  // Send current guesses on connect
  ws.send(JSON.stringify(guesses[sessionId] || {}));

  ws.on('close', () => {
    sessionSockets[sessionId].delete(ws);
    console.log(`❌ WS disconnected from session ${sessionId}. Remaining clients: ${sessionSockets[sessionId].size}`);
  });
});

// ---------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});
const http = require("http");
const url = require("url");
const WebSocket = require("ws");
const EventEmitter = require("events");

if (!(process.env.TWITCH_NICK && process.env.TWITCH_OAUTH_TOKEN && process.env.TWITCH_CHANNELS)) {
  throw new Error('Please configure environment variables TWITCH_NICK, TWITCH_OAUTH_TOKEN, TWITCH_CHANNELS');
}

const port = process.env.PORT || 5000;

const channels = process.env.TWITCH_CHANNELS.split(",");

let socket;
let timeout;
let delay = 250;
let emitter = new EventEmitter();

(function open() {
  socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
  socket.onopen = () => {
    delay = 250;
    socket.send(`PASS ${process.env.TWITCH_OAUTH_TOKEN}`);
    socket.send(`NICK ${process.env.TWITCH_NICK}`);
    socket.send(`CAP REQ :twitch.tv/tags`);
    for (const channel of channels) socket.send(`JOIN #${channel}`);
  };
  socket.onclose = () => {
    delay *= 2;
    timeout = setTimeout(open, delay + Math.random() * delay);
  };
  socket.onmessage = event => {
    console.log('socket received message', event.data);
    emitter.emit("message", parseMessage(event.data));
  };
})();

function parseMessage(data) {
  let i = 0, j;
  let tags;
  let user;
  let type;
  let channel;
  let message;
  if (data[0] === "@") j = data.indexOf(" ", i), tags = parseTags(data.slice(i + 1, j)), i = j + 1;
  j = data.indexOf(" ", i), user = data.slice(i + 1, data.indexOf("!", i)), i = j + 1;
  j = data.indexOf(" ", i), type = data.slice(i, j), i = j + 1;
  j = data.indexOf(" ", i), channel = data.slice(i + 1, j), i = j + 1;
  j = data.indexOf(" ", i), message = data.slice(i + 1, -2);
  return {
    tags,
    user,
    type,
    channel,
    message
  };
}

function parseTags(data) {
  return Object.fromEntries(data.split(";").map(d => d.split(/=/)));
}

process.on("SIGTERM", () => {
  socket.onclose = null;
  socket.close();
  process.exit(0);
});


const setupSSE = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', 'https://anjana.static.observableusercontent.com');
};



const server = http.createServer((req, res) => {
  console.log(req.url, req.headers);
  const { pathname } = url.parse(req.url);
  if (req.headers.accept && req.headers.accept === 'text/event-stream' && pathname === '/events') {
    console.log('attempting to send SSEs');
    setupSSE(req,res);
    const sendSSE = (res, data) => {
      console.log('attempting to send', data);
      res.write(`data: ${JSON.stringify(data)}`);
    };
    emitter.addListener("message", sendSSE);
    emitter.emit("message", "does it work?");
    socket.on("close", () => emitter.removeListener("message", sendSSE));
  } else {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end("404");
  }
});


const socketServer = new WebSocket.Server({server});

socketServer.on("connection", (socket, request) => {
  const {pathname} = url.parse(request.url);
  const channel = pathname.slice(1);
  if (!channels.includes(channel)) return void socket.terminate();
  const message = message => {
    if (message.channel === channel) {
      socket.send(JSON.stringify(message));
    }
  };
  emitter.addListener("message", message);
  socket.on("close", () => emitter.removeListener("message", message));
});

server.listen(port, () => {
  console.log(`Server running at :${port}`);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

app.get("/", (req, res) => {
  res.send("Servidor WebRTC activo");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

io.on("connection", (socket) => {

  console.log("Cliente conectado");

  socket.on("join-room", ({ roomId }) => {
    socket.join(roomId);
  });

  socket.on("offer", (data) => {
    socket.to(data.roomId).emit("offer", data);
  });

  socket.on("answer", (data) => {
    socket.to(data.roomId).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.roomId).emit("ice-candidate", data);
  });

});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("Servidor WebRTC corriendo en puerto", PORT);
});
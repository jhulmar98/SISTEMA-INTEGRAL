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
  console.log("✅ Cliente conectado:", socket.id);

  socket.on("join-room", ({ roomId, role }) => {
    if (!roomId) return;

    socket.join(roomId);
    console.log(`🔗 ${socket.id} se unió a sala ${roomId} como ${role || "sin-role"}`);

    // Cuando entra un viewer, avisamos al emisor para que reenvíe un offer nuevo
    if (role === "viewer") {
      socket.to(roomId).emit("viewer-joined", {
        roomId,
        viewerId: socket.id,
      });
      console.log(`👀 Viewer entró en ${roomId}, notificando al sender`);
    }
  });

  socket.on("offer", (data) => {
    if (!data?.roomId) return;
    console.log("📤 Offer recibido para sala:", data.roomId);
    socket.to(data.roomId).emit("offer", data);
  });

  socket.on("answer", (data) => {
    if (!data?.roomId) return;
    console.log("📥 Answer recibido para sala:", data.roomId);
    socket.to(data.roomId).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit("ice-candidate", data);
  });

  socket.on("disconnect", () => {
    console.log("❌ Cliente desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("🚀 Servidor WebRTC corriendo en puerto", PORT);
});

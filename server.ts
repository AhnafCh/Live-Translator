import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.SIGNALING_PORT || 3000;
  
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Simple API health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // WebRTC Signaling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Join a room for a call
    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
      // Notify others in the room
      socket.to(roomId).emit("user-connected", socket.id);
    });

    // Handle WebRTC signaling events
    socket.on("offer", (data) => {
      socket.to(data.roomId).emit("offer", { ...data, senderId: socket.id });
    });

    socket.on("answer", (data) => {
      socket.to(data.roomId).emit("answer", { ...data, senderId: socket.id });
    });

    socket.on("ice-candidate", (data) => {
      socket.to(data.roomId).emit("ice-candidate", { ...data, senderId: socket.id });
    });

    // Optional: proxy messages for translation (mocked or forwarded to Gemini API)
    socket.on("audio-chunk", (data) => {
      // In a real implementation, this would stream to the Gemini Live API
      // For this demo, we broadcast it to the peer (if not using direct WebRTC for data)
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      socket.broadcast.emit("user-disconnected", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);

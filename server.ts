import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import dotenv from "dotenv";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

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

  const activeSessions = new Map<string, any>();

  // WebRTC Signaling & Gemini Live Translation
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

    socket.on("set-language", (data) => {
      socket.to(data.roomId).emit("peer-language", data.lang);
    });

    socket.on("request-language", (data) => {
      socket.to(data.roomId).emit("request-language");
    });

    socket.on("start-translation", async (data) => {
      const { targetLanguage } = data;
      console.log(`Starting translation for ${socket.id} (Target: ${targetLanguage})`);
      
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const session = await ai.live.connect({
          model: "gemini-3.5-live-translate-preview",
          config: {
            responseModalities: [Modality.AUDIO],
            translationConfig: {
              targetLanguageCode: targetLanguage
            } as any,
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audio) {
                // Send translated audio back to the listener (this socket)
                socket.emit("translated-audio", { audio, lang: targetLanguage, senderId: "ai" });
              }
              
              const interrupted = message.serverContent?.interrupted;
              if (interrupted) {
                socket.emit("translation-interrupted", { senderId: "ai" });
              }
            },
            onerror: (error: any) => {
              console.error("Live API error:", error);
              socket.emit("translation-error", error.message);
            }
          }
        });
        activeSessions.set(socket.id, session);
      } catch (err: any) {
        console.error(err);
        socket.emit("translation-error", err.message);
      }
    });

    socket.on("stop-translation", () => {
      const session = activeSessions.get(socket.id);
      if (session && typeof session.close === 'function') {
        session.close();
      }
      activeSessions.delete(socket.id);
    });

    socket.on("audio-chunk", (data) => {
      // Broadcast this speaker's audio to all OTHER peers' dedicated AI sessions
      activeSessions.forEach((session, sessionId) => {
        if (sessionId !== socket.id) {
          session.sendRealtimeInput({
            audio: { data: data.audio, mimeType: "audio/pcm;rate=16000" }
          }).catch((err: any) => console.error("Send realtime input error:", err));
        }
      });
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      const session = activeSessions.get(socket.id);
      if (session && typeof session.close === 'function') {
        session.close();
      }
      activeSessions.delete(socket.id);
      socket.broadcast.emit("user-disconnected", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        allowedHosts: true,
        cors: true
      },
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

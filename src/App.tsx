/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [latency, setLatency] = useState<number>(0);
  const [packetLoss, setPacketLoss] = useState<string>('0.00%');
  const [logs, setLogs] = useState<{time: string, lang: string, text: string, type: 'local' | 'remote'}[]>([
    { time: '14:20:11', lang: 'EN', text: 'Hello, how are you today?', type: 'local' },
    { time: '14:20:11', lang: 'BN', text: 'হ্যালো, আপনি আজ কেমন আছেন?', type: 'remote' },
    { time: '14:20:15', lang: 'BN', text: 'আমি ভালো আছি, আপনার সাথে কথা বলে ভালো লাগলো।', type: 'remote' },
    { time: '14:20:16', lang: 'EN', text: 'I am fine, nice to talk to you.', type: 'local' },
  ]);

  const [isTranslating, setIsTranslating] = useState(true);
  const [activeModel, setActiveModel] = useState('gemini-3.5-live-translate-preview');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Initialize socket connection
    const socketUrl = window.location.origin;
    socketRef.current = io(socketUrl);

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      // Simulate ping/latency
      setInterval(() => setLatency(Math.floor(Math.random() * 20) + 10), 3000);
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return (
    <div className="w-full h-full min-h-screen bg-slate-950 text-slate-200 font-sans p-6 overflow-hidden flex flex-col items-center justify-center">
      <div className="w-[1024px] h-[768px] flex flex-col">
        {/* Header Section */}
        <header className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg className="w-6 h-6 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 11.37 9.188 16.524 5 20"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white uppercase">Gemini Live Trans</h1>
              <p className="text-xs text-slate-500 font-mono">v1.0.4-preview // Local Node: 192.168.1.42</p>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 p-2 rounded-full">
            <div className="flex items-center gap-2 px-3 border-r border-slate-800">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
              <span className="text-xs font-medium uppercase tracking-wider">{isConnected ? 'Signaling Active' : 'Disconnected'}</span>
            </div>
            <div className="flex items-center gap-2 px-3">
              <span className="text-xs text-slate-400">Latency</span>
              <span className="text-xs font-mono text-emerald-400">{latency}ms</span>
            </div>
          </div>
        </header>

        {/* Main Bento Grid Area */}
        <div className="grid grid-cols-12 grid-rows-6 gap-4 flex-grow">
          
          {/* Primary Speaker (Local) */}
          <div className="col-span-4 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative group">
            <div className="absolute inset-0 bg-slate-800 flex items-center justify-center">
              <span className="text-slate-600 font-medium uppercase tracking-widest">User_Local (EN)</span>
            </div>
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
              <div className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-lg border border-slate-700/50">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Audio Input</p>
                <div className="flex gap-1 mt-1 items-end h-3">
                  <div className="w-1 bg-emerald-500 rounded-full h-[60%] animate-pulse"></div>
                  <div className="w-1 bg-emerald-500 rounded-full h-[100%] animate-pulse" style={{ animationDelay: '100ms' }}></div>
                  <div className="w-1 bg-emerald-500 rounded-full h-[80%] animate-pulse" style={{ animationDelay: '200ms' }}></div>
                  <div className="w-1 bg-slate-700 rounded-full h-[20%]"></div>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-slate-950 flex items-center justify-center border border-slate-700">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Remote Speaker (Peer) */}
          <div className="col-span-4 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-slate-800 flex items-center justify-center">
              <span className="text-slate-600 font-medium uppercase tracking-widest">Peer_Remote (BN)</span>
            </div>
            <div className="absolute top-4 left-4 bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-1 rounded text-[10px] font-bold uppercase">
              Live WebRTC
            </div>
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
              <div className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-lg border border-slate-700/50">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Packet Loss</p>
                <p className="text-sm font-mono text-emerald-400">{packetLoss}</p>
              </div>
            </div>
          </div>

          {/* Controls / Translator Switch */}
          <div className="col-span-4 row-span-4 bg-emerald-600 rounded-2xl p-6 flex flex-col justify-between shadow-2xl shadow-emerald-500/10 transition-colors duration-500">
            <div>
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-slate-950 font-black text-3xl uppercase leading-none">Live<br/>Translator</h3>
                <button 
                  onClick={() => setIsTranslating(!isTranslating)}
                  className={`w-14 h-8 rounded-full p-1 flex items-center transition-all duration-300 ${isTranslating ? 'bg-slate-950 justify-end' : 'bg-emerald-800 justify-start'}`}
                >
                  <div className={`w-6 h-6 rounded-full shadow-lg transition-all ${isTranslating ? 'bg-emerald-400' : 'bg-slate-400'}`}></div>
                </button>
              </div>
              <ul className="space-y-4">
                <li className="flex items-center gap-3 opacity-90">
                  <div className="w-6 h-6 rounded-full bg-slate-950/20 flex items-center justify-center text-slate-950">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293l-4-4a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-2.293 2.293a1 1 0 001.414 1.414l4-4a1 1 0 000-1.414z"></path></svg>
                  </div>
                  <span className="text-slate-950 font-bold text-sm tracking-tight">English → Bengali</span>
                </li>
                <li className="flex items-center gap-3 opacity-90">
                  <div className="w-6 h-6 rounded-full bg-slate-950/20 flex items-center justify-center text-slate-950">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm-3.707-9.293l4-4a1 1 0 011.414 1.414L9.414 9H13a1 1 0 110 2H9.414l2.293 2.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414z"></path></svg>
                  </div>
                  <span className="text-slate-950 font-bold text-sm tracking-tight">Bengali → English</span>
                </li>
              </ul>
            </div>
            <div className="bg-slate-950 text-emerald-400 p-4 rounded-xl mt-4">
              <p className="text-[10px] uppercase font-bold text-slate-500 mb-1">Active Model</p>
              <p className="font-mono text-sm tracking-tighter truncate" title={activeModel}>{activeModel}</p>
            </div>
          </div>

          {/* Real-time Transcription Stream */}
          <div className="col-span-8 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4 overflow-hidden relative">
            <div className="flex items-center justify-between z-10">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Translation Stream (WebRTC Channel)</span>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            </div>
            <div className="space-y-4 font-mono text-sm overflow-y-auto flex-grow scrollbar-hide z-10">
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-4 ${log.type === 'remote' && i === 1 ? 'bg-slate-800/50 p-2 rounded-lg border-l-2 border-emerald-500' : ''} ${log.type === 'local' && i === 3 ? 'bg-slate-800/50 p-2 rounded-lg border-l-2 border-blue-500' : ''} ${i === 0 ? 'opacity-50' : ''}`}>
                  <span className="text-slate-600 shrink-0">[{log.time}]</span>
                  <span className={log.lang === 'EN' ? 'text-blue-400 shrink-0' : log.lang === 'BN' && i === 2 ? 'text-red-400 shrink-0' : 'text-emerald-400 shrink-0'}>{log.lang}:</span>
                  <span className={i === 2 ? 'text-slate-300 tracking-tighter' : 'text-slate-100'}>{log.text}</span>
                </div>
              ))}
            </div>
            {/* Fade out bottom overlay */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20"></div>
          </div>

          {/* System Logs / Debug */}
          <div className="col-span-2 row-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-center">
            <h4 className="text-[10px] text-slate-500 font-bold uppercase mb-2">Environment</h4>
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">DOCKER</span>
                <span className="text-[10px] px-1 bg-blue-500/20 text-blue-400 rounded">RUNNING</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">ICE</span>
                <span className="text-[10px] px-1 bg-emerald-500/20 text-emerald-400 rounded">SRFLX</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">CPU</span>
                <span className="text-[10px] text-slate-200 font-mono">14%</span>
              </div>
            </div>
          </div>

          {/* Quick Action / API Settings */}
          <div className="col-span-2 row-span-2 bg-slate-800/40 border border-slate-700/50 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center text-center group cursor-pointer hover:bg-slate-800 transition-colors">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </div>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Configure API</span>
          </div>

        </div>

        {/* Footer / Status Bar */}
        <footer className="mt-4 flex justify-between items-center px-2">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              <span className="text-[11px] font-mono text-slate-500">SIGNALING: {isConnected ? 'CONNECTED' : 'OFFLINE'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              <span className="text-[11px] font-mono text-slate-500">STUN/TURN: ACTIVE</span>
            </div>
          </div>
          <div className="text-[11px] font-mono text-slate-500 flex gap-4">
            <span>MEM: 124MB</span>
            <span>UP: 04:12:44</span>
          </div>
        </footer>
      </div>
    </div>
  );
}


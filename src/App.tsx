/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

function pcmToBase64(pcmData: Float32Array) {
  const buffer = new ArrayBuffer(pcmData.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function playAudioChunk(audioCtx: AudioContext, base64Audio: string, nextStartTimeRef: React.MutableRefObject<number>) {
  const binary = atob(base64Audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const buffer = new Int16Array(bytes.buffer);
  const audioBuffer = audioCtx.createBuffer(1, buffer.length, 24000);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < buffer.length; i++) {
    channelData[i] = buffer[i] / 32768.0;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  
  if (nextStartTimeRef.current < audioCtx.currentTime) {
      nextStartTimeRef.current = audioCtx.currentTime;
  }
  source.start(nextStartTimeRef.current);
  nextStartTimeRef.current += audioBuffer.duration;
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [latency, setLatency] = useState<number>(0);
  const [packetLoss, setPacketLoss] = useState<string>('0.00%');
  const [logs, setLogs] = useState<{time: string, lang: string, text: string, type: 'local' | 'remote'}[]>([]);
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [localLang, setLocalLang] = useState<'en' | 'bn' | 'fr'>('en');
  const [remoteLang, setRemoteLang] = useState<'en' | 'bn' | 'fr'>('bn');
  const [peerConnected, setPeerConnected] = useState(false);
  const [activeModel, setActiveModel] = useState('gemini-3.5-live-translate-preview');
  
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('default');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('default');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const langLabels: Record<string, string> = {
    'en': 'English',
    'bn': 'Bengali',
    'fr': 'French'
  };

  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Audio Context for Gemini Live
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const isTranslatingRef = useRef<boolean>(false);

  const roomId = 'demo-room';

  useEffect(() => {
    isTranslatingRef.current = isTranslating;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isTranslating ? 0 : 1; // Mute WebRTC if translating
    }
    
    if (isTranslating && socketRef.current?.connected) {
       socketRef.current.emit("stop-translation"); // Stop existing just in case
       socketRef.current.emit("start-translation", { targetLanguage: localLang });
       addLog('System', `Translation Started (Hearing: ${langLabels[localLang]})`);
    } else if (!isTranslating && socketRef.current?.connected) {
       socketRef.current.emit("stop-translation");
       addLog('System', 'Translation Stopped');
    }
  }, [isTranslating, localLang, remoteLang]);

  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('set-language', { roomId, lang: localLang });
    }
  }, [localLang]);

  const addLog = (lang: string, text: string, type: 'local' | 'remote' = 'local') => {
    setLogs(prev => {
      const newLogs = [...prev, { time: new Date().toLocaleTimeString('en-US', { hour12: false }), lang, text, type }];
      if (newLogs.length > 50) newLogs.shift();
      return newLogs;
    });
  };

  useEffect(() => {
    const socketUrl = window.location.origin;
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join-room', roomId);
      socket.emit('set-language', { roomId, lang: localLang });
    });

    socket.on('peer-language', (lang) => {
      setRemoteLang(lang);
    });

    socket.on('request-language', () => {
      socket.emit('set-language', { roomId, lang: localLang });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // WebRTC Signaling
    socket.on('user-connected', async (userId) => {
      setPeerConnected(true);
      addLog('System', 'Peer connected, initiating WebRTC...', 'remote');
      socket.emit('request-language', { roomId });
      socket.emit('set-language', { roomId, lang: localLang });
      const peerConnection = createPeerConnection();
      peerConnectionRef.current = peerConnection;
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStreamRef.current!);
        });
      }
      
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { roomId, offer });
    });

    socket.on('offer', async (data) => {
      setPeerConnected(true);
      const peerConnection = createPeerConnection();
      peerConnectionRef.current = peerConnection;
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStreamRef.current!);
        });
      }
      
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', { roomId, answer });
    });

    socket.on('answer', async (data) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    socket.on('user-disconnected', () => {
      setPeerConnected(false);
      addLog('System', 'Peer disconnected.', 'remote');
    });

    // Translation audio received
    socket.on('translated-audio', (data) => {
      if (outputAudioCtxRef.current && isTranslatingRef.current) {
        playAudioChunk(outputAudioCtxRef.current, data.audio, nextStartTimeRef);
      }
    });

    socket.on('transcription', (data) => {
       addLog(data.lang, data.text, data.type);
    });

    socket.on('translation-error', (msg) => {
       addLog('Error', msg);
       setIsTranslating(false);
    });

    socket.on('translation-interrupted', () => {
       addLog('System', 'Audio stream interrupted.', 'remote');
    });

    // We will initialize the mic separately based on selected device.

    // Latency simulation for UI
    const interval = setInterval(() => setLatency(Math.floor(Math.random() * 20) + 10), 3000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (processorRef.current) processorRef.current.disconnect();
      if (inputAudioCtxRef.current) inputAudioCtxRef.current.close();
      if (outputAudioCtxRef.current) outputAudioCtxRef.current.close();
    };
  }, []); // Run once on mount

  // Mic initialization & device selection
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    // Enumerate devices
    const updateDevices = () => {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
        setOutputDevices(devices.filter(d => d.kind === 'audiooutput'));
      }).catch(console.error);
    };
    updateDevices();
    navigator.mediaDevices.addEventListener('devicechange', updateDevices);
    
    return () => navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
  }, []);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices.getUserMedia({
      audio: selectedMicId === 'default' ? true : { deviceId: { exact: selectedMicId } }
    }).then(stream => {
      if (!active) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      localStreamRef.current = stream;
      
      // Update WebRTC track if peer connected
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const sender = senders.find(s => s.track?.kind === 'audio');
        const audioTrack = stream.getAudioTracks()[0];
        
        if (sender) {
          sender.replaceTrack(audioTrack);
        } else {
          peerConnectionRef.current.addTrack(audioTrack, stream);
        }
      }
      
      // Sync mute state
      stream.getAudioTracks().forEach(t => t.enabled = !isMuted);
      
      // Setup Web Audio for Gemini
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
        
        const processor = inputAudioCtxRef.current.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        processor.connect(inputAudioCtxRef.current.destination);
        
        processor.onaudioprocess = (e) => {
          if (isTranslatingRef.current && socketRef.current?.connected) {
            const pcmData = e.inputBuffer.getChannelData(0);
            const base64 = pcmToBase64(pcmData);
            socketRef.current.emit("audio-chunk", { audio: base64 });
          }
        };
      }
      
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
      }
      const source = inputAudioCtxRef.current.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      if (processorRef.current) {
        source.connect(processorRef.current);
      }
      
    }).catch(err => {
      addLog('System', 'Failed to access microphone: ' + err.message);
    });

    return () => {
      active = false;
    };
  }, [selectedMicId]);

  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isMuted);
    }
  }, [isMuted]);

  useEffect(() => {
    const applySinkId = async () => {
      try {
        if (remoteAudioRef.current && (remoteAudioRef.current as any).setSinkId) {
          await (remoteAudioRef.current as any).setSinkId(selectedSpeakerId === 'default' ? '' : selectedSpeakerId);
        }
        if (outputAudioCtxRef.current && (outputAudioCtxRef.current as any).setSinkId) {
          await (outputAudioCtxRef.current as any).setSinkId(selectedSpeakerId === 'default' ? '' : selectedSpeakerId);
        }
      } catch (err) {
        console.error("Failed to set speaker device", err);
      }
    };
    applySinkId();
  }, [selectedSpeakerId]);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { roomId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };
    return pc;
  };

  return (
    <div className="w-full h-full min-h-screen bg-slate-950 text-slate-200 font-sans p-6 overflow-hidden flex flex-col items-center justify-center">
      <audio ref={remoteAudioRef} autoPlay />
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
              <p className="text-xs text-slate-500 font-mono">v1.0.4-preview // Local Node</p>
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
          <div className="col-span-4 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative group flex flex-col items-center justify-center">
            <span className="text-slate-500 font-medium uppercase tracking-widest mb-4">Preferred Language</span>
            <div className="z-10">
              <select 
                value={localLang} 
                onChange={(e) => {
                  if (outputAudioCtxRef.current?.state === 'suspended') outputAudioCtxRef.current.resume();
                  if (inputAudioCtxRef.current?.state === 'suspended') inputAudioCtxRef.current.resume();
                  setLocalLang(e.target.value as 'en'|'bn'|'fr');
                }}
                className="bg-slate-800 border border-slate-700 text-emerald-400 px-4 py-2 rounded-lg text-sm font-bold uppercase hover:bg-slate-700 transition-colors outline-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="bn">Bengali</option>
                <option value="fr">French</option>
              </select>
            </div>
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
              <div className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-lg border border-slate-700/50">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Audio Input</p>
                <div className="flex gap-1 mt-1 items-end h-3">
                  <div className={`w-1 rounded-full h-[60%] ${isMuted ? 'bg-slate-700' : 'bg-emerald-500 animate-pulse'}`}></div>
                  <div className={`w-1 rounded-full h-[100%] ${isMuted ? 'bg-slate-700' : 'bg-emerald-500 animate-pulse'}`} style={{ animationDelay: '100ms' }}></div>
                  <div className={`w-1 rounded-full h-[80%] ${isMuted ? 'bg-slate-700' : 'bg-emerald-500 animate-pulse'}`} style={{ animationDelay: '200ms' }}></div>
                  <div className="w-1 bg-slate-700 rounded-full h-[20%]"></div>
                </div>
              </div>
              <button 
                onClick={() => setIsMuted(!isMuted)}
                className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${isMuted ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'}`}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                )}
              </button>
            </div>
          </div>

          {/* Remote Speaker (Peer) */}
          <div className="col-span-4 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-slate-800 flex flex-col items-center justify-center gap-2">
              <span className="text-slate-600 font-medium uppercase tracking-widest">{peerConnected ? `Peer Connected` : 'Waiting for Peer...'}</span>
              {peerConnected && <span className="text-xs text-slate-500 font-bold uppercase">(Speaks {langLabels[remoteLang]})</span>}
            </div>
            <div className={`absolute top-4 left-4 border px-2 py-1 rounded text-[10px] font-bold uppercase ${peerConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
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
          <div className={`col-span-4 row-span-4 rounded-2xl p-6 flex flex-col justify-between shadow-2xl transition-colors duration-500 ${isTranslating ? 'bg-emerald-600 shadow-emerald-500/10' : 'bg-slate-800 border border-slate-700'}`}>
            <div>
              <div className="flex justify-between items-start mb-6">
                <h3 className={`font-black text-3xl uppercase leading-none ${isTranslating ? 'text-slate-950' : 'text-slate-400'}`}>Live<br/>Translator</h3>
                <button 
                  onClick={() => {
                    if (outputAudioCtxRef.current?.state === 'suspended') {
                      outputAudioCtxRef.current.resume();
                    }
                    if (inputAudioCtxRef.current?.state === 'suspended') {
                      inputAudioCtxRef.current.resume();
                    }
                    setIsTranslating(!isTranslating);
                  }}
                  className={`w-14 h-8 rounded-full p-1 flex items-center transition-all duration-300 ${isTranslating ? 'bg-slate-950 justify-end' : 'bg-slate-950 justify-start'}`}
                >
                  <div className={`w-6 h-6 rounded-full shadow-lg transition-all ${isTranslating ? 'bg-emerald-400' : 'bg-slate-600'}`}></div>
                </button>
              </div>
              <ul className="space-y-4">
                <li className={`flex items-center gap-3 opacity-90 ${isTranslating ? 'text-slate-950' : 'text-slate-400'}`}>
                  <div className="w-6 h-6 rounded-full bg-slate-950/20 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm-3.707-9.293l4-4a1 1 0 011.414 1.414L9.414 9H13a1 1 0 110 2H9.414l2.293 2.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414z"></path></svg>
                  </div>
                  <span className="font-bold text-sm tracking-tight">Listening in {langLabels[localLang]}</span>
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
              <div className={`w-2 h-2 rounded-full ${isTranslating ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
            </div>
            <div className="space-y-4 font-mono text-sm overflow-y-auto flex-grow scrollbar-hide z-10 flex flex-col-reverse">
              {[...logs].reverse().map((log, i) => (
                <div key={i} className={`flex gap-4 ${log.type === 'remote' ? 'bg-slate-800/50 p-2 rounded-lg border-l-2 border-emerald-500' : ''} ${log.type === 'local' ? 'bg-slate-800/50 p-2 rounded-lg border-l-2 border-blue-500' : ''}`}>
                  <span className="text-slate-600 shrink-0">[{log.time}]</span>
                  <span className={log.type === 'local' ? 'text-blue-400 shrink-0' : log.type === 'remote' ? 'text-emerald-400 shrink-0' : 'text-slate-400 shrink-0'}>{log.lang.toUpperCase()}:</span>
                  <span className={log.type === 'remote' ? 'text-slate-100' : 'text-slate-300'}>{log.text}</span>
                </div>
              ))}
              {logs.length === 0 && <div className="text-slate-600 italic">No activity yet. Start translation and speak...</div>}
            </div>
            {/* Fade out top overlay (since we use flex-col-reverse) */}
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20"></div>
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

          {/* Audio Settings */}
          <div className="col-span-2 row-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-center gap-3">
            <h4 className="text-[10px] text-slate-500 font-bold uppercase mb-1">Audio Routing</h4>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-slate-400 uppercase font-bold">Input (Mic)</span>
              <select 
                value={selectedMicId} 
                onChange={(e) => setSelectedMicId(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-300 px-2 py-1.5 rounded text-[10px] outline-none"
              >
                <option value="default">Default Mic</option>
                {audioDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Mic'}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-slate-400 uppercase font-bold">Output (Speaker)</span>
              <select 
                value={selectedSpeakerId} 
                onChange={(e) => setSelectedSpeakerId(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-300 px-2 py-1.5 rounded text-[10px] outline-none"
              >
                <option value="default">Default Speaker</option>
                {outputDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Speaker'}</option>
                ))}
              </select>
            </div>
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


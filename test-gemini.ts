import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'dummy' });
console.log(typeof ai.live?.connect === 'function' ? 'live.connect exists' : 'no live.connect');

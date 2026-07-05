import { LiveConnectConfig } from '@google/genai';
type ConfigKeys = keyof LiveConnectConfig;
// We can't easily reflect interfaces, but we can look at the .d.ts

/* Ambient plugin interfaces for the native glue. These mirror the public
 * API shapes of the Capacitor plugins declared in package.json so
 * `tsc --noEmit` passes without installed native binaries; the real types
 * take over once `npm install` runs at APK build time. */

declare module "@capacitor/core" {
  export interface CapacitorConfig {
    appId: string;
    appName: string;
    webDir: string;
    backgroundColor?: string;
    android?: Record<string, unknown>;
    plugins?: Record<string, Record<string, unknown>>;
  }
  export const Capacitor: {
    isNativePlatform(): boolean;
    getPlatform(): "android" | "ios" | "web";
  };
  export function registerPlugin<T>(name: string): T;
}

declare module "@capgo/background-geolocation" {
  export interface BgFix {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude?: number;
    speed?: number;
    time: number;
  }
  export interface BackgroundGeolocationPlugin {
    start(): Promise<void>;
    stop(): Promise<void>;
    addWatcher(
      options: Record<string, unknown>,
      cb: (fix: BgFix | null, error?: unknown) => void,
    ): Promise<{ watcherId: string }>;
    removeWatcher(options: { watcherId: string }): Promise<void>;
    requestPermissions(): Promise<{ granted: boolean }>;
  }
  export const BackgroundGeolocation: BackgroundGeolocationPlugin;
}

declare module "@capacitor-community/text-to-speech" {
  export interface TextToSpeechPlugin {
    speak(
      options: { text: string; rate?: number; pitch?: number },
    ): Promise<void>;
    stop(): Promise<void>;
  }
  export const TextToSpeech: TextToSpeechPlugin;
}

declare module "@capacitor-community/bluetooth-le" {
  export interface BlePlugin {
    requestPermissions(): Promise<void>;
    requestDevice(
      options: { services: string[] },
    ): Promise<{ deviceId: string }>;
    connect(options: { deviceId: string }): Promise<void>;
    startNotifications(options: {
      deviceId: string;
      service: string;
      characteristic: string;
    }): Promise<void>;
    addListener(
      event: string,
      cb: (value: { value?: DataView }) => void,
    ): Promise<{ remove(): Promise<void> }>;
  }
  export const BleClient: BlePlugin;
}
